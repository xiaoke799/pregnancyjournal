const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const log = require('../logger');
const PDFDocument = require('pdfkit');

// 导入/恢复端点的最大请求体大小（100MB），防止内存耗尽
const MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;

// 简单认证中间件（fnOS CGI已通过header传递用户信息）
// 注意：此中间件在 fnOS 部署环境下由反向代理层鉴权，此处直接放行。
// 若脱离 fnOS 环境（直连 Node 进程），需替换为实际 token 校验逻辑。
function verifyAuth(req, res, next) {
  if (config.APP_MODE === 'dev') {
    log.warn('安全', 'verifyAuth 为空操作模式，生产环境请确保上游已鉴权');
  }
  next();
}

const ALL_TABLES = [
  'pregnancy', 'prenatal_checkup', 'custom_checkup', 'checkup_photo',
  'checkup_report', 'lab_result', 'daily_record', 'contraction_session',
  'contraction', 'pregnancy_photo', 'diary_entry', 'checklist',
  'checklist_item', 'reminder', 'fetal_movement_session', 'fetal_movement',
  'habit_checkin', 'supplement_checkin', 'app_config', 'schedule_dates',
  // 推送流水（设置页「推送记录」与手动重试都读它）。补入备份：
  //  · 纯新增 —— 老备份里没有这张表，恢复时按「缺表跳过」处理，不会清空现有记录；
  //  · 新备份恢复时按「恢复至该备份状态」语义整表替换，与其它表一致。
  'push_log',
];

// 恢复备份里的 files/config/* 时的落点分流：
//  · 可写状态文件（企业微信配置、推送状态）→ config.DATA_DIR（持久化目录）
//  · 内置只读知识库（菜谱/食材安全/产检计划）→ config.ASSETS_DIR（安装目录，写失败仅告警）
// ⚠️ 每新增一个「用户在界面上填写、存在 DATA_DIR 的配置文件」都必须登记进来，
// 否则恢复时会走 else 分支落到 ASSETS_DIR（安装目录）：那里随升级被覆盖，
// 用户填的东西等于没了。飞书渠道就是漏了这一条出的线上问题（2026-09-26 修）。
const WRITABLE_CONFIG_FILES = new Set([
  'wecom.json',
  'feishu.json',
  'daily_push_state.json',
  'schedule_dates.json',
  // 用户在「备份/导出 → 手动指定目录」里添加的目录（写入测试通过才记下来）。
  // 同属用户填写的配置：不登记就会被当成内置资源写到安装目录，升级即丢。
  'trusted_dirs.json',
]);

// 内置知识库：随安装包发布、随升级更新的「只读资源」，不是用户数据。
// ⚠️ 恢复备份时**绝不覆盖**它们（只在文件缺失时补写）：
// 备份里带的往往是**旧版本**的副本（菜谱更少、食材库更薄、产检表结构更旧），
// 一旦覆盖，用户就会遇到「恢复了备份，内容反而退回旧版」——静默、无提示、且难以自查。
// 曾经踩过同类的「升级后内置知识库丢失」，正是同一类问题的另一面。
const BUILTIN_RESOURCE_FILES = new Set([
  'checkup_schedule.json', 'recipes.json', 'food_safety_v3.json',
  // 同类只读资源：产检子项旧名归一表、待产清单模板（随包发布、随升级更新，非用户数据）。
  // 目前备份侧不打包它们（见下方 configSources），登记在此是防御性的：
  // 一旦今后被纳入备份，恢复时也不会用旧副本把新版覆盖回去。
  'checkup_subitem_aliases.json',
  'default_checklist_hospital.json', 'default_checklist_confinement.json',
  'default_checklist_delivery_room.json',
]);

function restoreConfigDir(srcConfigDir) {
  if (!fs.existsSync(srcConfigDir)) return 0;
  let n = 0;
  const skipped = [];
  for (const fn of fs.readdirSync(srcConfigDir)) {
    const src = path.join(srcConfigDir, fn);
    try {
      if (!fs.statSync(src).isFile()) continue;
      const destDir = WRITABLE_CONFIG_FILES.has(fn) ? config.DATA_DIR : config.ASSETS_DIR;
      const destPath = path.join(destDir, fn);
      if (BUILTIN_RESOURCE_FILES.has(fn) && fs.existsSync(destPath)) {
        skipped.push(fn);
        continue;
      }
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(src, destPath);
      n++;
    } catch (e) {
      log.warn('恢复', `配置文件回写失败 ${fn}: ${e.message}`);
    }
  }
  if (skipped.length) {
    log.info('恢复', `保留当前版本的内置知识库，未被旧备份覆盖: ${skipped.join(', ')}`);
  }
  return n;
}

function readTable(table) {
  try { return db.queryAll(`SELECT * FROM ${table}`); } catch (e) { log.warn('导出', `读取表 ${table} 失败`, { error: e.message }); return []; }
}

// 备份/导出可能的落点。**必须与 /backup、/export/backups、/restore-latest 的候选目录保持一致**，
// 否则会出现「列表里能看到备份，点恢复却提示超出备份目录范围」——生产环境（配了 data-share）必现。
function _backupAllowedRoots() {
  return [
    config.SHARE_DIR ? path.join(config.SHARE_DIR, 'backups') : null,
    config.BACKUPS_DIR,
    path.join(config.DATA_DIR || '.', 'backups'),
    path.join(config.PHOTOS_DIR || '.', '..', 'backups'),
  ].filter(Boolean).map(p => path.resolve(p));
}

// 解析系统注入的「冒号分隔路径列表」。
// 生产环境是 fnOS（Linux），路径形如 /vol1/@appshare/x，用 ':' 分隔没问题；
// 但 Windows 盘符自带冒号（C:\x），按 ':' 切会把路径切成两半，
// 所以本机开发/自测时改按 ';' 切（与 Windows PATH 风格一致）。
function _splitPathList(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const sep = process.platform === 'win32' ? ';' : ':';
  return s.split(sep).map(x => x.trim()).filter(Boolean);
}

// 用户在「飞牛应用中心 → 孕程记 → 设置 → 授权目录」里添加的文件夹。
// 系统通过 TRIM_DATA_ACCESSIBLE_PATHS 注入，manifest 的 disable_authorization_path=false
// 就是打开这个入口的开关（我们已经是 false）。**授权是用户动作，应用无权代替**，所以这里只读环境变量。
function _accessibleRoots() {
  return _splitPathList(process.env.TRIM_DATA_ACCESSIBLE_PATHS).map(p => path.resolve(p));
}

// 存储卷根目录（/vol1 ~ /vol10）。用于「用户还没在应用设置里授权任何目录」时的兜底：
// 仍能浏览并选择。真正的写入权限由飞牛的系统 ACL 把关（应用以专用低权限用户运行），
// 能写进去即说明该用户对该目录确实有写权限。
function _volumeRoots() {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const vol = `/vol${i}`;
    try { if (fs.existsSync(vol) && fs.statSync(vol).isDirectory()) out.push(vol); } catch { /* skip */ }
  }
  return out;
}

// 「导出备份到指定目录」允许写入的范围。
// = 备份落点 ∪ 用户授权目录 ∪ 共享目录 ∪ 存储卷根。
// **必须与 GET /browse-dir 能列出的 roots 保持一致**，否则用户会遇到「能选却提示不允许导出」。
// 老版本这里完全没校验，等于把「往任意路径写文件」暴露给了接口调用方。
function _exportAllowedRoots() {
  return [
    ..._backupAllowedRoots(),
    ..._accessibleRoots(),
    config.SHARE_DIR ? path.resolve(config.SHARE_DIR) : null,
    ..._volumeRoots(),
    // 用户手动指定、并通过了真实写入测试的目录（见 /trust-dir）
    ..._readTrustedDirs(),
  ].filter(Boolean).map(p => path.resolve(p));
}

// 「列出备份 / 一键恢复 / 指定目录恢复」时搜索 backup_* 子目录的范围（读侧）。
// = 备份落点 ∪ 用户授权目录 ∪ 手动确认目录 ∪ 共享目录根。
// 存在的意义：写侧（POST /backup）用 _exportAllowedRoots() 允许导出到授权目录，读侧若仍只认
// 备份落点，就会出现「导出提示成功、列表里却看不到、也无法恢复」——2026-09-23 修的就是这个。
// **刻意不含 /vol1~10 整个卷**：那是「导出」时的兜底可写范围，逐卷遍历找备份代价过高
// （卷下动辄几十万文件）。用户主动导出的备份必然落在上面这几类目录之内，所以够用。
function _backupSearchRoots() {
  const roots = [
    ..._backupAllowedRoots(),
    ..._accessibleRoots(),
    ..._readTrustedDirs(),
    config.SHARE_DIR ? path.resolve(config.SHARE_DIR) : null,
  ].filter(Boolean).map(p => path.resolve(p));
  // 去重：同一个目录可能同时命中多个来源（如 授权目录 = 共享目录）
  return [...new Set(roots)];
}

// 排查用：把「应用进程实际看到的环境」摊开。
// 背景：用户在飞牛应用中心给应用添加了授权目录，但应用这边读不到 —— 到底是
// ①环境变量根本没下发、②下发了下发成了别的名字、③还是应用启动早于授权（环境变量只在进程启动时注入）
// 光看代码猜不出来，必须让应用自己把真实值报出来。只回传 TRIM_* 路径/版本/用户名，
// 任何像 token/secret 的键一律打码，避免凭据外泄。
function _buildDiagnostics() {
  const trimKeys = Object.keys(process.env).filter(k => k.startsWith('TRIM_')).sort();
  const envDump = {};
  for (const k of trimKeys) {
    if (/TOKEN|SECRET|PASS|KEY/i.test(k)) { envDump[k] = '(已隐藏)'; continue; }
    envDump[k] = process.env[k];
  }

  const appName = process.env.TRIM_APPNAME || 'pregnancyjournal';
  const appDir = `/var/apps/${appName}`;
  const appShareDir = path.join(appDir, 'share');
  const readDirSafe = (p) => {
    try { return fs.readdirSync(p).slice(0, 60); } catch (e) { return null; }
  };

  return {
    started_at: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptime_sec: Math.round(process.uptime()),
    pid: process.pid,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    gid: typeof process.getgid === 'function' ? process.getgid() : null,
    platform: process.platform,
    node: process.version,

    // 原始值 —— 空/null 就说明「系统没把这个变量给到应用进程」
    accessible_raw: process.env.TRIM_DATA_ACCESSIBLE_PATHS || null,
    accessible_parsed: _accessibleRoots(),
    share_raw: process.env.TRIM_DATA_SHARE_PATHS || null,

    trim_env: envDump,
    trim_env_keys: trimKeys,

    app_dir: appDir,
    app_dir_entries: readDirSafe(appDir),
    app_share_dir: appShareDir,
    app_share_entries: readDirSafe(appShareDir),
  };
}

// 「手动指定的导出目录」——用户自己在界面上填、并且通过真实写入测试的目录。
// 存在的意义：万一系统没把授权路径经 TRIM_DATA_ACCESSIBLE_PATHS 下发（或有延迟），
// 用户仍然能指定一个他自己确认过的目录，功能不至于完全不可用。
// 安全语义：写入测试就是授权凭证 —— 应用以专用低权限用户运行，
// 能真的写进去，说明系统确实给这个路径授过 ACL。
function _trustedDirsFile() {
  return path.join(config.DATA_DIR || '.', 'trusted_dirs.json');
}

function _readTrustedDirs() {
  try {
    const arr = JSON.parse(fs.readFileSync(_trustedDirsFile(), 'utf-8'));
    return Array.isArray(arr) ? arr.filter(p => typeof p === 'string' && p.trim()) : [];
  } catch (e) {
    return [];
  }
}

