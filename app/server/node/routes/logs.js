const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../logger');

// 日志接口的访问控制。
//
// ⚠️ 原实现是 `if (!req.ip || req.ip === 'unknown') return true;`——
//    而真实部署下所有请求都从统一网关经 Unix Socket 进来，**根本没有 IP**，
//    于是这条「仅允许本地访问」的判定在线上等于恒真、形同虚设。
//    后来改成「按身份判定」；2026-09-30 上架前加固（B2）再收紧到**管理员**：
//    日志里有请求路径、用户 id、文件路径、日志目录，属**排查线索**而非用户数据，
//    普通账号既不该读、更不该清空。
//
// 判定逻辑统一收在 `middleware/auth.js`，本文件**不再自己写一份**：
//   · `requireAdmin` —— dev 放行 / 网关身份要求 is_admin / 直连本机内网视为可信 / 其余 403
//   · `isDirectLocal` —— 「直连本机内网」的**唯一出处**
// 本文件三条路由（GET /logs、GET /logs/stats、DELETE /logs）**全部**挂 requireAdmin。
// 历史教训：判定写在两处必然漂移 —— 上面那条 `!req.ip ⇒ 放行` 就是例子。
const { requireAdmin } = require('../middleware/auth');

/** 读取 JSONL 日志文件末尾 N 行，支持级别/分类过滤 */
function readJsonl(filePath, lineCount, { level, category, search } = {}) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const allLines = content.split('\n').filter(Boolean);

  let lines = allLines;

  // 只读取最后 N 行进行过滤（避免大文件全量解析）
  const tailCount = Math.min(Math.max(lineCount, 100), 5000);
  if (lines.length > tailCount) lines = lines.slice(-tailCount);

  const entries = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      // 级别过滤
      if (level && entry.level && entry.level !== level.toUpperCase()) continue;
      // 分类过滤
      if (category && entry.cat && !entry.cat.toLowerCase().includes(category.toLowerCase())) continue;
      // 关键字搜索
      if (search && !line.toLowerCase().includes(search.toLowerCase())) continue;
      entries.push(entry);
    } catch {
      // 非 JSON 行，原样保留
      entries.push({ ts: '', level: 'RAW', msg: line });
    }
  }

  // 返回最后 lineCount 条
  return entries.slice(-lineCount);
}

/** 获取所有可用日志文件列表 */
function listLogFiles() {
  const logDir = logger.getLogDir();
  if (!logDir || !fs.existsSync(logDir)) return [];
  try {
    return fs.readdirSync(logDir)
      .filter(f => f.endsWith('.jsonl') || f.endsWith('.log'))
      .map(f => {
        const stat = fs.statSync(path.join(logDir, f));
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

// GET /api/v1/logs - 获取日志（管理员；日志属排查线索，见文件顶部说明）
router.get('/logs', requireAdmin, (req, res) => {
  try {
    const lineCount = Math.min(Math.max(1, parseInt(req.query.lines) || 200), 5000);
    const level = req.query.level || null;
    const category = req.query.category || null;
    const search = req.query.search || null;
    const source = req.query.source || 'app'; // app | error | all

    const logPaths = logger.getLogPaths();
    let entries = [];

    if (source === 'error') {
      entries = readJsonl(logPaths.error, lineCount, { level, category, search });
    } else if (source === 'all') {
      // 合并 app + error 日志，按时间排序
      const appEntries = readJsonl(logPaths.app, lineCount, { level, category, search });
      const errEntries = readJsonl(logPaths.error, lineCount, { level, category, search });
      entries = [...appEntries, ...errEntries]
        .sort((a, b) => (a.ts || '').localeCompare(b.ts || ''))
        .slice(-lineCount);
    } else {
      entries = readJsonl(logPaths.app, lineCount, { level, category, search });
    }

    // 同时生成纯文本格式，兼容前端简单展示
    const logText = entries.map(e => {
      const ts = (e.ts || '').substring(11, 19);
      const lvl = (e.level || 'INFO').padEnd(5);
      const cat = e.cat || '-';
      const meta = Object.keys(e).filter(k => !['ts', 'level', 'cat', 'msg'].includes(k))
        .map(k => `${k}=${JSON.stringify(e[k])}`).join(' ');
      return `[${ts}] [${lvl}] [${cat}] ${e.msg || ''}${meta ? ' ' + meta : ''}`;
    }).join('\n');

    res.json({
      code: 0,
      data: {
        entries,
        logs: logText,
        count: entries.length,
        filters: { level, category, search, source },
        files: listLogFiles(),
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        node_version: process.version,
        logDir: logger.getLogDir(),
      },
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

// DELETE /api/v1/logs - 清空日志（管理员：普通账号不该有能力抹掉排查线索）
router.delete('/logs', requireAdmin, (req, res) => {
  try {
    const { init } = require('../logger');
    init(); // 确保日志目录存在

    const logPaths = logger.getLogPaths();
    for (const p of [logPaths.app, logPaths.error]) {
      if (p && fs.existsSync(p)) {
        // 清空而非删除，保持文件存在
        fs.writeFileSync(p, '');
      }
    }

    // 同时清理轮转的历史文件
    const logDir = logger.getLogDir();
    if (logDir && fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir).filter(f => f.includes('.'));
      for (const f of files) {
        try { fs.unlinkSync(path.join(logDir, f)); } catch {}
      }
    }

    logger.info('日志', '日志文件已清空');
    res.json({ code: 0, data: { cleared: true }, message: '日志已清空' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

// GET /api/v1/logs/stats - 日志统计信息（管理员；会暴露日志文件路径与体量）
router.get('/logs/stats', requireAdmin, (req, res) => {
  try {
    const logPaths = logger.getLogPaths();
    const stats = { app: null, error: null };

    for (const key of ['app', 'error']) {
      const p = logPaths[key];
      if (p && fs.existsSync(p)) {
        const stat = fs.statSync(p);
        // 统计各级别数量（只扫描最后500行）
        const content = fs.readFileSync(p, 'utf-8');
        const lines = content.split('\n').filter(Boolean).slice(-500);
        const levelCounts = {};
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            levelCounts[entry.level || 'UNKNOWN'] = (levelCounts[entry.level || 'UNKNOWN'] || 0) + 1;
          } catch {}
        }
        stats[key] = {
          size: stat.size,
          modified: stat.mtime.toISOString(),
          lines: content.split('\n').filter(Boolean).length,
          levelCounts,
        };
      }
    }

    res.json({ code: 0, data: stats, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
