const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const config = require('../config');

// 日志接口的访问控制。
//
// ⚠️ 原实现是 `if (!req.ip || req.ip === 'unknown') return true;`——
//    而真实部署下所有请求都从统一网关经 Unix Socket 进来，**根本没有 IP**，
//    于是这条「仅允许本地访问」的判定在线上等于恒真、形同虚设。
//    现在改为「按身份判定」：网关已鉴权放行 / dev 模式放行 / 直连本机或内网放行，
//    其余一律拒绝。绝不再因为「拿不到 IP」就放行。
function _identity(req) {
  const st = req.state || {};
  return {
    user_id: st.user_id || '',
    is_admin: st.is_admin === 'true',
    source: st.auth_source || 'none',
  };
}

function _isDirectLocal(req) {
  // 只用 express 的 req.ip（它本身就是从 socket 派生的，并且会遵循 trust proxy 决策）。
  // 不要再回退去读 req.socket.remoteAddress —— 那是第二处出处，且会绕开 trust proxy 的判断。
  const ip = req.ip || '';
  if (!ip || ip === 'unknown') return false; // 拿不到 IP ⇒ 不视为本地，绝不据此放行
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (ip.startsWith('192.168.') || ip.startsWith('::ffff:192.168.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('::ffff:10.')) return true;
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  return false;
}

function checkAccess(req, res) {
  // 1) 网关已鉴权（统一网关模式）→ 放行
  if (_identity(req).source === 'gateway' && _identity(req).user_id) return true;
  // 2) 开发模式（本地调试）
  if (config.APP_MODE === 'dev') return true;
  // 3) 直连且来自本机/内网
  if (_isDirectLocal(req)) return true;
  res.status(403).json({ code: 403, data: null, message: '仅允许本机访问' });
  return false;
}

// 破坏性操作（清空日志）额外要求管理员身份：普通用户不该有能力抹掉排查线索。
function checkAdmin(req, res) {
  if (config.APP_MODE === 'dev') return true;
  const id = _identity(req);
  if (id.source === 'gateway') {
    if (id.is_admin) return true;
    res.status(403).json({ code: 403, data: null, message: '需要管理员权限' });
    return false;
  }
  // 非网关（直连本机/内网）视为可信
  if (_isDirectLocal(req)) return true;
  res.status(403).json({ code: 403, data: null, message: '需要管理员权限' });
  return false;
}

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

// GET /api/v1/logs - 获取日志
router.get('/logs', (req, res) => {
  if (!checkAccess(req, res)) return;
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

// DELETE /api/v1/logs - 清空日志
router.delete('/logs', (req, res) => {
  if (!checkAccess(req, res)) return;
  if (!checkAdmin(req, res)) return;
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

// GET /api/v1/logs/stats - 日志统计信息
router.get('/logs/stats', (req, res) => {
  if (!checkAccess(req, res)) return;
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