function _writeTrustedDirs(list) {
  try {
    const dir = path.dirname(_trustedDirsFile());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_trustedDirsFile(), JSON.stringify([...new Set(list)].slice(0, 50), null, 2));
    return true;
  } catch (e) {
    log.warn('导出', '保存手动目录失败', { error: e.message });
    return false;
  }
}

// 判断 target 是否位于 roots 之内（用 path.resolve 后按路径段比较，避免 /a/bc 命中 /a/b）
function _isUnderAnyRoot(target, roots) {
  const resolved = path.resolve(target);
  return roots.some(root => resolved === root || resolved.startsWith(root + path.sep));
}

// 表名 → 允许的列名白名单（防止 SQL 列名注入）
//
// ⚠️ 这份白名单同时决定了**恢复时会写回哪些列**：/restore-latest 先 `DELETE FROM 表`
// 再按白名单插入，因此**不在白名单里的列会被永久丢掉**（备份里有也白搭）。
// 加字段时务必同步这里，否则用户「恢复一次备份」就会静默少数据。
// 曾经漏掉：daily_record 的三围（bust/waist/hip）、diary_entry.title、reminder.priority。
const TABLE_COLUMNS = {
  pregnancy: ['id','last_period_date','conception_date','due_date','is_active','baby_name','created_at','updated_at'],
  prenatal_checkup: ['id','pregnancy_id','checkup_date','gestational_week','gestational_day','checkup_type','weight','blood_pressure','fetal_heart_rate','fundal_height','abdominal_circumference','hospital','notes','is_completed','is_recommended','created_at','updated_at'],
  custom_checkup: ['id','pregnancy_id','name','items','checkup_date','notes','is_completed','created_at','updated_at'],
  checkup_photo: ['id','checkup_id','file_path','thumbnail_path','note','created_at'],
  checkup_report: ['id','checkup_id','checkup_type','filename','file_path','file_type','mime_type','file_size','report_category','sub_item','created_at'],
  lab_result: ['id','checkup_id','category','item_name','value','unit','reference_min','reference_max','status','updated_at','created_at'],
  daily_record: ['id','pregnancy_id','record_date','weight','fetal_heart_rate','body_temperature','bust','waist','hip','blood_glucose_fasting','blood_glucose_1h','blood_glucose_2h','mood','mood_note','stool','stool_record','note','blood_pressure_systolic','blood_pressure_diastolic','sleep_hours','sleep_quality','symptoms','exercise_type','exercise_duration','diet_note','medication','edema_level','vaginal_discharge','skin_condition','urination_frequency','hcg_value','hcg_weeks','uric_acid','uric_acid_period','supplement_record','intimacy_note','plan_text','plan_date','is_plan_done','water_intake','habit_text','contraction_count','contraction_interval','contraction_duration','contraction_pain','fetal_movement_count','fetal_movement_duration','intimacy_record','created_at','updated_at'],
  contraction_session: ['id','pregnancy_id','session_date','start_time','end_time','total_count','avg_duration','avg_interval','notes','created_at'],
  contraction: ['id','session_id','start_time','end_time','duration','interval_from_prev','created_at'],
  pregnancy_photo: ['id','pregnancy_id','checkup_id','photo_type','gestational_week','gestational_day','milestone_type','file_path','thumbnail_path','note','media_type','created_at','updated_at'],
  diary_entry: ['id','pregnancy_id','entry_date','gestational_week','title','content','mood','image_urls','created_at','updated_at'],
  checklist: ['id','pregnancy_id','type','name','created_at'],
  checklist_item: ['id','checklist_id','name','description','category','is_checked','is_custom','is_mandatory','sort_order','created_at'],
  reminder: ['id','pregnancy_id','title','trigger_date','trigger_time','reminder_type','source_type','source_id','is_enabled','is_triggered','is_completed','priority','notes','created_at','updated_at'],
  schedule_dates: ['pregnancy_id','schedule_id','checkup_date','updated_at'],
  fetal_movement_session: ['id','pregnancy_id','session_date','start_time','end_time','total_count','notes','created_at'],
  fetal_movement: ['id','session_id','timestamp','created_at'],
  habit_checkin: ['id','pregnancy_id','date','items','notes','created_at','updated_at'],
  supplement_checkin: ['id','pregnancy_id','date','items','notes','created_at','updated_at'],
  app_config: ['id','key','value','description','created_at','updated_at'],
  push_log: ['id','push_type','push_content','status','error_message','pushed_at','created_at','payload','channel'],
};

function sanitizeColumns(table, row) {
  const allowed = TABLE_COLUMNS[table];
  if (!allowed) return null;
  const sanitized = {};
  for (const [k, v] of Object.entries(row)) {
    if (allowed.includes(k)) sanitized[k] = v;
  }
  return sanitized;
}

function writeTable(table, rows) {
  if (!rows || rows.length === 0) return 0;
  let count = 0;
  for (const row of rows) {
    const sanitized = sanitizeColumns(table, row);
    if (!sanitized || Object.keys(sanitized).length === 0) continue;
    const keys = Object.keys(sanitized);
    const placeholders = keys.map(() => '?').join(',');
    const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
    try { db.run(sql, keys.map(k => sanitized[k])); count++; } catch (e) { log.warn('导入', `${table} 行导入失败`, { error: e.message }); }
  }
  return count;
}

function copyFile(src, destDir) {
  try {
    if (!src || !fs.existsSync(src)) return null;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const fileName = path.basename(src);
    const dest = path.join(destDir, fileName);
    if (src !== dest) fs.copyFileSync(src, dest);
    return dest;
  } catch (e) { log.warn('文件', `复制文件失败 ${src} → ${destDir}`, { error: e.message }); return null; }
}

function copyDirFiles(srcDir, destDir) {
  let count = 0;
  try {
    if (!fs.existsSync(srcDir)) return 0;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    for (const f of files) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      if (fs.statSync(src).isFile()) { fs.copyFileSync(src, dest); count++; }
    }
  } catch (e) { log.warn('文件', `复制目录失败 ${srcDir} → ${destDir}`, { error: e.message }); }
  return count;
}

function copyDirContentsRecursive(srcBase, destBase, maxDepth = 20) {
  let count = 0;
  try {
    if (!fs.existsSync(srcBase)) return 0;
    const items = fs.readdirSync(srcBase, { withFileTypes: true });
    for (const item of items) {
      const srcPath = path.join(srcBase, item.name);
      const destPath = path.join(destBase, item.name);
      if (item.isSymbolicLink()) continue; // 跳过符号链接，防止循环引用
      if (item.isFile()) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        count++;
      } else if (item.isDirectory() && maxDepth > 1) {
        count += copyDirContentsRecursive(srcPath, destPath, maxDepth - 1);
      }
    }
  } catch (e) { log.warn('文件', `递归复制目录失败 ${srcBase}`, { error: e.message }); }
  return count;
}

function prepareInsertStatement(table, sampleRow) {
  if (!sampleRow) return { sql: '', params: () => [] };
  const keys = Object.keys(sampleRow);
  const placeholders = keys.map(() => '?').join(',');
  const sql = `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`;
  return {
    sql,
    params: (row) => keys.map(k => row[k]),
  };
}

