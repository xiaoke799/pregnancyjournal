const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const log = require('./logger');

let db = null;
let SQLModule = null;   // 缓存 sql.js 构造器，供 reloadFromFile() 复用

// ============ 运行时状态 ============
let _savingDb = false;      // 同步落盘进行中（业务路径专用）
let _savingDbAsync = false; // 异步落盘进行中（仅 30 秒定时器专用）
// 成功落盘的次数。异步落盘是「先 export 快照 → 再异步写盘」，写完之前业务可能已经
// 同步落盘了更新的数据（备份/导出就是这么干的）。此时异步若照常 rename，
// 就会把旧快照盖回去 —— 刚才那次同步落盘等于白写，数据静默回退。
// 异步落盘靠这个计数器在 rename 之前发现自己已经过期，直接放弃本轮（等下一个 30 秒）。
let _writeSeq = 0;
let _dbLocked = false; // 数据库锁定标志：恢复/备份等批量操作期间阻止自动保存
// 未结束事务的计数（beginTransaction 后为 1，commit/rollback 后清 0）。
// ⚠️ 为什么需要：db.export() 内部是 close_v2 → readFile → open，**未提交的事务会被整段
// 回滚**（之后 COMMIT 报 "no transaction is active"），而接口仍会回报成功。
// 落盘必须避开事务区间，靠这个计数判断。
let _txDepth = 0;
// 最近一次落盘失败。原来只 console.error —— 数据目录运行期消失后每次落盘都静默失败，
// 接口照常报成功，排查只能靠翻控制台。现在记下来并经 /api/health 暴露。
let _lastSaveError = null;
// 启动自检结果：ok=false 表示库不可用（损坏且无备份可用）；recovered_from 表示已回退到备份
let _dbHealth = { ok: true, reason: null, preserved_path: null, recovered_from: null };
// 外键强制是否可用：只有当 checkup_id 那三张错误外键被修掉之后才允许打开。
// 修不掉就把外键强制关掉（退回老行为），绝不能因此让「产检报告上传」失效。
let _fkEnforceAllowed = true;

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
PRAGMA cache_size=-64000;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS pregnancy (
  id TEXT PRIMARY KEY,
  last_period_date TEXT NOT NULL,
  conception_date TEXT,
  due_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  baby_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prenatal_checkup (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  checkup_date TEXT NOT NULL,
  gestational_week INTEGER DEFAULT 0,
  gestational_day INTEGER DEFAULT 0,
  checkup_type TEXT DEFAULT '常规产检',
  weight REAL,
  blood_pressure TEXT,
  fetal_heart_rate INTEGER,
  fundal_height REAL,
  abdominal_circumference REAL,
  hospital TEXT,
  notes TEXT,
  is_completed INTEGER DEFAULT 0,
  is_recommended INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS custom_checkup (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  name TEXT NOT NULL,
  items TEXT,
  checkup_date TEXT,
  notes TEXT,
  is_completed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

-- ⚠️ checkup_photo / checkup_report / lab_result 的 checkup_id **不是** prenatal_checkup.id：
--    · 标准产检：值是排期表（checkup_schedule.json）里的条目 id，形如 cs_001
--    · 自定义产检：值是 custom_checkup.id（UUID）
--    所以这三张表**不能**声明 FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id)。
--    以前写错了也没暴露，是因为外键强制从来没真正生效（db.export() 把 PRAGMA 重置为 OFF）。
--    本版把外键强制修好之后，这个错误外键会让「上传产检报告」直接报
--    FOREIGN KEY constraint failed（100% 失败）——所以一并去掉了。
--    老库由 _repairCheckupIdFks() 重建这三张表（列与数据完全不变）。
CREATE TABLE IF NOT EXISTS checkup_photo (
  id TEXT PRIMARY KEY,
  checkup_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkup_report (
  id TEXT PRIMARY KEY,
  checkup_id TEXT NOT NULL,
  checkup_type TEXT DEFAULT 'standard',
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER DEFAULT 0,
  report_category TEXT DEFAULT '其他',
  sub_item TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lab_result (
  id TEXT PRIMARY KEY,
  checkup_id TEXT NOT NULL,
  category TEXT NOT NULL,
  item_name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  reference_min REAL,
  reference_max REAL,
  status TEXT DEFAULT 'normal',
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_record (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  record_date TEXT NOT NULL,
  weight REAL,
  fetal_heart_rate INTEGER,
  body_temperature REAL,
  bust REAL,
  waist REAL,
  hip REAL,
  blood_glucose_fasting REAL,
  blood_glucose_1h REAL,
  blood_glucose_2h REAL,
  mood TEXT,
  mood_note TEXT,
  stool TEXT,
  stool_record TEXT,
  note TEXT,
  blood_pressure_systolic TEXT,
  blood_pressure_diastolic TEXT,
  sleep_hours REAL,
  sleep_quality TEXT,
  symptoms TEXT,
  exercise_type TEXT,
  exercise_duration INTEGER,
  exercise_intensity TEXT,
  diet_note TEXT,
  medication TEXT,
  edema_level TEXT,
  vaginal_discharge TEXT,
  skin_condition TEXT,
  urination_frequency TEXT,
  hcg_value REAL,
  hcg_weeks INTEGER,
  uric_acid REAL,
  uric_acid_period TEXT,
  supplement_record TEXT,
  intimacy_note TEXT,
  plan_text TEXT,
  plan_date TEXT,
  is_plan_done INTEGER DEFAULT 0,
  water_intake INTEGER,
  habit_text TEXT,
  contraction_count INTEGER,
  contraction_interval INTEGER,
  contraction_duration REAL,
  contraction_pain TEXT,
  fetal_movement_count INTEGER,
  fetal_movement_duration INTEGER,
  intimacy_record TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contraction_session (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT,
  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  total_count INTEGER DEFAULT 0,
  avg_duration REAL,
  avg_interval REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contraction (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration REAL,
  interval_from_prev REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES contraction_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pregnancy_photo (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  checkup_id TEXT,
  photo_type TEXT NOT NULL,
  gestational_week INTEGER,
  gestational_day INTEGER DEFAULT 0,
  milestone_type TEXT,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  note TEXT,
  media_type TEXT DEFAULT 'photo',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diary_entry (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  gestational_week INTEGER DEFAULT 0,
  title TEXT,
  content TEXT NOT NULL,
  mood TEXT,
  image_urls TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checklist (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checklist_item (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT '',
  is_checked INTEGER DEFAULT 0,
  is_custom INTEGER DEFAULT 0,
  is_mandatory INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checklist_id) REFERENCES checklist(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reminder (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  title TEXT NOT NULL,
  priority TEXT DEFAULT 'medium',
  trigger_date TEXT,
  trigger_time TEXT,
  reminder_type TEXT DEFAULT 'custom',
  source_type TEXT,
  source_id TEXT,
  is_enabled INTEGER DEFAULT 1,
  is_triggered INTEGER DEFAULT 0,
  is_completed INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedule_dates (
  pregnancy_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  checkup_date TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pregnancy_id, schedule_id),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fetal_movement_session (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT,
  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  total_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fetal_movement (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES fetal_movement_session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS habit_checkin (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  date TEXT NOT NULL,
  items TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplement_checkin (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  date TEXT NOT NULL,
  items TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

-- 用药 / 营养补充「方案」：用户一次配置，之后每天自动生成待办 + 到点提醒。
-- ⚠️ 为什么不能复用 reminder 表：reminder.is_completed 是**一次性**开关（勾完就永不再提醒），
--    而服药是每天重复的事 —— 用它做每日服药，勾一次后面就再也不提醒，反而更危险。
--    「今天吃没吃」必须由 dose_checkin 按日期记。
CREATE TABLE IF NOT EXISTS dose_plan (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'medication',
  name TEXT NOT NULL,
  dosage TEXT,
  reminder_times TEXT,
  frequency TEXT DEFAULT 'daily',
  weekdays TEXT,
  start_date TEXT,
  end_date TEXT,
  -- 医嘱常按孕周下（"孕20周开始吃钙片""叶酸吃到孕12周"），
  -- 与 start_date/end_date 是**并列约束**（都配了就都要满足），不是二选一。
  start_week INTEGER,
  end_week INTEGER,
  note TEXT,
  is_enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

-- 每日打卡：按「种类」勾（如叶酸），一天一条（plan_id + date 唯一 ⇒ 重复打卡幂等）。
-- 到点提醒会先查这里：**已打卡的当天不再推**。
CREATE TABLE IF NOT EXISTS dose_checkin (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  date TEXT NOT NULL,
  taken_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (pregnancy_id) REFERENCES pregnancy(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_config (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_log (
  id TEXT PRIMARY KEY,
  push_type TEXT NOT NULL,
  push_content TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  pushed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT,
  channel TEXT DEFAULT 'wecom'
);

-- ============ 索引 ============
-- 此前一条索引都没有：热查询全部走全表扫描，记录攒到几百上千行后明显变慢。
-- 覆盖列表/详情/看板最常用的「按孕期 + 日期」「按父记录 id」两类过滤。
-- 注意：SQL 注释只认双短横线，写成双斜杠会让整条语句语法错误（历史踩过）。
CREATE INDEX IF NOT EXISTS idx_daily_record_preg_date ON daily_record (pregnancy_id, record_date);
CREATE INDEX IF NOT EXISTS idx_habit_checkin_preg_date ON habit_checkin (pregnancy_id, date);
CREATE INDEX IF NOT EXISTS idx_supplement_checkin_preg_date ON supplement_checkin (pregnancy_id, date);
CREATE INDEX IF NOT EXISTS idx_dose_plan_preg ON dose_plan (pregnancy_id);
CREATE INDEX IF NOT EXISTS idx_dose_checkin_preg_date ON dose_checkin (pregnancy_id, date);
-- 唯一索引：同一方案同一天只能有一条打卡 ⇒ 重复提交走「已打卡」而不是插两行
CREATE UNIQUE INDEX IF NOT EXISTS idx_dose_checkin_plan_date ON dose_checkin (plan_id, date);
CREATE INDEX IF NOT EXISTS idx_checkup_preg_date ON prenatal_checkup (pregnancy_id, checkup_date);
CREATE INDEX IF NOT EXISTS idx_checkup_photo_checkup ON checkup_photo (checkup_id);
CREATE INDEX IF NOT EXISTS idx_checkup_report_checkup ON checkup_report (checkup_id);
CREATE INDEX IF NOT EXISTS idx_lab_result_checkup ON lab_result (checkup_id);
CREATE INDEX IF NOT EXISTS idx_diary_entry_preg_date ON diary_entry (pregnancy_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_pregnancy_photo_preg ON pregnancy_photo (pregnancy_id);
CREATE INDEX IF NOT EXISTS idx_custom_checkup_preg ON custom_checkup (pregnancy_id);
CREATE INDEX IF NOT EXISTS idx_contraction_session ON contraction (session_id);
CREATE INDEX IF NOT EXISTS idx_fetal_movement_session ON fetal_movement (session_id);
CREATE INDEX IF NOT EXISTS idx_reminder_preg_date ON reminder (pregnancy_id, trigger_date);
CREATE INDEX IF NOT EXISTS idx_checklist_preg ON checklist (pregnancy_id);
CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_log (created_at);
`;

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

/**
 * 从建表语句里解析某个字段声明的类型（REAL / INTEGER / TEXT …）。
 * 补列时必须沿用它在 SCHEMA 里的类型 —— 不能一律用 TEXT：
 * SQLite 是「按列亲和性」存值的，TEXT 列写入数字 92 会被存成字符串 '92'，
 * 读回来就是 "92" 而不是 92，前端数字输入框与折线图都会受影响。
 * （实测踩过：老库补出来的 bust/hip 读回来是字符串，新装库是数字。）
 */
function declaredColumnType(table, col) {
  try {
    const tableDef = SCHEMA.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`));
    if (!tableDef) return null;
    const m = tableDef[1].match(new RegExp(`(?:^|\\n)\\s*${col}\\s+([A-Za-z]+)`, 'i'));
    return m ? m[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * 重建 checkup_photo / checkup_report / lab_result，去掉错误的 checkup_id 外键。
 *
 * 【为什么】这三张表的 checkup_id 存的是「排期条目 id（cs_001…）」或
 * 「custom_checkup.id（UUID）」，**不是** prenatal_checkup.id。
 * 老库的建表语句里却写了 `FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id)`。
 * 外键强制一旦生效，往这三张表写数据就会 `FOREIGN KEY constraint failed`
 * ⇒ 产检报告/照片上传 100% 失败。
 *
 * 【做法】按新定义重建表，用**显式列名**整表搬数据（列与数据一个不动），全程在一个事务里；
 * 搬完先比行数、再比**整表内容摘要**，任一不符就整体回滚。
 * 老库只做一次（新定义里没有那句外键，幂等跳过）。
 *
 * 【失败兜底】任何一步出错 ⇒ 回滚 + **保持外键强制关闭**（`_fkEnforceAllowed=false`），
 * 宁可回到「老行为」也不能让上传功能坏掉。
 */
const _CHECKUP_ID_TABLES = {
  checkup_photo: {
    cols: ['id', 'checkup_id', 'file_path', 'thumbnail_path', 'note', 'created_at'],
    ddl: `CREATE TABLE checkup_photo__rebuild (
  id TEXT PRIMARY KEY,
  checkup_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  },
  checkup_report: {
    cols: ['id', 'checkup_id', 'checkup_type', 'filename', 'file_path', 'file_type',
      'mime_type', 'file_size', 'report_category', 'sub_item', 'created_at'],
    ddl: `CREATE TABLE checkup_report__rebuild (
  id TEXT PRIMARY KEY,
  checkup_id TEXT NOT NULL,
  checkup_type TEXT DEFAULT 'standard',
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  mime_type TEXT,
  file_size INTEGER DEFAULT 0,
  report_category TEXT DEFAULT '其他',
  sub_item TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  },
  lab_result: {
    cols: ['id', 'checkup_id', 'category', 'item_name', 'value', 'unit',
      'reference_min', 'reference_max', 'status', 'updated_at', 'created_at'],
    ddl: `CREATE TABLE lab_result__rebuild (
  id TEXT PRIMARY KEY,
  checkup_id TEXT NOT NULL,
  category TEXT NOT NULL,
  item_name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT,
  reference_min REAL,
  reference_max REAL,
  status TEXT DEFAULT 'normal',
  updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`,
  },
};

function _tableRows(t) {
  try {
    const r = db.exec(`SELECT COUNT(*) FROM ${t}`);
    return (r && r[0] && r[0].values[0]) ? Number(r[0].values[0][0]) : 0;
  } catch (e) {
    return -1;
  }
}

/**
 * 整表内容摘要：按主键排序后逐行哈希，用于证明「搬完的数据和搬之前逐字一致」。
 *
 * ⚠️ 为什么光比行数不够：`INSERT INTO ... SELECT *` 是按**位置**对列的，
 * 万一历史库的列顺序和重建定义不同，数据会被静默串到别的列上，而行数**照样相等**
 * —— 行数校验完全拦不住。（已核对到最老快照，这三张表列顺序一直一致；
 * 这里再加一道内容比对，是把「静默串列」变成「直接报错回滚」。）
 * 读取失败返回 null，调用方按失败处理。
 */
function _tableDigest(t, cols) {
  try {
    const r = db.exec(`SELECT ${cols.join(', ')} FROM ${t} ORDER BY id`);
    const h = crypto.createHash('sha256');
    const rows = (r && r[0] && Array.isArray(r[0].values)) ? r[0].values : [];
    h.update(`rows=${rows.length}\n`);
    for (const row of rows) {
      // sql.js 可能给出 undefined（列缺失）；统一成 null 让两侧可比
      h.update(JSON.stringify(row.map(v => (v === undefined ? null : v))));
      h.update('\n');
    }
    return h.digest('hex');
  } catch (e) {
    return null;
  }
}

function _repairCheckupIdFks() {
  let repaired = 0;
  _fkEnforceAllowed = true; // 只有真的修失败（或回滚）时才会被置回 false
  for (const table of Object.keys(_CHECKUP_ID_TABLES)) {
    const def = _CHECKUP_ID_TABLES[table];
    const colList = def.cols.join(', ');
    let ddl = null;
    try {
      const r = db.exec(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${table}'`);
      ddl = (r && r[0] && r[0].values[0]) ? String(r[0].values[0][0]) : null;
    } catch (e) { continue; }
    if (!ddl) continue;                                        // 表还不存在（全新库）→ 跳过
    if (!/REFERENCES\s+prenatal_checkup/i.test(ddl)) continue;  // 已是干净定义 → 幂等跳过

    const beforeCount = _tableRows(table);
    const beforeDigest = _tableDigest(table, def.cols);
    let prevFk = 1;
    try { prevFk = db.exec('PRAGMA foreign_keys')[0].values[0][0] ? 1 : 0; } catch (e) { /* ignore */ }

    try {
      // PRAGMA foreign_keys 在事务内是空操作，必须放在 BEGIN 之前
      db.run('PRAGMA foreign_keys = OFF');
      db.run('BEGIN');
      db.run(`DROP TABLE IF EXISTS ${table}__rebuild`);
      db.run(def.ddl);
      // ⚠️ 显式写列名，不用 `SELECT *`：`SELECT *` 靠位置对列，历史库列顺序一旦不同
      //    就会静默串列；写死列名后，列对不上会**当场报错**而不是悄悄搬错。
      db.run(`INSERT INTO ${table}__rebuild (${colList}) SELECT ${colList} FROM ${table}`);
      db.run(`DROP TABLE ${table}`);
      db.run(`ALTER TABLE ${table}__rebuild RENAME TO ${table}`);
      const afterCount = _tableRows(table);
      const afterDigest = _tableDigest(table, def.cols);
      if (beforeCount !== afterCount) {
        throw new Error(`行数不一致：迁移前 ${beforeCount} 行，迁移后 ${afterCount} 行`);
      }
      if (afterDigest === null || beforeDigest !== afterDigest) {
        throw new Error('内容摘要不一致（疑似列错位）：迁移前后数据不是逐字相同，' +
          `before=${String(beforeDigest).slice(0, 12)} after=${String(afterDigest).slice(0, 12)}`);
      }
      db.run('COMMIT');
      repaired++;
      log.migrate(`已重建 ${table}：去掉错误的 checkup_id 外键（${afterCount} 行数据逐字校验通过）`);
    } catch (e) {
      try { db.run('ROLLBACK'); } catch (e2) { /* ignore */ }
      log.error('数据库', `重建 ${table} 失败，将关闭外键强制以保证产检上传不受影响: ${e.message}`);
      _fkEnforceAllowed = false;
      try { db.run('PRAGMA foreign_keys = 0'); } catch (e2) { /* ignore */ }
      return false;
    }
    try { db.run(`PRAGMA foreign_keys = ${prevFk ? 1 : 0}`); } catch (e) { /* ignore */ }
  }
  if (repaired > 0) log.migrate(`checkup_id 外键修复完成：重建 ${repaired} 张表`);
  return true;
}

function migrateDb() {
  // 仅保留真正不在 SCHEMA 中的列（大多数列已在 CREATE TABLE 中定义）
  // 老库升级时执行 ADD COLUMN；新库因 SCHEMA 已包含则跳过
  const tableCols = {
    // 注：原 prenatal_checkup.schedule_item_id 已移除。
    // 它不在 SCHEMA 里、全代码库零引用（既没人读也没人写），却会在老库升级时被
    // 无条件补出一个 TEXT 列 —— 纯粹的垃圾列。已建过该列的老库不受影响（内容为空、
    // 保留无害），只是不再继续给新老库添加。
    reminder: {
      priority: "medium",          // dashboard 提醒事件优先级（HIGH/MEDIUM/LOW）
    },
    daily_record: {
      waist: null,                 // 腰围记录（v0.0.28 新增）
      bust: null,                  // 胸围（v0.0.29 新增，与 waist/hip 合称三围）
      hip: null,                   // 臀围（v0.0.29 新增）
      exercise_intensity: null,    // 运动强度感受（轻松/中等/较累，v0.0.33 新增）
    },
    push_log: {
      payload: null,               // 推送正文（重试时原样重发，v0.0.28 新增）
      channel: 'wecom',            // 推送渠道 wecom/feishu（v0.0.28 新增；老记录归为企业微信）
    },
  };

  let migrated = 0;
  for (const [table, cols] of Object.entries(tableCols)) {
    try {
      const existing = queryAll(`PRAGMA table_info(${table})`);
      const existingCols = new Set(existing.map(c => c.name));
      for (const [col, defaultVal] of Object.entries(cols)) {
        if (!existingCols.has(col)) {
          try {
            // 沿用 SCHEMA 里声明的类型（数值列必须是 REAL/INTEGER，不能用 TEXT —— 见函数注释）
            const colType = declaredColumnType(table, col) || 'TEXT';
            db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${colType}`);
            if (defaultVal !== null) {
              db.run(`UPDATE ${table} SET ${col} = ? WHERE ${col} IS NULL`, [defaultVal]);
            }
            migrated++;
            log.migrate(`添加列 ${col} → ${table}`);
          } catch (e) {
            log.error(`迁移失败 ${table}.${col}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      log.error(`迁移检查表 ${table} 失败: ${e.message}`);
    }
  }
  try {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    db.run(`UPDATE app_config SET created_at = ? WHERE created_at IS NULL`, [now]);
    db.run(`UPDATE app_config SET updated_at = ? WHERE updated_at IS NULL`, [now]);
  } catch (e) {}
  if (migrated > 0) {
    log.migrate(`完成: 共迁移 ${migrated} 个字段`);
  } else {
    log.db('无需迁移');
  }
}

/** 执行建表语句 + 结构迁移。initDb 与 reloadFromFile 共用（两条语句都幂等）。 */
function applySchemaAndMigrate() {
  // ⚠️ 必须在「执行 SCHEMA（含 PRAGMA foreign_keys=ON）」之前做：
  //    此刻连接级外键开关还是默认的 OFF，重建表不会被任何外键约束干扰。
  //    全新库里这三张表还不存在 ⇒ 直接跳过，由下面的 SCHEMA 建成干净定义。
  _repairCheckupIdFks();

  // SCHEMA 含多条语句，逐条执行（run() 只支持单条）
  // 每条独立 try/catch，防止单条失败阻断后续表创建
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  let schemaOk = 0, schemaFail = 0;
  const failed = [];
  for (const stmt of statements) {
    try {
      db.run(stmt);
      schemaOk++;
    } catch (e) {
      schemaFail++;
      if (failed.length < 3) failed.push({ sql: stmt.substring(0, 60), error: e.message });
      console.error('[db] Schema 语句失败:', e.message, '| 语句:', stmt.substring(0, 80));
    }
  }
  if (schemaFail > 0) {
    // ⚠️ 这里**不能只打印**：原先 schemaFail 只 console.error，随后仍打印「数据库就绪」，
    // 于是「库文件损坏」表现为「应用正常启动、网关显示健康、但每个请求都失败」，
    // 而且 saveDb() 还会把损坏内容原样写回。现在至少要让状态可见（health + error 日志）。
    log.error('数据库', `Schema 执行完成: ${schemaOk} 成功, ${schemaFail} 失败（数据库可能已损坏）`, {
      firstError: failed[0] && failed[0].error,
      firstStmt: failed[0] && failed[0].sql,
    });
    _dbHealth.ok = false;
    if (!_dbHealth.reason) {
      _dbHealth.reason = `Schema 执行失败 ${schemaFail} 条：${(failed[0] && failed[0].error) || '未知错误'}`;
    }
  } else {
    log.db(`Schema 执行完成: ${schemaOk} 成功, 0 失败`);
  }
  // SCHEMA 里那句 PRAGMA foreign_keys=ON 已经执行过；若前面重建失败，
  // 这里显式把它压回 OFF（退回老行为，保功能）。
  if (!_fkEnforceAllowed) {
    try { db.run('PRAGMA foreign_keys = 0'); log.warn('数据库', '外键强制已关闭（checkup_id 外键修复未成功）'); } catch (e) { /* ignore */ }
  }
  migrateDb();
}

/**
 * 从磁盘上的 .db 文件重新载入内存 —— 供「整库文件替换」式的恢复使用。
 *
 * ⚠️ 为什么必须有它：本模块是「内存 SQLite + 每 30 秒整库落盘」（见 saveDb / setInterval）。
 * 如果只把备份文件覆盖到 config.DATABASE_PATH 而**不重载内存**，
 * 那么下一次 saveDb()（最迟 30 秒后）就会把**恢复之前的旧数据**整库写回去，
 * 恢复被静默撤销 —— 而接口却回报「成功，重启后生效」，用户只会以为备份有问题。
 *
 * 文件不是合法 SQLite 时会抛错（调用方负责回滚）。
 */
async function reloadFromFile() {
  if (!SQLModule) SQLModule = await initSqlJs();
  const dbPath = config.DATABASE_PATH;
  if (!fs.existsSync(dbPath)) throw new Error('数据库文件不存在');

  const fileBuffer = fs.readFileSync(dbPath);
  // new Database() 会校验文件头；再补一次「能否列出表」的健全性检查
  const fresh = new SQLModule.Database(fileBuffer);
  fresh.exec('SELECT count(*) FROM sqlite_master');

  db = fresh;
  _txDepth = 0; // 连接已被整体替换，之前若有未结束的事务也不复存在，计数必须归零
  applySchemaAndMigrate();
  // 重载成功且 schema 全部执行成功 ⇒ 库已恢复正常，清掉「已回退到备份」之类的标记
  // （preserved_path 保留，方便用户回头找那份损坏文件）
  if (_dbHealth.ok) {
    _dbHealth = { ok: true, reason: null, preserved_path: _dbHealth.preserved_path, recovered_from: null };
  }
  log.db('已从文件重新载入数据库（内存与磁盘一致）');
  return true;
}

/**
 * 探活一个库文件：能否打开并列出表。返回 null 表示正常，否则返回失败原因。
 * ⚠️ 必须用独立的 Database 实例探测（sql.js 给每个实例分配独立的临时文件名，
 * 不会碰到正在使用的库）。也**不能只依赖构造是否抛错** ——
 * sql.js 的 new Database(buf) 不校验文件头，垃圾文件照样构造成功，要到第一次
 * 执行语句时才报 "file is not a database"。
 */
function _probeDbFile(buffer) {
  let probe = null;
  try {
    probe = new SQLModule.Database(buffer);
    // ⚠️ 只用 sqlite_master 探活**不够**：数据页损坏时它照样能列出表。
    // （实测：把第 2 页清零后 `SELECT count(*) FROM sqlite_master` 仍正常返回，
    //   要读到那张表的数据才报 "database disk image is malformed"。）
    // PRAGMA quick_check 会真正扫页，能发现页损坏与索引不一致；代价随库体积线性增长
    // （77KB 实测 8ms，家用库规模可忽略）。
    const r = probe.exec('PRAGMA quick_check');
    const vals = (r && r[0]) ? r[0].values.map(v => String(v[0])) : [];
    if (!(vals.length === 1 && vals[0] === 'ok')) {
      return '完整性检查未通过：' + (vals.slice(0, 2).join(' / ') || '(无返回)');
    }
    return null;
  } catch (e) {
    return e.message;
  } finally {
    try { if (probe) probe.close(); } catch (e) { /* 释放失败无所谓 */ }
  }
}

/** 找出最近的整库备份 backup_*.db（由 POST /export/backup-db 写出），供启动自检兜底。 */
function _newestDbBackup() {
  const dirs = [path.join(config.DATA_DIR || '', 'backups'), config.BACKUPS_DIR];
  const found = [];
  for (const base of dirs) {
    if (!base) continue;
    let names = [];
    try { names = fs.readdirSync(base); } catch (e) { continue; }
    for (const n of names) {
      if (!/^backup_.*\.db$/i.test(n)) continue;
      const fp = path.join(base, n);
      try {
        const st = fs.statSync(fp);
        if (st.size > 0) found.push({ path: fp, mtime: st.mtimeMs });
      } catch (e) { /* 单个文件读不到就跳过 */ }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] || null;
}

async function initDb() {
  SQLModule = await initSqlJs();
  const SQL = SQLModule;
  const dbPath = config.DATABASE_PATH;
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dbExists = fs.existsSync(dbPath);
  log.db(`数据库${dbExists ? '已存在' : '新建'}: ${dbPath}`);

  // ---------- 启动自检：损坏 / 0 字节 ----------
  // 没有这一段时的表现（实测）：库损坏后应用**照常启动**、网关显示健康、
  // 日志照样打「数据库就绪」，但每个请求都失败；更糟的是 saveDb() 会把损坏内容
  // 原样写回，覆盖掉最后一次可能还能抢救的副本。
  let broken = null;
  let fileBuffer = null;
  let preservedPath = null;
  let recoveredFrom = null;

  if (dbExists) {
    fileBuffer = fs.readFileSync(dbPath);
    if (fileBuffer.length === 0) {
      // 0 字节 = 上次落盘中途断电/磁盘写满。绝不能当成「新装」静默继续。
      broken = '数据库文件为 0 字节（疑似上次写入中途中断）';
    } else {
      broken = _probeDbFile(fileBuffer);
    }
  }

  if (broken) {
    log.error('数据库', `启动自检未通过：${broken}`, { path: dbPath });

    // ① 保全原文件：改名留档，**绝不覆盖、绝不删除** —— 这是能否人工抢救的前提。
    //    改名失败就中止启动：宁可起不来，也不能让后面的 saveDb() 写回损坏内容。
    try {
      preservedPath = `${dbPath}.corrupt-${config.localFileTimestamp()}`;
      fs.renameSync(dbPath, preservedPath);
      log.error('数据库', `原文件已保全（未删除、未覆盖）: ${preservedPath}`);
    } catch (e) {
      log.error('数据库', `保全原文件失败: ${e.message}`);
      throw new Error(`数据库损坏且无法保全原文件（${e.message}）—— 已中止启动，以免覆盖数据`);
    }

    // ② 自动回退到最近的整库备份（备份本身也要探活，避免回退到一个同样坏的文件）
    const bak = _newestDbBackup();
    if (bak) {
      const bakBroken = _probeDbFile(fs.readFileSync(bak.path));
      if (!bakBroken) {
        fs.copyFileSync(bak.path, dbPath);
        fileBuffer = fs.readFileSync(dbPath);
        recoveredFrom = bak.path;
        log.error('数据库', `已自动回退到最近的整库备份: ${bak.path}`);
      } else {
        log.error('数据库', `最近的备份同样不可用（${bakBroken}），跳过: ${bak.path}`);
      }
    }

    if (!recoveredFrom) {
      // 没有可用备份：以空库启动（保证应用可用，用户才能进设置页恢复备份），
      // 但把状态标出来，让 /api/health 与日志都能看见，而不是装作一切正常。
      fileBuffer = null;
      log.error('数据库', '没有可用的整库备份 —— 将以【空数据库】启动。原数据文件已保全，' +
        '请勿继续录入；可在「设置 → 备份与恢复」中用更早的备份恢复。');
    }
  }

  if (fileBuffer) {
    db = new SQLModule.Database(fileBuffer);
    log.db('旧数据库加载成功');
  } else {
    db = new SQLModule.Database();
    log.db(broken ? '创建新数据库（原库损坏且无可用备份）' : '创建新数据库');
  }

  if (recoveredFrom) {
    _dbHealth = { ok: true, reason: null, preserved_path: preservedPath, recovered_from: recoveredFrom };
  } else if (broken) {
    _dbHealth = { ok: false, reason: broken, preserved_path: preservedPath, recovered_from: null };
  }

  applySchemaAndMigrate();
  // 一次性存储迁移：把历史误写到安装目录的业务文件搬进持久化目录（幂等、非破坏）
  try { require('./storage-migrate').migrateStorage(module.exports); } catch (e) { log.warn('存储迁移', e.message); }
  // 历史媒体补齐：HEIC 转 JPEG（浏览器解不开 HEIC）+ 给老照片补缩略图（异步、幂等、失败不影响启动）
  try { require('./services/media-backfill').startMediaBackfill(module.exports); } catch (e) { log.warn('媒体补齐', e.message); }
  saveDb();
  if (_dbHealth.ok) {
    log.db('数据库就绪');
  } else {
    log.error('数据库', `数据库**未就绪**（${_dbHealth.reason}）—— 应用可启动但数据不可靠，请尽快用备份恢复`, {
      preserved: _dbHealth.preserved_path,
    });
  }

  // 定时落盘用异步版本：writeFileSync 会同步阻塞事件循环，让应用周期性顿一下
  setInterval(() => { saveDbAsync().catch((e) => console.error('[db] 定时落盘失败:', e.message)); }, 30000);
}

/**
 * 重新施加「连接级」PRAGMA。
 *
 * ⚠️ 必须有它：sql.js 的 db.export() 内部实现是
 *   sqlite3_close_v2 → FS.readFile → sqlite3_open
 * ——也就是**把连接关掉重建**。而 `foreign_keys` 是**连接级**开关（不随库文件持久化），
 * 重建后自动回到默认值 OFF；SCHEMA 里那句 `PRAGMA foreign_keys=ON` 只在
 * initDb / reloadFromFile 时执行过一次。于是只要发生一次落盘导出，
 * **整个库的外键约束与 ON DELETE CASCADE 就全部失效**（实测：删 pregnancy 后
 * 子表 habit_checkin 的行仍在、孤儿记录可任意插入）。
 * 注意 initDb 自身末尾就会 saveDb() ⇒ 失效时点其实是「启动完成那一瞬」，不是「首次定时落盘」。
 */
function _reapplyConnectionPragmas() {
  try {
    db.run(_fkEnforceAllowed ? 'PRAGMA foreign_keys=ON' : 'PRAGMA foreign_keys=OFF');
  } catch (e) { /* 连接刚重建，失败不影响落盘 */ }
}

function saveDb() {
  if (!db) return;
  // 恢复等批量操作期间跳过自动保存，避免写入半完成状态
  // ⚠️ 这里**只看 _savingDb（同步路径）**，绝不能把 _savingDbAsync 也算进来：
  // 异步定时器在 await 写盘期间会让出事件循环，那段窗口里业务调用 saveDb()
  // 会被静默跳过 —— 备份流程就是「先 saveDb() 再 copyFileSync 库文件」，
  // 一旦被跳过，备份拿到的是最多 30 秒前的旧库，而接口照常报「备份成功」。
  if (_savingDb || _dbLocked) return;
  // 事务期间绝不能导出：export() 会重建连接 ⇒ **未提交的事务被整段回滚**
  // （之后 COMMIT 报 "no transaction is active"），而接口仍报成功。
  if (_txDepth > 0) {
    log.warn('数据库', '落盘已跳过：当前有未提交的事务（事务期间导出会把它整段回滚）');
    return;
  }
  _savingDb = true;
  try {
    const data = db.export();
    _reapplyConnectionPragmas(); // export() 重建了连接，连接级 PRAGMA 必须重设
    const buffer = Buffer.from(data);
    const tmpPath = config.DATABASE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, config.DATABASE_PATH);
    _writeSeq += 1; // 落盘成功才计数：异步那轮靠它判断自己的快照是不是已经过期
    _lastSaveError = null;
  } catch (e) {
    // ⚠️ 原来只 console.error：数据目录运行期消失后，之后每次落盘都静默失败，
    // 接口照常报成功，用户以为记上了。现在写进错误日志，并经 /api/health 暴露。
    _lastSaveError = { at: new Date().toISOString(), message: e.message };
    try { log.error('数据库', `落盘失败（数据可能丢失）: ${e.message}`, { path: config.DATABASE_PATH }); } catch (_) { /* 日志不反噬业务 */ }
    console.error('Failed to save DB:', e.message);
  } finally {
    _savingDb = false;
  }
}

/**
 * 异步落盘 —— 专供 30 秒定时保存使用。
 *
 * 【为什么另开一个函数，而不是把 saveDb 改成异步】
 * 备份 / 恢复 / 导出等流程依赖「saveDb() 返回时数据已经在盘上」这个同步语义。
 * 一旦改成异步又不 await，就会出现「接口回报成功、盘上其实还是旧数据」，
 * 恢复备份这类操作会被静默撤销。定时器这条路径没有这个要求，
 * 把它挪到异步，可以把最耗时的磁盘写入从主线程上摘掉。
 *
 * 【为什么值得改】每 30 秒一次的 writeFileSync 会**同步阻塞事件循环**：
 * 库越大、磁盘越慢，卡得越久（NAS 上可达几十到几百毫秒）。
 * 表现就是应用「时不时顿一下」，而日志里什么异常都没有。
 * db.export() 仍在主线程（wasm 内存操作，纯内存拷贝，很快），不另开线程。
 */
async function saveDbAsync() {
  if (!db) return;
  // 三个条件都要看：批量操作期间不写、业务正在同步写时不抢、自己上一轮还没写完
  if (_savingDb || _savingDbAsync || _dbLocked) return;
  // 事务期间同样不能导出（export() 会回滚未提交事务），见 saveDb 的说明
  if (_txDepth > 0) {
    log.warn('数据库', '定时落盘已跳过：当前有未提交的事务');
    return;
  }
  _savingDbAsync = true;
  const seqAtSnapshot = _writeSeq; // 记下取快照时的落盘序号
  try {
    const data = db.export();
    _reapplyConnectionPragmas(); // export() 重建了连接，连接级 PRAGMA 必须重设
    const buffer = Buffer.from(data);
    // ⚠️ 用独立的临时文件名：与同步路径共用 .tmp 的话，两边同时写会互相踩。
    // 两份都是完整的整库快照，谁后 rename 谁生效，不会写出半个库。
    const tmpPath = config.DATABASE_PATH + '.tmp-async';
    await fs.promises.writeFile(tmpPath, buffer);
    // ⚠️ 写盘期间业务可能已经同步落盘了更新的数据（备份/导出就是「先 saveDb() 再拷库文件」）。
    // 这时候再 rename 就会把旧快照盖回去，那次同步落盘等于白写 —— 数据静默回退，
    // 而接口照样报成功。发现序号变了就放弃本轮，等下一个 30 秒再写。
    if (_writeSeq !== seqAtSnapshot) {
      try { await fs.promises.unlink(tmpPath); } catch (e) { /* 清不掉也无所谓 */ }
      return;
    }
    await fs.promises.rename(tmpPath, config.DATABASE_PATH);
    _writeSeq += 1;
    _lastSaveError = null;
  } catch (e) {
    _lastSaveError = { at: new Date().toISOString(), message: e.message };
    try { log.error('数据库', `定时落盘失败（数据可能丢失）: ${e.message}`, { path: config.DATABASE_PATH }); } catch (_) { /* ignore */ }
    console.error('Failed to save DB (async):', e.message);
  } finally {
    _savingDbAsync = false;
  }
}

function queryOne(sql, params = []) {
  const d = getDb();
  const stmt = d.prepare(sql);
  if (params.length) stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function queryAll(sql, params = []) {
  const d = getDb();
  const stmt = d.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function run(sql, params = []) {
  try {
    const d = getDb();
    d.run(sql, params);
    try {
      const result = d.exec("SELECT last_insert_rowid()");
      const rowid = result?.[0]?.values?.[0]?.[0];
      return { lastInsertRowid: rowid != null ? rowid : -1 };
    } catch {
      return { lastInsertRowid: -1 };
    }
  } catch (e) {
    console.error('[db.run] SQL execution error:', e.message);
    throw e; // 重新抛出让调用方catch处理
  }
}

function generateId() {
  return require('crypto').randomUUID();
}

function lockDb() { _dbLocked = true; }
function unlockDb() { _dbLocked = false; }

// ============ 事务辅助 ============
// ⚠️ 为什么不能继续用裸 db.getDb().run('BEGIN ...')：模块自己不知道事务开着，
// 定时落盘就可能在事务中间导出，把整个事务回滚掉（而接口照常报成功）。
// 统一走这三个函数，_txDepth 才会被落盘路径看见。
function beginTransaction(mode = 'IMMEDIATE') {
  if (_txDepth > 0) throw new Error('已有未结束的事务');
  db.run(`BEGIN ${mode} TRANSACTION`);
  _txDepth = 1;
}
function commitTransaction() {
  try {
    db.run('COMMIT');
    _txDepth = 0;
  } catch (e) {
    // COMMIT 失败时事务是否仍然打开并不确定 —— 主动再回滚一次并归零。
    // 宁可回滚掉这一次写入，也不能留下一个模块「看不见」的悬挂事务：
    // 那种事务会在下一次落盘导出时被静默回滚，且计数卡在 1 会让之后所有落盘都被跳过。
    try { db.run('ROLLBACK'); } catch (_) { /* 已经没有事务了 */ }
    _txDepth = 0;
    throw e;
  }
}
function rollbackTransaction() {
  // 失败也不能抛：调用点都在 catch 里，抛出去会遮住原始错误
  if (_txDepth > 0) {
    try { db.run('ROLLBACK'); } catch (e) { /* 事务可能已被回滚（例如中途发生过导出） */ }
  }
  _txDepth = 0;
}
function inTransaction() { return _txDepth > 0; }

/** 数据库健康摘要（供 /api/health 与排查使用） */
function getDbHealth() {
  let fk = null;
  try { fk = db ? (db.exec('PRAGMA foreign_keys')[0].values[0][0] ? 1 : 0) : null; } catch (e) { /* ignore */ }
  return { ..._dbHealth, foreign_keys: fk, last_save_error: _lastSaveError };
}

module.exports = {
  getDb, initDb, saveDb, saveDbAsync, queryOne, queryAll, run, generateId,
  lockDb, unlockDb, reloadFromFile,
  beginTransaction, commitTransaction, rollbackTransaction, inTransaction,
  getDbHealth,
};
