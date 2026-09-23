const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const log = require('./logger');

let db = null;

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

CREATE TABLE IF NOT EXISTS checkup_photo (
  id TEXT PRIMARY KEY,
  checkup_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  thumbnail_path TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id) ON DELETE CASCADE
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id) ON DELETE CASCADE
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checkup_id) REFERENCES prenatal_checkup(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_record (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  record_date TEXT NOT NULL,
  weight REAL,
  fetal_heart_rate INTEGER,
  body_temperature REAL,
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
  contraction_record TEXT,
  fetal_movement_count INTEGER,
  fetal_movement_duration INTEGER,
  fetal_movement_record TEXT,
  sleep_record TEXT,
  diet_record TEXT,
  exercise_record TEXT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function migrateDb() {
  // 仅保留真正不在 SCHEMA 中的列（大多数列已在 CREATE TABLE 中定义）
  // 老库升级时执行 ADD COLUMN；新库因 SCHEMA 已包含则跳过
  const tableCols = {
    prenatal_checkup: {
      schedule_item_id: null,      // 老库可能缺失（不在 SCHEMA 中）
    },
    reminder: {
      priority: "medium",          // dashboard 提醒事件优先级（HIGH/MEDIUM/LOW）
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
            db.run(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
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

async function initDb() {
  const SQL = await initSqlJs();
  const dbPath = config.DATABASE_PATH;
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const dbExists = fs.existsSync(dbPath);
  log.db(`数据库${dbExists ? '已存在' : '新建'}: ${dbPath}`);

  if (dbExists) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
    log.db('旧数据库加载成功');
  } else {
    db = new SQL.Database();
    log.db('创建新数据库');
  }

  // SCHEMA 含多条语句，逐条执行（run() 只支持单条）
  // 每条独立 try/catch，防止单条失败阻断后续表创建
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  let schemaOk = 0, schemaFail = 0;
  for (const stmt of statements) {
    try {
      db.run(stmt);
      schemaOk++;
    } catch (e) {
      schemaFail++;
      console.error('[db] Schema 语句失败:', e.message, '| 语句:', stmt.substring(0, 80));
    }
  }
  log.db(`Schema 执行完成: ${schemaOk} 成功, ${schemaFail} 失败`);
  migrateDb();
  saveDb();
  log.db('数据库就绪');

  setInterval(saveDb, 30000);
}

let _savingDb = false;
let _dbLocked = false; // 数据库锁定标志：恢复/备份等批量操作期间阻止自动保存

function saveDb() {
  if (!db) return;
  // 恢复等批量操作期间跳过自动保存，避免写入半完成状态
  if (_savingDb || _dbLocked) return;
  _savingDb = true;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = config.DATABASE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, config.DATABASE_PATH);
  } catch (e) {
    console.error('Failed to save DB:', e.message);
  } finally {
    _savingDb = false;
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

module.exports = { getDb, initDb, saveDb, queryOne, queryAll, run, generateId, lockDb, unlockDb };