router.post('/export/full', async (req, res) => {
  try {
    log.api('导出', '全量JSON导出开始');
    const exportData = { version: '1.0.0', exported_at: new Date().toISOString(), tables: {} };
    for (const table of ALL_TABLES) {
      exportData.tables[table] = readTable(table);
    }
    exportData.stats = {};
    for (const [k, v] of Object.entries(exportData.tables)) {
      exportData.stats[k] = v.length;
    }
    const photos = readTable('pregnancy_photo');
    exportData.photos = photos.filter(p => p.file_path && fs.existsSync(p.file_path)).map(p => p.file_path);
    log.api('导出', `全量导出完成`, { tables: Object.keys(exportData.stats).length, totalRows: Object.values(exportData.stats).reduce((a, b) => a + b, 0) });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pregnancyjournal-backup-${config.localToday()}.json"`);
    res.json({ code: 0, data: exportData, message: 'success' });
  } catch (error) {
    log.error('导出', '全量导出失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/with-photos', async (req, res) => {
  try {
    log.api('导出', '全量+原图导出开始');
    const timestamp = config.localFileTimestamp();
    // 导出落盘目录：优先应用共享目录（用户可见），否则退回备份目录
    let exportBase = path.join(config.DATA_DIR || '.', 'backups');
    if (config.SHARE_DIR) {
      try {
        const d = path.join(config.SHARE_DIR, 'exports');
        fs.mkdirSync(d, { recursive: true });
        exportBase = d;
      } catch (e) { /* 共享目录不可写则回退 */ }
    }
    const exportDir = path.join(exportBase, `export_${timestamp}`);
    const photosDir = path.join(exportDir, 'photos');
    const mediaDir = path.join(exportDir, 'media');
    fs.mkdirSync(exportDir, { recursive: true });

    const exportData = { version: '1.0.0', exported_at: new Date().toISOString(), tables: {}, includes_photos: true };
    for (const table of ALL_TABLES) {
      exportData.tables[table] = readTable(table);
    }

    let photoCount = 0;
    const allPhotos = readTable('pregnancy_photo');
    for (const p of allPhotos) {
      if (p.file_path && fs.existsSync(p.file_path)) {
        const sub = p.media_type === 'video' ? mediaDir : photosDir;
        if (copyFile(p.file_path, sub)) photoCount++;
      }
      if (p.thumbnail_path && fs.existsSync(p.thumbnail_path)) {
        copyFile(p.thumbnail_path, photosDir);
      }
    }

    const checkupPhotos = readTable('checkup_photo');
    const reportsDir = path.join(exportDir, 'checkup_reports');
    for (const cp of checkupPhotos) {
      if (cp.file_path && fs.existsSync(cp.file_path)) copyFile(cp.file_path, reportsDir);
      if (cp.thumbnail_path && fs.existsSync(cp.thumbnail_path)) copyFile(cp.thumbnail_path, reportsDir);
    }

    const checkupReports = readTable('checkup_report');
    for (const cr of checkupReports) {
      if (cr.file_path && fs.existsSync(cr.file_path)) copyFile(cr.file_path, reportsDir);
    }

    fs.writeFileSync(path.join(exportDir, 'data.json'), JSON.stringify(exportData, null, 2));

    log.api('导出', `全量+原图导出完成`, { photos: photoCount, dir: exportDir });
    res.json({
      code: 0,
      data: {
        export_dir: exportDir,
        data_file: path.join(exportDir, 'data.json'),
        photos_dir: photosDir,
        total_photos: photoCount,
        created_at: new Date().toISOString(),
      },
      message: `导出完成: ${photoCount} 张照片`
    });
  } catch (error) {
    log.error('导出', '全量+原图导出失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/export/download-dir', (req, res) => {
  try {
    const exportDir = req.query.dir;
    if (!exportDir || !fs.existsSync(exportDir)) {
      return res.json({ code: 1001, data: null, message: '导出目录不存在' });
    }
    const resolved = path.resolve(exportDir);
    // 允许：备份落点 + 共享目录下的 exports（导出产物）
    const allowedRoots = _backupAllowedRoots();
    if (config.SHARE_DIR) allowedRoots.push(path.resolve(config.SHARE_DIR, 'exports'));
    if (!_isUnderAnyRoot(resolved, allowedRoots)) {
      return res.json({ code: 1001, data: null, message: '不允许访问该目录' });
    }
    const files = [];
    const walk = (dir, prefix = '') => {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) { walk(fp, path.join(prefix, f)); }
        else { files.push({ name: path.join(prefix, f), size: stat.size }); }
      }
    };
    walk(resolved);
    res.json({ code: 0, data: { dir: resolved, files, total: files.length }, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/import-json', async (req, res) => {
  try {
    const importData = req.body;
    if (!importData || !importData.tables) {
      return res.json({ code: 1001, data: null, message: '无效的导入数据' });
    }
    // 防止超大 payload 导致内存耗尽
    const payloadSize = JSON.stringify(importData).length;
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      return res.json({ code: 1001, data: null, message: `导入数据过大（${Math.round(payloadSize / 1024 / 1024)}MB），超过限制` });
    }
    log.api('导入', 'JSON导入开始', { version: importData.version });

    let totalRows = 0;
    const results = {};
    for (const [table, rows] of Object.entries(importData.tables)) {
      if (ALL_TABLES.includes(table) && Array.isArray(rows)) {
        const count = writeTable(table, rows);
        results[table] = count;
        totalRows += count;
      }
    }
    db.saveDb();
    log.api('导入', `JSON导入完成`, { totalRows, tables: Object.keys(results).length });
    res.json({ code: 0, data: { imported: true, total_rows: totalRows, results }, message: `导入完成: ${totalRows} 条记录` });
  } catch (error) {
    log.error('导入', 'JSON导入失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/import-dir', async (req, res) => {
  try {
    const importDir = req.query.dir || req.body.dir;
    if (!importDir || !fs.existsSync(importDir)) {
      return res.json({ code: 1001, data: null, message: '导入目录不存在' });
    }
    // 路径安全校验：仅允许从备份落点导入（与 /backup、/export/backups 保持一致）
    if (!_isUnderAnyRoot(importDir, _backupAllowedRoots())) {
      return res.json({ code: 1001, data: null, message: '不允许从该目录导入' });
    }
    log.api('导入', '目录导入开始', { dir: importDir });

    const dataFile = path.join(importDir, 'data.json');
    if (!fs.existsSync(dataFile)) {
      return res.json({ code: 1001, data: null, message: '目录中没有 data.json 文件' });
    }
    const importData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));

    let totalRows = 0;
    const results = {};
    for (const [table, rows] of Object.entries(importData.tables || {})) {
      if (ALL_TABLES.includes(table) && Array.isArray(rows)) {
        const count = writeTable(table, rows);
        results[table] = count;
        totalRows += count;
      }
    }

    let photoCount = 0;
    const photosDir = path.join(importDir, 'photos');
    if (fs.existsSync(photosDir)) {
      const destPhotos = config.PHOTOS_DIR;
      photoCount += copyDirFiles(photosDir, destPhotos);
    }
    const mediaDir = path.join(importDir, 'media');
    if (fs.existsSync(mediaDir)) {
      const destMedia = config.MEDIA_DIR;
      photoCount += copyDirFiles(mediaDir, destMedia);
    }
    const reportsDir = path.join(importDir, 'checkup_reports');
    if (fs.existsSync(reportsDir)) {
      const destReports = path.join(config.PHOTOS_DIR, 'checkup_reports');
      photoCount += copyDirFiles(reportsDir, destReports);
    }

    // 路径重写：将导入数据中的旧绝对路径替换为本机路径
    // import-dir 使用旧版格式（photos/media/checkup_reports 目录），无 _file_map，
    // 需要根据文件名匹配来重写数据库路径
    function rewriteImportPaths(table, col, srcDir, destBase) {
      try {
        if (!fs.existsSync(srcDir)) return;
        const rows = db.queryAll(`SELECT id, ${col} FROM ${table}`);
        for (const row of rows) {
          const oldPath = row[col];
          if (!oldPath) continue;
          const fileName = path.basename(oldPath);
          if (fs.existsSync(path.join(srcDir, fileName)) && oldPath !== path.join(destBase, fileName)) {
            db.run(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [path.join(destBase, fileName), row.id]);
          }
        }
      } catch {}
    }
    rewriteImportPaths('pregnancy_photo', 'file_path', photosDir, config.PHOTOS_DIR);
    rewriteImportPaths('pregnancy_photo', 'thumbnail_path', photosDir, config.PHOTOS_DIR);
    rewriteImportPaths('checkup_photo', 'file_path', photosDir, config.PHOTOS_DIR);
    rewriteImportPaths('checkup_photo', 'thumbnail_path', photosDir, config.PHOTOS_DIR);
    rewriteImportPaths('checkup_report', 'file_path', reportsDir, path.join(config.PHOTOS_DIR, 'checkup_reports'));
    // 视频文件重写到 MEDIA_DIR
    try {
      const vids = db.queryAll("SELECT id, file_path FROM pregnancy_photo WHERE media_type = 'video'");
      for (const v of vids) {
        if (!v.file_path) continue;
        const fileName = path.basename(v.file_path);
        if (fs.existsSync(path.join(mediaDir, fileName))) {
          db.run("UPDATE pregnancy_photo SET file_path = ? WHERE id = ?", [path.join(config.MEDIA_DIR, fileName), v.id]);
        }
      }
    } catch {}

    db.saveDb();
    log.api('导入', `目录导入完成`, { totalRows, photos: photoCount });
    res.json({ code: 0, data: { imported: true, total_rows: totalRows, photos: photoCount, results }, message: `导入完成: ${totalRows} 条记录, ${photoCount} 张照片` });
  } catch (error) {
    log.error('导入', '目录导入失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/category', async (req, res) => {
  try {
    const { category, pregnancy_id } = req.body || {};
    if (!category) {
      return res.json({ code: 1001, data: null, message: '缺少 category 参数' });
    }

    const exportData = { version: '1.0.0', category, exported_at: new Date().toISOString(), tables: {} };

    switch (category) {
      case 'daily_records':
        exportData.tables.daily_record = db.queryAll('SELECT * FROM daily_record' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'diary':
        exportData.tables.diary_entry = db.queryAll('SELECT * FROM diary_entry' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'checkups':
        exportData.tables.prenatal_checkup = db.queryAll('SELECT * FROM prenatal_checkup' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.custom_checkup = db.queryAll('SELECT * FROM custom_checkup' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.checkup_photo = readTable('checkup_photo');
        exportData.tables.checkup_report = readTable('checkup_report');
        exportData.tables.lab_result = readTable('lab_result');
        break;
      case 'checklists':
        const clIds = db.queryAll('SELECT id FROM checklist' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []).map(r => r.id);
        exportData.tables.checklist = clIds.map(id => db.queryOne('SELECT * FROM checklist WHERE id = ?', [id])).filter(Boolean);
        exportData.tables.checklist_item = [];
        for (const cid of clIds) {
          const items = db.queryAll('SELECT * FROM checklist_item WHERE checklist_id = ?', [cid]);
          exportData.tables.checklist_item.push(...items);
        }
        break;
      case 'contractions':
        exportData.tables.contraction_session = db.queryAll('SELECT * FROM contraction_session' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.contraction = readTable('contraction');
        break;
      case 'fetal_movements':
        exportData.tables.fetal_movement_session = db.queryAll('SELECT * FROM fetal_movement_session' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.fetal_movement = readTable('fetal_movement');
        break;
      case 'photos':
        exportData.tables.pregnancy_photo = db.queryAll('SELECT * FROM pregnancy_photo' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'reminders':
        exportData.tables.reminder = db.queryAll('SELECT * FROM reminder' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      case 'habits':
        exportData.tables.habit_checkin = db.queryAll('SELECT * FROM habit_checkin' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        exportData.tables.supplement_checkin = db.queryAll('SELECT * FROM supplement_checkin' + (pregnancy_id ? ' WHERE pregnancy_id = ?' : ''), pregnancy_id ? [pregnancy_id] : []);
        break;
      default:
        return res.json({ code: 1001, data: null, message: `未知分类: ${category}` });
    }

    for (const [k, v] of Object.entries(exportData.tables)) {
      exportData.tables[k] = v;
    }

    log.api('导出', `分类导出: ${category}`);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pregnancy-${category}-${config.localToday()}.json"`);
    res.json({ code: 0, data: exportData, message: 'success' });
  } catch (error) {
    log.error('导出', '分类导出失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/backup-db', async (req, res) => {
  try {
    const dbPath = config.DATABASE_PATH;
    if (!fs.existsSync(dbPath)) {
      return res.json({ code: 1001, data: null, message: '数据库文件不存在' });
    }
    const backupsDir = path.join(config.DATA_DIR || '.', 'backups');
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    // ⚠️ 本模块是「内存 SQLite + 每 30 秒整库落盘」，直接复制文件可能拿到**最多 30 秒前的状态**：
    // 用户刚写完记录就点备份，备份里会少掉最新数据（且毫无提示）。
    // 先强制落盘一次，保证备份内容与当前内存状态一致。
    try { db.saveDb(); } catch (e) { log.warn('备份', `强制落盘失败（备份可能偏旧）: ${e.message}`); }

    const timestamp = config.localFileTimestamp();
    const backupPath = path.join(backupsDir, `backup_${timestamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    const size = fs.statSync(backupPath).size;
    log.api('备份', `数据库备份完成`, { path: backupPath, size });
    res.json({ code: 0, data: { backup_path: backupPath, size, created_at: new Date().toISOString() }, message: '备份成功' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/export/restore-db', async (req, res) => {
  try {
    const backupPath = req.body.backup_path || req.query.backup_path;
    if (!backupPath || !fs.existsSync(backupPath)) {
      return res.json({ code: 1001, data: null, message: '备份文件不存在' });
    }
    // 路径安全校验：仅允许恢复 backups 目录下的 .db 文件
    const resolvedBackup = path.resolve(backupPath);
    const backupsDir = path.join(config.DATA_DIR || '.', 'backups');
    if (!resolvedBackup.startsWith(path.resolve(backupsDir) + path.sep) && resolvedBackup !== path.resolve(backupsDir)) {
      return res.json({ code: 1001, data: null, message: '不允许从该路径恢复数据库' });
    }
    if (!resolvedBackup.endsWith('.db')) {
      return res.json({ code: 1001, data: null, message: '备份文件必须是 .db 格式' });
    }
    const dbPath = config.DATABASE_PATH;
    const backupsDirForPre = path.join(config.DATA_DIR || '.', 'backups');

    const timestamp = config.localFileTimestamp();
    const preRestore = path.join(backupsDirForPre, `pre_restore_${timestamp}.db`);
    // 回滚副本也要先落盘，否则「恢复失败回滚」会把数据退回到最多 30 秒前的状态
    try { db.saveDb(); } catch (e) { log.warn('恢复', `回滚副本落盘失败: ${e.message}`); }
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, preRestore);

    // ⚠️ 本模块是「内存 SQLite + 每 30 秒整库落盘」。
    // 只覆盖文件而不重载内存的话，最迟 30 秒后 saveDb() 就会把**恢复前的旧数据**写回去，
    // 恢复被静默撤销（接口却报成功）。所以：加锁 → 覆盖 → 重载内存；失败则回滚并重载。
    db.lockDb();
    try {
      fs.copyFileSync(resolvedBackup, dbPath);
      await db.reloadFromFile();
    } catch (e) {
      let rolledBack = false;
      try {
        if (fs.existsSync(preRestore)) {
          fs.copyFileSync(preRestore, dbPath);
          await db.reloadFromFile();
          rolledBack = true;
        }
      } catch (e2) {
        log.error('恢复', `回滚失败: ${e2.message}`);
      }
      db.unlockDb();
      return res.json({
        code: 1001, data: null,
        message: `恢复失败（${e.message}）${rolledBack ? '，已回滚到恢复前的数据' : '，且回滚失败，请立即用 ${preRestore} 手动恢复'}`,
      });
    }
    db.unlockDb();

    log.api('恢复', `数据库恢复完成（已重载内存）`, { from: backupPath });
    res.json({ code: 0, data: { restored: true, pre_restore_backup: preRestore }, message: '恢复成功，已立即生效（无需重启）' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/export/backups', async (req, res) => {
  try {
    // 与「备份」及「一键恢复」保持一致：搜 _backupSearchRoots()
    // （含用户授权目录 / 手动确认目录）——否则导出到授权目录的备份在这里看不到。
    const candidates = _backupSearchRoots();
    const allBackups = [];
    for (const base of candidates) {
      if (!fs.existsSync(base)) continue;
      try {
        const dirs = fs.readdirSync(base)
          .filter(f => f.startsWith('backup_'))
          .map(f => {
            const fp = path.join(base, f);
            try { var stat = fs.statSync(fp); return { name: f, path: fp, size: stat.size, created_at: stat.mtime.toISOString() }; }
            catch { return null; }
          })
          .filter(Boolean);
        allBackups.push(...dirs);
      } catch {}
    }
    // 去重（同一目录可能同时命中多个搜索范围），再按时间倒序
    const seenPaths = new Set();
    const uniqueBackups = allBackups.filter((b) => {
      if (seenPaths.has(b.path)) return false;
      seenPaths.add(b.path);
      return true;
    });
    uniqueBackups.sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json({ code: 0, data: uniqueBackups, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/backup', async (req, res) => {
  try {
    const { dir } = req.body || {};
    log.info('export/备份', `POST /backup 开始, userDir=${dir||'(auto)'}`);

    // 确定备份目录：用户指定 > SHARE_DIR/backups > BACKUPS_DIR > DATA_DIR/backups > PHOTOS_DIR/../backups
    var backupBase;
    if (dir && typeof dir === 'string' && dir.trim()) {
      backupBase = path.resolve(dir);
      // 路径安全校验：只允许写到「备份落点 / 用户授权目录 / 共享目录」之内。
      // 老版本这里只做 path.resolve() 不做校验，等于把任意路径写入的入口暴露给了接口调用方。
      if (!_isUnderAnyRoot(backupBase, _exportAllowedRoots())) {
        log.warn('备份', `拒绝导出到未授权目录: ${backupBase}`);
        return res.json({
          code: 1003,
          data: null,
          message: `不允许导出到该目录：${backupBase}\n请先在「飞牛应用中心 → 孕程记 → 设置 → 授权目录」里添加这个文件夹，再回到本页面选择。`,
        });
      }
      log.info('export/备份', `使用用户指定目录: ${backupBase}`);
    } else {
      // 按优先级尝试可写目录：
      // ① 应用共享目录（用户可在文件管理器看到并取走备份）
      // ② 持久化备份目录 ③ 业务数据目录 ④ 照片目录旁
      const candidates = [
        config.SHARE_DIR ? path.join(config.SHARE_DIR, 'backups') : null,
        config.BACKUPS_DIR,
        path.join(config.DATA_DIR || '.', 'backups'),
        path.join(config.PHOTOS_DIR || '.', '..', 'backups'),
      ].filter(Boolean);
      backupBase = null;
      for (const c of candidates) {
        try { fs.mkdirSync(c, { recursive: true }); backupBase = c; break; }
        catch { /* 继续尝试下一个 */ }
      }
      if (!backupBase) {
        return res.json({ code: 1001, data: null, message: '无法创建备份目录，请检查存储权限' });
      }
    }
    const ts = config.localFileTimestamp();
    const backupDir = path.join(backupBase, `backup_${ts}`);
    fs.mkdirSync(backupDir, { recursive: true });

    log.api('备份', '全量备份开始', { dir: backupDir });

    const exportData = {
      version: '2.1.0',
      exported_at: new Date().toISOString(),
      app_name: 'pregnancyjournal',
      tables: {},
      file_manifest: { total: 0, by_type: {} },
      // 文件路径映射表：旧绝对路径 -> 备份中的相对路径（用于跨机器恢复时重写数据库路径）
      // album=相册图片、media=相册视频（须与恢复时的落点分流一致，见下方第 1 步）
      _file_map: { album: {}, media: {}, checkup_photos: {}, checkup_reports: {}, config: {} },
    };

    for (const table of ALL_TABLES) {
      exportData.tables[table] = readTable(table);
    }

    // ====== 工具函数：复制文件到备份目录，只用文件名 ======
    function copyToBackup(srcPath, subDir) {
      if (!srcPath || !fs.existsSync(srcPath)) return null;
      const fileName = path.basename(srcPath);
      const dest = path.join(backupDir, 'files', subDir, fileName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      try {
        if (srcPath !== dest) fs.copyFileSync(srcPath, dest);
        return fileName;
      } catch (e) { log.warn('文件', `复制文件失败 ${src} → ${destDir}`, { error: e.message }); return null; }
    }
    function trackCount(type, n) {
      exportData.file_manifest.total += n;
      if (!exportData.file_manifest.by_type[type]) exportData.file_manifest.by_type[type] = 0;
      exportData.file_manifest.by_type[type] += n;
    }

    let count = 0;

    // ====== 1. 相册媒体 → files/album（图片）/ files/media（视频） ======
    // ⚠️ 视频必须与图片**分流到不同子目录**：恢复时 files/album/ → PHOTOS_DIR、
    // files/media/ → MEDIA_DIR，这与数据库里「视频路径改写到 MEDIA_DIR」的口径一致。
    // 旧实现把视频也塞进 files/album/，恢复后文件落在 photos/ 而记录指向 media/，
    // 只能靠 media-backfill 的文件名自愈兜底才能显示 —— 能救回，但不规范。
    let albumCount = 0;
    let mediaCount = 0;
    const allPhotos = readTable('pregnancy_photo');
    for (const p of allPhotos) {
      if (p.file_path && fs.existsSync(p.file_path)) {
        const isVideo = p.media_type === 'video';
        const fn = copyToBackup(p.file_path, isVideo ? 'media' : 'album');
        if (fn) {
          if (isVideo) { exportData._file_map.media[p.file_path] = fn; mediaCount++; }
          else { exportData._file_map.album[p.file_path] = fn; albumCount++; }
        }
      }
      // 我们自己生成的 `_thumb.jpg` 缩略图是**可再生**的派生文件，不进备份（否则每份备份都会
      // 白白大出几十上百 MB）；恢复之后由 services/media-backfill.js 自动补回来。
      const isDerivedThumb = /_thumb\.jpg$/i.test(p.thumbnail_path || '');
      if (p.thumbnail_path && p.thumbnail_path !== p.file_path && !isDerivedThumb && fs.existsSync(p.thumbnail_path)) {
        const fn = copyToBackup(p.thumbnail_path, 'album');
        if (fn) { exportData._file_map.album[p.thumbnail_path] = `thumb_${fn}`; albumCount++; }
      }
    }
    trackCount('album', albumCount);
    trackCount('media', mediaCount);
    count = 0;

    // ====== 2. 产检照片 → files/checkup_photos/<filename> ======
    const checkupPhotos = readTable('checkup_photo');
    for (const cp of checkupPhotos) {
      if (cp.file_path && fs.existsSync(cp.file_path)) {
        const fn = copyToBackup(cp.file_path, 'checkup_photos');
        if (fn) { exportData._file_map.checkup_photos[cp.file_path] = fn; count++; }
      }
      if (cp.thumbnail_path && cp.thumbnail_path !== cp.file_path && fs.existsSync(cp.thumbnail_path)) {
        const fn = copyToBackup(cp.thumbnail_path, 'checkup_photos');
        if (fn) { exportData._file_map.checkup_photos[cp.thumbnail_path] = `thumb_${fn}`; count++; }
      }
    }
    trackCount('checkup_photos', count); count = 0;

    // ====== 3. 检查报告文件 → files/checkup_reports/<filename> ======
    const checkupReports = readTable('checkup_report');
    for (const cr of checkupReports) {
      if (cr.file_path && fs.existsSync(cr.file_path)) {
        const fn = copyToBackup(cr.file_path, 'checkup_reports');
        if (fn) { exportData._file_map.checkup_reports[cr.file_path] = fn; count++; }
      }
    }
    trackCount('checkup_reports', count);

    // ====== 3b. 日记插图 → files/diary/<filename> ======
    // 日记插图是以 **URL（文件名）** 存在正文 HTML 里的，所以只要保住**同名文件**即可，
    // 不需要改写任何数据库内容。此前完全没纳入备份 ⇒ 恢复后日记里的图会全丢。
    exportData._file_map.diary = {};
    let diaryCount = 0;
    try {
      const diaryDir = path.join(config.PHOTOS_DIR, 'diary');
      const diaryFiles = fs.existsSync(diaryDir) ? fs.readdirSync(diaryDir) : [];
      for (const name of diaryFiles) {
        const src = path.join(diaryDir, name);
        try { if (!fs.statSync(src).isFile()) continue; } catch (e) { continue; }
        const fn = copyToBackup(src, 'diary');
        if (fn) { exportData._file_map.diary[name] = fn; diaryCount += 1; }
      }
    } catch (e) {
      log.warn('文件', `备份日记插图失败: ${e.message}`);
    }
    trackCount('diary', diaryCount);

    // ====== 4. 配置文件 → files/config/ （确保跨机器迁移完整） ======
    // 注意分流：wecom.json 是「可写状态文件」（在 DATA_DIR），
    // 其余是「内置只读知识库」（在 ASSETS_DIR）。
    // ⚠️ 必须与上面的 WRITABLE_CONFIG_FILES 保持同步：
    // 这里漏一个，该配置就**不进备份**（用户填的推送地址/密钥恢复后丢失）；
    // 那边漏一个，恢复时会写错目录（落到安装目录、下次升级被冲掉）。
    // 飞书渠道两个都漏了，2026-09-26 一并补上。
    const configSources = [
      { name: 'wecom.json', srcPath: path.join(config.DATA_DIR, 'wecom.json') },
      { name: 'feishu.json', srcPath: path.join(config.DATA_DIR, 'feishu.json') },
      { name: 'daily_push_state.json', srcPath: path.join(config.DATA_DIR, 'daily_push_state.json') },
      { name: 'schedule_dates.json', srcPath: path.join(config.DATA_DIR, 'schedule_dates.json') },
      { name: 'trusted_dirs.json', srcPath: path.join(config.DATA_DIR, 'trusted_dirs.json') },
      { name: 'checkup_schedule.json', srcPath: path.join(config.ASSETS_DIR, 'checkup_schedule.json') },
      { name: 'recipes.json', srcPath: path.join(config.ASSETS_DIR, 'recipes.json') },
      { name: 'food_safety_v3.json', srcPath: path.join(config.ASSETS_DIR, 'food_safety_v3.json') },
    ];
    let configCount = 0;
    for (const cf of configSources) {
      if (fs.existsSync(cf.srcPath)) {
        const fn = copyToBackup(cf.srcPath, 'config');
        if (fn) { exportData._file_map.config[cf.name] = fn; configCount++; }
      }
    }
    trackCount('config', configCount);

    fs.writeFileSync(path.join(backupDir, 'data.json'), JSON.stringify(exportData, null, 2));

    let totalRows = 0;
    const stats = {};
    for (const [k, v] of Object.entries(exportData.tables)) {
      stats[k] = v.length;
      totalRows += v.length;
    }

    log.api('备份', '全量备份完成', { dir: backupDir, rows: totalRows, files: exportData.file_manifest.total });
    res.json({
      code: 0,
      data: {
        dir: backupDir,
        total_rows: totalRows,
        files: exportData.file_manifest,
        stats,
        created_at: new Date().toISOString()
      },
      message: `备份完成: ${totalRows} 条记录, ${exportData.file_manifest.total} 个文件`
    });
  } catch (error) {
    log.error('备份', '全量备份失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/restore', async (req, res) => {
  try {
    const { dir } = req.body || {};
    log.info('export/恢复', `POST /restore 开始, dir=${dir}`);
    if (!dir) return res.json({ code: 1001, data: null, message: '请指定恢复目录路径' });
    const restoreDir = path.resolve(dir);
    if (!fs.existsSync(restoreDir)) return res.json({ code: 1001, data: null, message: '目录不存在: ' + restoreDir });
    // 路径安全校验：沿用「备份搜索范围」（= 备份落点 ∪ 授权目录 ∪ 手动确认目录 ∪ 共享目录），
    // 与 POST /backup 的可写范围、GET /export/backups 的可见范围三方对齐；
    // 否则会出现「导出到授权目录成功 → 列表能看见 → 点恢复却说超出范围」。
    if (!_isUnderAnyRoot(restoreDir, _backupSearchRoots())) {
      return res.json({ code: 1001, data: null, message: '不允许从该目录恢复，超出备份目录范围' });
    }

    const dataFile = path.join(restoreDir, 'data.json');
    if (!fs.existsSync(dataFile)) return res.json({ code: 1001, data: null, message: '目录中没有 data.json 文件' });

    log.api('恢复', '全量恢复开始', { dir: restoreDir });
    db.lockDb();
    let importData;
    try {
      importData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    } catch (parseErr) {
      db.unlockDb();
      return res.json({ code: 1001, data: null, message: '备份文件格式错误或已损坏: ' + parseErr.message });
    }
    if (!importData || !importData.tables || typeof importData.tables !== 'object') {
      db.unlockDb();
      return res.json({ code: 1001, data: null, message: '备份文件数据结构无效，缺少 tables 字段' });
    }

    // ====== 1. 导入数据库表数据（事务保护） ======
    let totalRows = 0;
    const results = {};
    try {
      db.getDb().run('BEGIN TRANSACTION');
      for (const [table, rows] of Object.entries(importData.tables || {})) {
        if (ALL_TABLES.includes(table) && Array.isArray(rows)) {
          // 与 /restore-latest 保持一致：**先清空该表再按备份写入**（=「恢复到该备份的状态」）。
          // 原实现只做 INSERT OR REPLACE（合并语义）：备份之后新建的记录不会消失，
          // 用户会以为"我恢复过了"却发现数据没变回去 —— 两个恢复入口语义不同，极易误解。
          // 空数组时跳过（与 /restore-latest 一致）：旧版备份里缺的表/空表不应把现有数据清空。
          if (rows.length > 0) db.run(`DELETE FROM ${table}`);
          const count = writeTable(table, rows);
          results[table] = count;
          totalRows += count;
        }
      }

      // ====== 2. 获取路径映射表（跨机器迁移核心） ======
      const fileMap = importData._file_map || { album: {}, media: {}, checkup_photos: {}, checkup_reports: {}, config: {} };

      // ====== 3. 重写数据库中的绝对路径 → 本机路径 ======
      function rewriteTablePaths(table, pathColumn, mapObj, newBaseDir) {
        const rows = db.queryAll(`SELECT id, ${pathColumn} FROM ${table}`);
        for (const row of rows) {
          const oldPath = row[pathColumn];
          if (oldPath && mapObj[oldPath]) {
            const newPath = path.join(newBaseDir, mapObj[oldPath]);
            db.run(`UPDATE ${table} SET ${pathColumn} = ? WHERE id = ?`, [newPath, row.id]);
          }
        }
      }

      // 3a. 先缓存视频的路径映射（在通用重写前读取原始旧路径）
      // 新版备份把视频放进 _file_map.media；旧备份把视频也放在 _file_map.album —— 两者都要认。
      const videoPathUpdates = [];
      const videoRows = db.queryAll('SELECT id, file_path FROM pregnancy_photo WHERE media_type = \'video\'');
      for (const r of videoRows) {
        const mapped = (fileMap.media && fileMap.media[r.file_path]) || (fileMap.album && fileMap.album[r.file_path]);
        if (r.file_path && mapped) {
          videoPathUpdates.push({ id: r.id, newPath: path.join(config.MEDIA_DIR, mapped) });
        }
      }

      // 3b. 相册照片：file_path + thumbnail_path → PHOTOS_DIR
      rewriteTablePaths('pregnancy_photo', 'file_path', fileMap.album, config.PHOTOS_DIR);
      rewriteTablePaths('pregnancy_photo', 'thumbnail_path', fileMap.album, config.PHOTOS_DIR);

      // 3c. 将视频路径从 PHOTOS_DIR 覆盖到 MEDIA_DIR（必须放在通用重写之后）
      for (const v of videoPathUpdates) {
        db.run('UPDATE pregnancy_photo SET file_path = ? WHERE id = ?', [v.newPath, v.id]);
      }
      // 产检照片
      rewriteTablePaths('checkup_photo', 'file_path', fileMap.checkup_photos, config.PHOTOS_DIR);
      rewriteTablePaths('checkup_photo', 'thumbnail_path', fileMap.checkup_photos, config.PHOTOS_DIR);
      // 检查报告
      rewriteTablePaths('checkup_report', 'file_path', fileMap.checkup_reports, config.PHOTOS_DIR);

      db.getDb().run('COMMIT');
    } catch (txError) {
      try { db.getDb().run('ROLLBACK'); } catch {}
      db.unlockDb();
      log.error('恢复', '全量恢复事务回滚', { error: txError.message });
      return res.json({ code: 1001, data: null, message: `恢复失败（已回滚）: ${txError.message}` });
    }

    // ====== 4. 复制文件到本机对应目录 ======
    let fileCount = 0;

    // 4a. 相册照片 files/album/ → PHOTOS_DIR
    const srcAlbumDir = path.join(restoreDir, 'files', 'album');
    if (fs.existsSync(srcAlbumDir)) {
      fileCount += copyDirFiles(srcAlbumDir, config.PHOTOS_DIR);
    }

    // 4a-2. 相册视频 files/media/ → MEDIA_DIR
    // 新版备份把视频分流到此处；旧备份的视频仍在 files/album/ 里（会被 4a 复制到 PHOTOS_DIR，
    // 再由 media-backfill 按文件名自愈）。两种布局都兼容，不会丢视频。
    const srcMediaDir = path.join(restoreDir, 'files', 'media');
    if (fs.existsSync(srcMediaDir)) {
      fileCount += copyDirFiles(srcMediaDir, config.MEDIA_DIR);
    }

    // 4b. 产检照片 files/checkup_photos/ → PHOTOS_DIR
    const srcCkPhotoDir = path.join(restoreDir, 'files', 'checkup_photos');
    if (fs.existsSync(srcCkPhotoDir)) {
      fileCount += copyDirFiles(srcCkPhotoDir, config.PHOTOS_DIR);
    }

    // 4c. 检查报告 files/checkup_reports/ → PHOTOS_DIR/checkup_reports/
    const srcReportDir = path.join(restoreDir, 'files', 'checkup_reports');
    if (fs.existsSync(srcReportDir)) {
      const destReportDir = path.join(config.PHOTOS_DIR, 'checkup_reports');
      fileCount += copyDirFiles(srcReportDir, destReportDir);
    }

    // 4d. 配置文件 files/config/ → 按类型分流（可写状态 → DATA_DIR；内置资源 → ASSETS_DIR）
    const srcConfigDir = path.join(restoreDir, 'files', 'config');
    fileCount += restoreConfigDir(srcConfigDir);

    // 4d-2. 日记插图 files/diary/ → PHOTOS_DIR/diary/
    // 文件名必须保持原样：日记正文里的 <img src> 存的就是这个文件名，改名会让插图全部失效。
    const srcDiaryDir = path.join(restoreDir, 'files', 'diary');
    if (fs.existsSync(srcDiaryDir)) {
      fileCount += copyDirFiles(srcDiaryDir, path.join(config.PHOTOS_DIR, 'diary'));
    }

    // 4e. 兼容旧版备份结构（files/ 直接递归复制）
    const legacyFilesDir = path.join(restoreDir, 'files');
    if (fs.existsSync(legacyFilesDir) && !importData._file_map) {
      // 只有在没有 _file_map 时才走旧逻辑（说明是旧版备份）
      fileCount += copyDirContentsRecursive(legacyFilesDir, config.PHOTOS_DIR);
    }

    // 4f. 兼容更旧的 photos/media/checkup_reports 目录
    const legacyPhotosDir = path.join(restoreDir, 'photos');
    if (fs.existsSync(legacyPhotosDir)) fileCount += copyDirFiles(legacyPhotosDir, config.PHOTOS_DIR);
    const legacyMediaDir = path.join(restoreDir, 'media');
    if (fs.existsSync(legacyMediaDir)) fileCount += copyDirFiles(legacyMediaDir, config.MEDIA_DIR);
    const legacyReportsDir = path.join(restoreDir, 'checkup_reports');
    if (fs.existsSync(legacyReportsDir)) fileCount += copyDirFiles(legacyReportsDir, path.join(config.PHOTOS_DIR, 'checkup_reports'));

    db.saveDb();
    db.unlockDb();
    log.api('恢复', '全量恢复完成', { rows: totalRows, files: fileCount });
    res.json({
      code: 0,
      data: { total_rows: totalRows, files: fileCount, results },
      message: `恢复完成: ${totalRows} 条记录, ${fileCount} 个文件`
    });
  } catch (error) {
    db.unlockDb();
    log.error('恢复', '全量恢复失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

const CSV_FIELDS = [
  { key: 'record_date', label: '日期' },
  { key: 'weight', label: '体重(kg)' },
  { key: 'bust', label: '胸围(cm)' },
  { key: 'waist', label: '腰围(cm)' },
  { key: 'hip', label: '臀围(cm)' },
  { key: 'blood_pressure_systolic', label: '收缩压' },
  { key: 'blood_pressure_diastolic', label: '舒张压' },
  { key: 'blood_glucose_fasting', label: '空腹血糖' },
  { key: 'blood_glucose_1h', label: '餐后1h血糖' },
  { key: 'blood_glucose_2h', label: '餐后2h血糖' },
  { key: 'body_temperature', label: '体温(℃)' },
  { key: 'fetal_heart_rate', label: '胎心率(bpm)' },
  { key: 'hcg_value', label: 'HCG' },
  { key: 'uric_acid', label: '尿酸(μmol/L)' },
  { key: 'sleep_hours', label: '睡眠时长(h)' },
  { key: 'sleep_quality', label: '睡眠质量' },
  { key: 'water_intake', label: '饮水量(ml)' },
  { key: 'exercise_type', label: '运动类型' },
  { key: 'exercise_duration', label: '运动时长(min)' },
  { key: 'fetal_movement_count', label: '胎动次数' },
  { key: 'fetal_movement_duration', label: '胎动时长(min)' },
  { key: 'contraction_count', label: '宫缩次数' },
  { key: 'mood', label: '心情(1-5)' },
  { key: 'mood_note', label: '心情备注' },
  { key: 'symptoms', label: '症状' },
  { key: 'diet_note', label: '饮食备注' },
  { key: 'medication', label: '用药记录' },
  { key: 'supplement_record', label: '营养补充' },
  { key: 'intimacy_note', label: '爱爱记录' },
  { key: 'stool_record', label: '排便情况' },
  { key: 'note', label: '日记/备注' },
  { key: 'stool', label: '排便' },
  { key: 'edema_level', label: '水肿等级' },
  { key: 'vaginal_discharge', label: '分泌物' },
  { key: 'skin_condition', label: '皮肤状况' },
  { key: 'urination_frequency', label: '尿频' },
  { key: 'hcg_weeks', label: 'HCG孕周' },
  { key: 'uric_acid_period', label: '尿酸周期' },
  { key: 'plan_text', label: '今日计划' },
  { key: 'plan_date', label: '计划日期' },
  { key: 'habit_text', label: '习惯打卡' },
  { key: 'contraction_interval', label: '宫缩间隔(分)' },
  { key: 'contraction_duration', label: '宫缩持续(分)' },
  { key: 'contraction_pain', label: '宫缩疼痛感' },
  { key: 'intimacy_record', label: '爱爱详情' },
];

function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

router.get('/export/csv', verifyAuth, async (req, res) => {
  try {
    const pregnancyId = req.query.pregnancy_id;
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;

    let sql = 'SELECT * FROM daily_record WHERE 1=1';
    const params = [];
    if (pregnancyId) { sql += ' AND pregnancy_id = ?'; params.push(pregnancyId); }
    if (dateFrom) { sql += ' AND record_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND record_date <= ?'; params.push(dateTo); }
    sql += ' ORDER BY record_date ASC';

    const stmt = db.getDb().prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    if (rows.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有可导出的记录数据' });
    }

    const header = CSV_FIELDS.map(f => f.label).join(',');
    const csvLines = [header];
    for (const row of rows) {
      csvLines.push(CSV_FIELDS.map(f => escapeCsv(row[f.key])).join(','));
    }

    const csvContent = '\uFEFF' + csvLines.join('\n');
    const filename = `孕程记_健康记录_${config.localToday()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(csvContent);

    log.api('CSV导出', '成功', { count: rows.length });
  } catch (error) {
    log.error('CSV导出', '失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

function extractTextFromTiptap(jsonContent) {
  try {
    if (!jsonContent) return '';
    const doc = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
    let texts = [];
    function walk(node) {
      if (!node) return;
      if (node.type === 'text' && node.text) texts.push(node.text);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    }
    walk(doc);
    return texts.join('\n');
  } catch { return String(jsonContent || ''); }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ========== PDF 字体查找 ==========
// 查找可用的中文字体。
// ⚠️ .ttc 是「字体集合」，pdfkit 直接注册会在嵌入子集时报
// `this.font.createSubset is not a function`；必须传入具体字族名（第三个参数）。
// 因此优先单字体文件（.ttf/.otf），实在没有才退回 .ttc + 字族名。
// 返回 { path, family } —— family 为 null 表示普通单字体文件。
function findChineseFont() {
  const singleFace = [
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttf',
    '/usr/share/fonts/truetype/arphic/uming.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttf',
    'C:/Windows/Fonts/simhei.ttf',
    'C:/Windows/Fonts/Deng.ttf',
    'C:/Windows/Fonts/simkai.ttf',
    'C:/Windows/Fonts/simfang.ttf',
  ];
  const collections = [
    ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
    ['/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', 'Noto Sans CJK SC'],
    ['/usr/share/fonts/truetype/wqy/wqy-microhei.ttc', 'WenQuanYi Micro Hei'],
    ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 'WenQuanYi Zen Hei'],
    ['/System/Library/Fonts/PingFang.ttc', 'PingFang SC'],
    ['/System/Library/Fonts/STHeiti Light.ttc', 'Heiti SC'],
    ['C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei'],
    ['C:/Windows/Fonts/simsun.ttc', 'SimSun'],
  ];
  for (const fp of singleFace) {
    try { if (fs.existsSync(fp)) return { path: fp, family: null }; } catch { /* next */ }
  }
  for (const [fp, family] of collections) {
    try { if (fs.existsSync(fp)) return { path: fp, family }; } catch { /* next */ }
  }
  return null;
}

// 注册中文字体（兼容 .ttc 集合）
function registerChineseFont(doc, font) {
  if (!font) return false;
  try {
    if (font.family) doc.registerFont('Chinese', font.path, font.family);
    else doc.registerFont('Chinese', font.path);
    return true;
  } catch (e) {
    log.warn('导出', `注册中文字体失败(${font.path}): ${e.message}`);
    return false;
  }
}

// ========== 日记 PDF 导出（真正 PDF） ==========
// 注意：当前实现在内存中累积全部 PDF chunk 后发送。若数据量极大（数百篇长日记/照片），
// 可能占用较多内存。后续可考虑改用流式响应（pipe）以降低内存峰值。
router.get('/export/diary-pdf', verifyAuth, async (req, res) => {
  try {
    const pregnancyId = req.query.pregnancy_id;
    const dateFrom = req.query.date_from;
    const dateTo = req.query.date_to;

    let sql = "SELECT * FROM diary_entry WHERE 1=1";
    const params = [];
    if (pregnancyId) { sql += ' AND pregnancy_id = ?'; params.push(pregnancyId); }
    if (dateFrom) { sql += ' AND entry_date >= ?'; params.push(dateFrom); }
    if (dateTo) { sql += ' AND entry_date <= ?'; params.push(dateTo); }
    sql += ' ORDER BY entry_date ASC';

    const stmt = db.getDb().prepare(sql);
    if (params.length) stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    if (rows.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有可导出的日记内容' });
    }

    const font = findChineseFont();
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 55, right: 55 }, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    // 注册中文字体（.ttc 集合需传字族名）
    const fontOk = registerChineseFont(doc, font);

    const PW = 595.28; // A4 width
    const PH = 841.89; // A4 height
    const ML = 55, MR = 55, MT = 50, MB = 50;
    const CW = PW - ML - MR; // content width
    const fontName = fontOk ? 'Chinese' : 'Helvetica';
    const titleFont = fontName;
    const bodyFont = fontName;

    // ---- 封面页 ----
    doc.fontSize(32).font(titleFont).fillColor('#e91e63')
      .text('🌸 孕程日记', 0, 200, { align: 'center', width: PW });
    doc.moveDown(0.8);
    doc.fontSize(13).fillColor('#666').font(bodyFont)
      .text(`共 ${rows.length} 篇日记`, { align: 'center', width: PW });
    doc.text(`导出时间：${new Date().toLocaleString('zh-CN')}`, { align: 'center', width: PW });
    doc.moveDown(3);

    // ---- 分隔线 + 换页 ----
    doc.addPage();

    const moodMap = { '1': '😢 很差', '2': '😔 不好', '3': '😐 一般', '4': '😊 不错', '5': '😄 很好' };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const plainText = extractTextFromTiptap(row.content);

      // 检查剩余空间，不够则换页
      if (doc.y > PH - MB - 120) doc.addPage();

      // 日期标签（圆角矩形背景）
      const dateStr = String(row.entry_date || '');
      const weekStr = row.gestational_week ? String(row.gestational_week) : '';
      const moodStr = row.mood ? (moodMap[row.mood] || row.mood) : '';

      // 绘制日期背景条
      const startY = doc.y;
      doc.save();
      doc.roundedRect(ML, startY, CW, 24, 4).fill('#fce4ec');
      doc.restore();

      doc.font(titleFont).fontSize(12).fillColor('#c2185b')
        .text(dateStr, ML + 10, startY + 5, { continued: true, width: CW - 20 });

      if (weekStr) {
        doc.font(bodyFont).fontSize(10).fillColor('#999')
          .text(`  (${weekStr})`, { continued: moodStr ? true : false });
      }
      if (moodStr) {
        doc.font(bodyFont).fontSize(10).fillColor('#666')
          .text(`  ${moodStr}`);
      }

      doc.y = startY + 30;
      doc.moveDown(0.3);

      // 正文内容 - 左侧色条 + 文字区域
      const bodyStartY = doc.y;
      doc.save();
      doc.font(bodyFont).fontSize(12).fillColor('#333')
        .text(plainText || '(无内容)', ML + 14, bodyStartY, {
          width: CW - 18,
          lineGap: 5,
        });
      const bodyEndY = doc.y;
      // 色条高度 = 正文实际高度，最少 30pt
      const barHeight = Math.max(30, bodyEndY - bodyStartY);
      doc.save();
      doc.rect(ML, bodyStartY, 3, barHeight).fill('#e91e63');
      doc.restore();

      doc.moveDown(0.8);

      // 条目间分隔线
      if (i < rows.length - 1) {
        doc.save();
        doc.moveTo(ML, doc.y).lineTo(PW - MR, doc.y)
          .strokeColor('#f0f0f0').lineWidth(1).stroke();
        doc.restore();
        doc.moveDown(0.5);
      }
    }

    // ---- 页脚（每页添加） ==========
    const pages = doc.bufferedPageRange();
    for (let p = 0; p < pages.count; p++) {
      doc.switchToPage(p);
      doc.font(bodyFont).fontSize(9).fillColor('#bbb')
        .text(`— 孕程记 v${config.APP_VERSION || '0.0.28'} —   第 ${p + 1} / ${pages.count} 页`,
          ML, PH - 35, { align: 'center', width: CW });
    }

    // ⚠️ 下面两个回调在 try/catch 之外执行，抛出即 uncaughtException
    // → server.js 的 process.exit(1) → 整个应用白板（历史事故就是这里）。
    // 触发场景：① 客户端中途断开（导出大相册时切页/关标签）→ res 已关闭或头已发送；
    //           ② pdfkit 内部错误（如字体子集）→ 无 error 监听会被 Node 抛成未处理事件。
    doc.on('error', (e) => {
      log.error('日记PDF导出', 'pdfkit 流错误', { error: e.message });
      if (!res.headersSent) {
        try { res.json({ code: 1001, data: null, message: e.message }); } catch (_) { /* 客户端已断开 */ }
      }
    });

    doc.end();

    // 等待流结束再发送响应
    doc.on('end', () => {
      try {
        const pdfBuf = Buffer.concat(chunks);
        const filename = `孕程记_日记_${config.localToday()}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Length', pdfBuf.length);
        res.send(pdfBuf);
        log.api('日记PDF导出', '成功', { count: rows.length, size: pdfBuf.length });
      } catch (e) {
        // 客户端断开时 setHeader/send 会抛 ERR_HTTP_HEADERS_SENT，绝不能让它在回调里冒泡
        log.error('日记PDF导出', '响应失败', { error: e.message });
        if (!res.headersSent) {
          try { res.json({ code: 1001, data: null, message: e.message }); } catch (_) { /* ignore */ }
        }
      }
    });
  } catch (error) {
    log.error('日记PDF导出', '失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

// ========== 纪念相册 PDF 导出 ==========
// 注意：同 diary-pdf，大量照片时内存占用较高，后续可改用流式响应优化
router.get('/export/album-pdf', verifyAuth, async (req, res) => {
  try {
    const pregnancyId = req.query.pregnancy_id;

    let sql = 'SELECT * FROM pregnancy_photo WHERE media_type = \'photo\'';
    const params = [];
    if (pregnancyId) { sql += ' AND pregnancy_id = ?'; params.push(pregnancyId); }
    sql += ' ORDER BY gestational_week ASC, gestational_day ASC, created_at ASC';

    const stmt = db.getDb().prepare(sql);
    if (params.length) stmt.bind(params);
    const photos = [];
    while (stmt.step()) photos.push(stmt.getAsObject());
    stmt.free();

    if (photos.length === 0) {
      return res.json({ code: 1001, data: null, message: '没有可导出的照片' });
    }

    const font = findChineseFont();
    const doc = new PDFDocument({ size: 'A4', margins: { top: 45, bottom: 45, left: 45, right: 45 }, bufferPages: true });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    const fontOk = registerChineseFont(doc, font);

    const PW = 595.28, PH = 841.89;
    const ML = 45, MR = 45, MT = 45, MB = 45;
    const CW = PW - ML - MR;
    const fontName = fontOk ? 'Chinese' : 'Helvetica';

    // ---- 封面 ----
    doc.fontSize(32).font(fontName).fillColor('#7b1fa2')
      .text('📷 孕程纪念相册', 0, 200, { align: 'center', width: PW });
    doc.moveDown(0.8);
    doc.fontSize(13).fillColor('#666').font(fontName)
      .text(`共 ${photos.length} 张珍贵瞬间`, { align: 'center', width: PW });
    doc.text(`生成时间：${new Date().toLocaleString('zh-CN')}`, { align: 'center', width: PW });
    doc.moveDown(3);

    doc.addPage();

    // ---- 每张照片一页 ----
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];

      // 分页保护：如果剩余空间不足则换页
      if (doc.y > PH - MB - 450) doc.addPage();

      // 标题区：孕周信息
      const weekLabel = photo.gestational_week != null
        ? `第 ${photo.gestational_week} 周` + (photo.gestational_day ? `+${photo.gestational_day} 天` : '')
        : '';
      const typeLabel = photo.milestone_type || photo.photo_type || '';

      doc.font(fontName).fontSize(16).fillColor('#7b1fa2')
        .text(`${weekLabel}${typeLabel ? ' · ' + typeLabel : ''}`, ML, MT, { width: CW });

      // 日期
      const photoDate = photo.created_at ? photo.created_at.slice(0, 10) : '';
      if (photoDate) {
        doc.font(fontName).fontSize(10).fillColor('#999')
          .text(photoDate, ML, doc.y + 2, { width: CW });
      }
      doc.moveDown(0.5);

      // 图片区域
      const imgX = ML;
      const imgY = doc.y;
      const imgW = CW;
      const imgH = 380; // 固定图片高度

      // 依次尝试：原图 → 缩略图。
      // pdfkit 只能嵌 JPEG / PNG（其它格式直接抛 Unknown image format），所以 WebP/GIF/BMP/AVIF 这类
      // 原图嵌不进去时，退而用我们的 JPEG 缩略图 —— 总比整页留个「图片无法加载」的框强。
      const candidates = [photo.file_path, photo.thumbnail_path]
        .filter((p, i, arr) => !!p && arr.indexOf(p) === i);
      let embedded = false;
      for (const imgPath of candidates) {
        if (!fs.existsSync(imgPath)) continue;
        try {
          doc.image(imgPath, imgX, imgY, { width: imgW, height: imgH, fit: [imgW, imgH], align: 'center', valign: 'center' });
          embedded = true;
          break;
        } catch (e) {
          log.warn('相册PDF', `嵌入失败，尝试下一个候选: ${path.basename(imgPath)} (${e.message})`);
        }
      }
      if (!embedded) {
        const anyExists = candidates.some((p) => fs.existsSync(p));
        doc.save();
        doc.rect(imgX, imgY, imgW, imgH).fillAndStroke('#f5f5f5', '#ddd');
        doc.font(fontName).fontSize(12).fillColor('#999')
          .text(anyExists ? '[这张照片的格式无法放进 PDF]' : '[图片文件不存在]', imgX, imgY + imgH / 2 - 8, { width: imgW, align: 'center' });
        doc.restore();
      }

      // 描述文字
      const descY = imgY + imgH + 12;
      if (photo.note) {
        doc.font(fontName).fontSize(11).fillColor('#555')
          .text(String(photo.note), ML, descY, { width: CW, lineGap: 3 });
      }

      // 页码角标
      doc.font(fontName).fontSize(9).fillColor('#ccc')
        .text(`${i + 1} / ${photos.length}`, PW - MR - 40, PH - MB - 5, { width: 60, align: 'right' });

      if (i < photos.length - 1) doc.addPage();
    }

    // ---- 尾页 ----
    doc.addPage();
    doc.fontSize(22).font(fontName).fillColor('#7b1fa2')
      .text('— 全文完 —', 0, 300, { align: 'center', width: PW });
    doc.moveDown(2);
    doc.fontSize(11).fillColor('#999')
      .text(`共 ${photos.length} 张照片`, { align: 'center', width: PW });

    // ---- 页脚 ----
    const pages = doc.bufferedPageRange();
    for (let p = 0; p < pages.count; p++) {
      doc.switchToPage(p);
      doc.font(fontName).fontSize(9).fillColor('#bbb')
        .text(`— 孕程记 v${config.APP_VERSION || '0.0.28'} —   第 ${p + 1} / ${pages.count} 页`,
          ML, PH - 35, { align: 'center', width: CW });
    }

    // ⚠️ 同日记 PDF：回调在 try/catch 之外，必须自带保护（详见上方注释）
    doc.on('error', (e) => {
      log.error('相册PDF导出', 'pdfkit 流错误', { error: e.message });
      if (!res.headersSent) {
        try { res.json({ code: 1001, data: null, message: e.message }); } catch (_) { /* 客户端已断开 */ }
      }
    });

    doc.end();

    doc.on('end', () => {
      try {
        const pdfBuf = Buffer.concat(chunks);
        const filename = `孕程记_纪念相册_${config.localToday()}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Length', pdfBuf.length);
        res.send(pdfBuf);
        log.api('相册PDF导出', '成功', { count: photos.length, size: pdfBuf.length });
      } catch (e) {
        log.error('相册PDF导出', '响应失败', { error: e.message });
        if (!res.headersSent) {
          try { res.json({ code: 1001, data: null, message: e.message }); } catch (_) { /* ignore */ }
        }
      }
    });
  } catch (error) {
    log.error('相册PDF导出', '失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

// 校验并记住一个「手动指定的导出目录」。
// 只接受真实可写的目录：做一次真实写入再删除，写不进去就明确告诉用户
// 「应用没有这个目录的写权限」以及该去哪里授权，而不是让他导出时才发现失败。
router.post('/trust-dir', async (req, res) => {
  try {
    const { dir } = req.body || {};
    if (!dir || typeof dir !== 'string' || !dir.trim()) {
      return res.json({ code: 1001, data: null, message: '请填写目录路径' });
    }
    const target = path.resolve(dir.trim());

    if (!fs.existsSync(target)) {
      return res.json({ code: 1001, data: null, message: `目录不存在：${target}` });
    }
    let isDir = false;
    try { isDir = fs.statSync(target).isDirectory(); } catch (e) { /* 下面统一报错 */ }
    if (!isDir) {
      return res.json({ code: 1001, data: null, message: `这不是一个目录：${target}` });
    }

    const probe = path.join(target, `.pj_write_test_${Date.now()}`);
    try {
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
    } catch (e) {
      log.warn('导出', `手动目录写入测试失败: ${target}`, { error: e.message });
      return res.json({
        code: 1002,
        data: null,
        message: `应用没有「${target}」的写权限。请在「飞牛应用中心 → 孕程记 → 设置 → 授权目录」里把该文件夹加入授权，或换一个位置。`,
      });
    }

    const list = _readTrustedDirs();
    if (!list.includes(target)) list.push(target);
    _writeTrustedDirs(list);
    log.api('导出', '已确认并记住手动指定的导出目录', { dir: target });

    res.json({ code: 0, data: { dir: target, trusted_dirs: _readTrustedDirs() }, message: '目录可写，已加入可用位置' });
  } catch (error) {
    log.error('导出', 'trust-dir 失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});

// 设置页首屏用：告诉前端「默认备份落在哪」「用户授权了哪些目录」。
// 目的是让上层能区分两种状态——还没授权（给操作引导）/ 已授权（直接列出来可选）。
router.get('/storage-info', (req, res) => {
  try {
    const shareDir = config.SHARE_DIR || '';
    const shareBackups = shareDir ? path.join(shareDir, 'backups') : '';

    // 默认备份落点 = 后端 /backup 不带 dir 时会用的那个目录（与候选顺序保持一致）
    const candidates = [
      shareBackups || null,
      config.BACKUPS_DIR,
      path.join(config.DATA_DIR || '.', 'backups'),
    ].filter(Boolean);
    let defaultBackupDir = '';
    for (const c of candidates) {
      try { fs.mkdirSync(c, { recursive: true }); fs.accessSync(c, fs.constants.W_OK); defaultBackupDir = c; break; }
      catch { /* 试下一个 */ }
    }

    let shareBackupsWritable = false;
    if (shareBackups) {
      try { fs.mkdirSync(shareBackups, { recursive: true }); fs.accessSync(shareBackups, fs.constants.W_OK); shareBackupsWritable = true; }
      catch { /* 无写权限 */ }
    }

    const authorizedDirs = _accessibleRoots().map(p => {
      let canRW = false;
      let exists = false;
      try { exists = fs.existsSync(p); } catch { /* 访问失败 */ }
      try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch { /* 可读不可写 */ }
      return { path: p, name: path.basename(p) || p, canRW, exists };
    });

    res.json({
      code: 0,
      data: {
        share_dir: shareDir,
        default_backup_dir: defaultBackupDir,
        share_backups_writable: shareBackupsWritable,
        authorized_dirs: authorizedDirs,
        // 用户手动指定、写入测试通过的目录
        trusted_dirs: _readTrustedDirs(),
        // manifest 的 disable_authorization_path=false ⇒ 应用设置页有「授权目录」入口
        authorization_enabled: true,
        // 授权目录读不到时的排查依据，界面上有个「点这里排查」可以直接看
        diag: _buildDiagnostics(),
      },
      message: 'success',
    });
  } catch (error) {
    log.error('存储信息', error.message);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/browse-dir', (req, res) => {
  try {
    let dirPath = req.query.path || '/';

    // 先解码 URL 编码（防止 %2e%2e 等编码绕过）
    try { dirPath = decodeURIComponent(dirPath); } catch {}

    const isRootQuery = (dirPath === '/' || dirPath === '');

    // 安全校验 1：禁止路径遍历和敏感目录访问
    const normalized = path.normalize(dirPath).replace(/\\/g, '/');
    const sensitivePatterns = ['/etc/', '/proc', '/sys/', '/dev/', 'C:\\Windows\\', 'C:\\Program Files', 'C:\\ProgramData'];
    const isSensitive = sensitivePatterns.some(p => normalized.startsWith(p) || normalized.toLowerCase().startsWith(p.toLowerCase()));
    if (isSensitive) {
      return res.json({ code: 1001, data: null, message: '不允许访问系统敏感目录' });
    }

    // 安全校验 3：收集允许的根目录列表，用于后续路径锚定校验
    const allowedRoots = [];

    const roots = [];

    // 飞牛系统：检测用户授权目录 (TRIM_DATA_ACCESSIBLE_PATHS, V1.1.8+)
    const accPaths = _splitPathList(process.env.TRIM_DATA_ACCESSIBLE_PATHS);
    if (accPaths.length) {
      for (const p of accPaths) {
        try {
          if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            let canRW = false;
            try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch {}
            const dirName = path.basename(p) || p;   // 不用 split('/')：Windows 盘符路径里没有 /，会取到整条路径
            roots.push({
              name: `授权-${dirName}`,
              path: p,
              isRoot: true,
              canRW,
              type: 'accessible',
              desc: '用户授权目录',
            });
            allowedRoots.push(p);
          }
        } catch { /* skip */ }
      }
    }

    // 飞牛系统：检测应用共享目录 (TRIM_DATA_SHARE_PATHS / data-share)
    const shPaths = _splitPathList(process.env.TRIM_DATA_SHARE_PATHS);
    if (shPaths.length) {
      for (const p of shPaths) {
        try {
          if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
            let canRW = false;
            try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch {}
            const dirName = path.basename(p) || p;   // 不用 split('/')：Windows 盘符路径里没有 /，会取到整条路径
            roots.push({
              name: `共享-${dirName}`,
              path: p,
              isRoot: true,
              canRW,
              type: 'share',
              desc: '应用共享目录',
            });
            allowedRoots.push(p);
          }
        } catch { /* skip */ }
      }
    }

    // 兜底：用户还没在应用设置里授权任何目录时，仍然可以浏览并选择存储卷
    for (const vol of _volumeRoots()) {
      let canRW = false;
      try { fs.accessSync(vol, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch { /* 只读 */ }
      roots.push({
        name: canRW ? `存储 ${vol}` : `存储 ${vol}（只读）`,
        path: vol,
        isRoot: true,
        canRW,
        type: 'volume',
        desc: canRW ? '存储卷' : '无写权限',
      });
      allowedRoots.push(vol);
    }

    // 用户手动指定过、且写入测试通过的目录（见 POST /trust-dir）
    for (const p of _readTrustedDirs()) {
      try {
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) continue;
        let canRW = false;
        try { fs.accessSync(p, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch { /* 只读 */ }
        roots.push({
          name: `自选-${path.basename(p) || p}`,
          path: p,
          isRoot: true,
          canRW,
          type: 'trusted',
          desc: '你手动指定的目录',
        });
        allowedRoots.push(p);
      } catch { /* skip */ }
    }

    // 开发模式：如果没有找到任何根目录，使用当前工作目录
    if (roots.length === 0) {
      const cwd = process.cwd();
      roots.push({
        name: `工作目录 (${cwd})`,
        path: cwd,
        isRoot: true,
        canRW: true,
        type: 'dev',
        desc: '开发模式默认目录',
      });
      allowedRoots.push(cwd);
    }

    // 安全校验 4（核心防御）：路径锚定 — 确保 dirPath 解析后在允许的根目录内
    const resolvedDir = path.resolve(normalized);
    const isWithinAllowedRoot = allowedRoots.some(root =>
      resolvedDir === path.resolve(root) || resolvedDir.startsWith(path.resolve(root) + path.sep)
    );
    if (!isWithinAllowedRoot && dirPath !== '/') {
      return res.json({ code: 1001, data: null, message: '不允许访问该目录，超出授权范围' });
    }

    // 根请求只用来取「可选的起点目录列表」（roots），不列 / 下面的系统目录
    if (isRootQuery) {
      return res.json({ code: 0, data: { current: '/', items: [], roots, canRW: false } });
    }

    if (!fs.existsSync(dirPath)) {
      return res.json({ code: 0, data: { current: dirPath, items: [], roots, canRW: false } });
    }

    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return res.json({ code: 0, data: { current: dirPath, items: [], roots, canRW: false } });
    }

    let canRW = false;
    try { fs.accessSync(dirPath, fs.constants.R_OK | fs.constants.W_OK); canRW = true; } catch {}

    const items = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => {
        const fullPath = path.join(dirPath, d.name);
        let itemCanRW = false;
        try { fs.accessSync(fullPath, fs.constants.R_OK | fs.constants.W_OK); itemCanRW = true; } catch {}
        return {
          name: d.name,
          path: fullPath,
          isDir: true,
          canRW: itemCanRW,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    res.json({ code: 0, data: { current: dirPath, items, roots, canRW } });
  } catch (error) {
    log.error('目录浏览', error.message);
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;

// ========== 一键恢复（自动查找最新备份） ==========
router.post('/restore-latest', async (req, res) => {
  try {
    log.info('export/恢复', `POST /restore-latest 开始（一键恢复）`);
    // 与 GET /export/backups 共用同一份搜索范围（含用户授权目录 / 手动确认目录），
    // 否则「导出备份到指定位置」产生的备份在这里找不到。
    const candidates = _backupSearchRoots();

    let latestBackup = null;
    for (const base of candidates) {
      if (!fs.existsSync(base)) continue;
      try {
        const dirs = fs.readdirSync(base)
          .filter(name => name.startsWith('backup_'))
          .map(name => ({ name, mtime: fs.statSync(path.join(base, name)).mtime }))
          .sort((a, b) => b.mtime - a.mtime);
        if (dirs.length > 0) {
          const candidate = path.join(base, dirs[0].name);
          // 取所有候选中最新的
          if (!latestBackup || fs.statSync(candidate).mtime > fs.statSync(latestBackup).mtime) {
            latestBackup = candidate;
          }
        }
      } catch { /* 继续下一个 */ }
    }

    if (!latestBackup) {
      return res.json({ code: 1001, data: null, message: '未找到任何备份，请先创建备份' });
    }
    log.api('恢复', '一键恢复开始', { dir: latestBackup });

    // 读取 data.json
    const dataFile = path.join(latestBackup, 'data.json');
    if (!fs.existsSync(dataFile)) {
      return res.json({ code: 1001, data: null, message: '备份数据损坏：缺少 data.json' });
    }

    let importData;
    try {
      importData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    } catch (parseErr) {
      return res.json({ code: 1001, data: null, message: '备份文件格式错误或已损坏: ' + parseErr.message });
    }
    if (!importData || !importData.tables || typeof importData.tables !== 'object') {
      return res.json({ code: 1001, data: null, message: '备份数据结构无效，缺少 tables 字段' });
    }

    // ⚠️ 加锁必须放在**所有校验通过之后**。
    // 锁定后 db.js 里的 30 秒自动落盘（setInterval(saveDb)）会被 saveDb 的
    // `if (_savingDb || _dbLocked) return;` 直接跳过；一旦某个提前 return 漏了解锁，
    // 此后所有写入就只进内存、永不落盘，而接口仍然返回成功 —— 静默数据丢失。
    // （2026-09-23 修的正是这个：本函数原先在"缺 data.json""JSON 解析失败"两个分支漏解锁。）
    // 与 POST /restore 的加锁位置保持一致，不要再往上挪。
    db.lockDb();

    // ====== 1. 清空表并重新插入 + 2. 路径重写（全量事务保护） ======
    let totalRows = 0;
    const results = {};
    let restoreOk = false;

    try {
      db.getDb().run('BEGIN TRANSACTION');

      for (const [table, rows] of Object.entries(importData.tables)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        try {
          db.run(`DELETE FROM ${table}`);
          if (rows.length > 0) {
            // 使用白名单过滤列名，防止备份数据包含恶意/多余列
            const sanitizedRows = rows.map(r => sanitizeColumns(table, r)).filter(Boolean);
            if (sanitizedRows.length > 0) {
              const insertStmt = prepareInsertStatement(table, sanitizedRows[0]);
              for (const row of sanitizedRows) {
                db.run(insertStmt.sql, insertStmt.params(row));
              }
            }
          }
          results[table] = rows.length;
          totalRows += rows.length;
        } catch (e) {
          results[table] = `ERROR: ${e.message}`;
          throw e; // 任一表失败则整体回滚
        }
      }

      // ====== 路径重写（同一事务内） ======
      const fileMap = importData._file_map || { album: {}, media: {}, checkup_photos: {}, checkup_reports: {}, config: {} };

      // 先缓存视频的路径映射（在通用重写前读取原始旧路径）
      // 新版备份把视频放进 _file_map.media；旧备份把视频也放在 _file_map.album —— 两者都要认。
      const videoUpdates = [];
      try {
        const vids = db.queryAll("SELECT id, file_path FROM pregnancy_photo WHERE media_type = 'video'");
        for (const v of vids) {
          const mapped = (fileMap.media && fileMap.media[v.file_path]) || (fileMap.album && fileMap.album[v.file_path]);
          if (v.file_path && mapped) {
            videoUpdates.push({ id: v.id, newPath: path.join(config.MEDIA_DIR, mapped) });
          }
        }
      } catch {}

      function rewritePaths(table, col, mapObj, baseDir) {
        try {
          const rows = db.queryAll(`SELECT id, ${col} FROM ${table}`);
          for (const row of rows) {
            const oldPath = row[col];
            if (oldPath && mapObj[oldPath]) {
              db.run(`UPDATE ${table} SET ${col} = ? WHERE id = ?`, [path.join(baseDir, mapObj[oldPath]), row.id]);
            }
          }
        } catch {}
      }
      rewritePaths('pregnancy_photo', 'file_path', fileMap.album, config.PHOTOS_DIR);
      rewritePaths('pregnancy_photo', 'thumbnail_path', fileMap.album, config.PHOTOS_DIR);

      // 将视频路径覆盖到 MEDIA_DIR
      for (const vu of videoUpdates) {
        db.run("UPDATE pregnancy_photo SET file_path = ? WHERE id = ?", [vu.newPath, vu.id]);
      }
      rewritePaths('checkup_photo', 'file_path', fileMap.checkup_photos, config.PHOTOS_DIR);
      rewritePaths('checkup_photo', 'thumbnail_path', fileMap.checkup_photos, config.PHOTOS_DIR);
      rewritePaths('checkup_report', 'file_path', fileMap.checkup_reports, config.PHOTOS_DIR);

      db.getDb().run('COMMIT');
      restoreOk = true;
    } catch (txError) {
      try { db.getDb().run('ROLLBACK'); } catch {}
      db.unlockDb();
      log.error('恢复', '一键恢复事务回滚', { error: txError.message });
      return res.json({ code: 1001, data: null, message: `恢复失败（已回滚）: ${txError.message}` });
    }

    // ====== 3. 文件恢复（按类型分发到正确目录，与 restore 一致） ======
    let fileCount = 0;

    // 相册照片 → PHOTOS_DIR
    const srcAlbum = path.join(latestBackup, 'files', 'album');
    if (fs.existsSync(srcAlbum)) fileCount += copyDirFiles(srcAlbum, config.PHOTOS_DIR);
    // 相册视频 → MEDIA_DIR（新版备份的分流目录；旧备份的视频在 files/album/ 里，靠自愈兜底）
    const srcMedia = path.join(latestBackup, 'files', 'media');
    if (fs.existsSync(srcMedia)) fileCount += copyDirFiles(srcMedia, config.MEDIA_DIR);
    // 产检照片 → PHOTOS_DIR
    const srcCkPhoto = path.join(latestBackup, 'files', 'checkup_photos');
    if (fs.existsSync(srcCkPhoto)) fileCount += copyDirFiles(srcCkPhoto, config.PHOTOS_DIR);
    // 检查报告 → PHOTOS_DIR/checkup_reports/
    const srcReport = path.join(latestBackup, 'files', 'checkup_reports');
    if (fs.existsSync(srcReport)) fileCount += copyDirFiles(srcReport, path.join(config.PHOTOS_DIR, 'checkup_reports'));
    // 配置文件 → 按类型分流（可写状态 → DATA_DIR；内置资源 → ASSETS_DIR）
    const srcConfig = path.join(latestBackup, 'files', 'config');
    fileCount += restoreConfigDir(srcConfig);

    // 日记插图 → PHOTOS_DIR/diary/
    // 文件名必须保持原样：日记正文的 <img src> 存的就是这个文件名，改名会让插图全部失效。
    // ⚠️ 这一步原来只在 /restore 里有、/restore-latest 漏了 ⇒ 用户用「一键恢复」时
    // 日记正文回来了但插图全 404（同一功能两个平行实现、改一处漏一处的老毛病）。
    const srcDiaryDir = path.join(latestBackup, 'files', 'diary');
    if (fs.existsSync(srcDiaryDir)) {
      fileCount += copyDirFiles(srcDiaryDir, path.join(config.PHOTOS_DIR, 'diary'));
    }

    // 兼容旧版备份（无 _file_map 时递归复制）
    const filesDir = path.join(latestBackup, 'files');
    if (fs.existsSync(filesDir) && !importData._file_map) {
      fileCount += copyDirContentsRecursive(filesDir, config.PHOTOS_DIR);
    }

    db.saveDb();
    db.unlockDb();
    log.api('恢复', '一键恢复完成', { dir: latestBackup, rows: totalRows, files: fileCount });
    res.json({
      code: 0,
      data: { restored_rows: totalRows, files: fileCount, backup_dir: latestBackup, results },
      message: `恢复完成：${totalRows} 条记录，${fileCount} 个文件（来自 ${path.basename(latestBackup)}）`
    });
  } catch (error) {
    db.unlockDb();
    log.error('恢复', '一键恢复失败', { error: error.message });
    res.json({ code: 1001, data: null, message: error.message });
  }
});
