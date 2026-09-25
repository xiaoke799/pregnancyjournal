/**
 * 一次性存储迁移
 *
 * 背景：v0.0.27 及更早版本把业务数据（照片、检查报告、备份、导出）写到了
 * `process.cwd()/data`，即 **应用安装目录**（生产环境为 ${TRIM_APPDEST}/server/node/data）。
 * 该目录在应用升级时会被覆盖、且用户无法在文件管理器中看到，导致：
 *   - 备份/导出「提示成功却找不到文件」
 *   - 上传的文件随升级丢失
 *
 * 本模块把旧目录下的业务文件**复制**（不删除）到持久化数据目录 config.STORAGE_DIR，
 * 并重写数据库中指向旧路径的记录。幂等、只增不改、全程 try/catch，绝不抛异常。
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./logger');

const MARKER = '.storage_migrated_v1';

// 不迁移的文件：
//  · 数据库本体与日志 —— 避免覆盖正在使用的库 / 无意义搬运
//  · *.js —— 打包时混进 data 目录的开发脚本（如 build-food-safety.js），不是用户数据
//  · 内置只读知识库 —— 随包发布、由 ASSETS_DIR 读取；复制到持久目录既无用又占地（食材库 380KB+）
//    （口径与 cmd/upgrade_init、cmd/uninstall_init 的排除列表保持一致）
function _skip(name) {
  if (/\.(db|db-wal|db-shm|tmp|jsonl|log)$/i.test(name) || name.endsWith('.db.tmp')) return true;
  if (/\.js$/i.test(name)) return true;
  if (/^(recipes|food_safety_v3|checkup_schedule)\.json$/i.test(name)) return true;
  if (/^default_checklist_.*\.json$/i.test(name)) return true;
  return false;
}

function _copyDir(src, dest) {
  let copied = 0;
  let entries;
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch (e) { return 0; }
  for (const ent of entries) {
    if (_skip(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    try {
      if (ent.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        copied += _copyDir(s, d);
      } else if (ent.isFile()) {
        if (!fs.existsSync(d)) { fs.copyFileSync(s, d); copied++; }
      }
    } catch (e) { /* 单个文件失败不影响整体 */ }
  }
  return copied;
}

function migrateStorage(db) {
  try {
    const legacyRoot = path.resolve(process.cwd(), 'data');
    const targetRoot = path.resolve(config.STORAGE_DIR || legacyRoot);
    if (legacyRoot === targetRoot) return;         // 开发模式：同一目录，无需迁移
    if (fs.existsSync(path.join(targetRoot, MARKER))) return; // 已迁移过
    if (!fs.existsSync(legacyRoot)) return;        // 无旧数据

    fs.mkdirSync(targetRoot, { recursive: true });
    const copied = _copyDir(legacyRoot, targetRoot);
    log.startup(`存储迁移: 复制 ${copied} 个文件 ${legacyRoot} → ${targetRoot}`);

    // 重写数据库中所有包含旧路径前缀的字符串
    let rewritten = 0;
    const legacy = legacyRoot.replace(/\\/g, '/');
    const target = targetRoot.replace(/\\/g, '/');
    try {
      const tables = db.queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      for (const t of tables) {
        const table = t.name;
        let cols = [];
        try { cols = db.queryAll(`PRAGMA table_info(${table})`); } catch (e) { continue; }
        for (const c of cols) {
          const col = c.name;
          try {
            const rows = db.queryAll(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} LIKE ?`, ['%' + legacy + '%']);
            const n = (rows && rows[0] && rows[0].n) || 0;
            if (n > 0) {
              db.run(`UPDATE ${table} SET ${col} = REPLACE(${col}, ?, ?) WHERE ${col} LIKE ?`, [legacy, target, '%' + legacy + '%']);
              rewritten += n;
            }
          } catch (e) { /* 该列不可比较则跳过 */ }
        }
      }
    } catch (e) {
      log.warn('存储迁移', `重写数据库路径失败: ${e.message}`);
    }
    log.startup(`存储迁移: 重写 ${rewritten} 处数据库路径引用`);

    try { fs.writeFileSync(path.join(targetRoot, MARKER), new Date().toISOString()); } catch (e) { /* ignore */ }
  } catch (e) {
    log.warn('存储迁移', `跳过（${e.message}）`);
  }
}

module.exports = { migrateStorage };
