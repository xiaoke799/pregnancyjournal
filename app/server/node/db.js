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
  uric_acid REAL,
  supplement_record TEXT,
  intimacy_note TEXT,
  plan_text TEXT,
  plan_date TEXT,
  water_intake INTEGER,
  contraction_count INTEGER,
  contraction_interval INTEGER,
  fetal_movement_count INTEGER,
  fetal_movement_duration INTEGER,
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
  category TEXT DEFAULT '',
  is_checked INTEGER DEFAULT 0,
  is_custom INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (checklist_id) REFERENCES checklist(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reminder (
  id TEXT PRIMARY KEY,
  pregnancy_id TEXT NOT NULL,
  title TEXT NOT NULL,
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
`;

function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

function migrateDb() {
  const tableCols = {
    prenatal_checkup: {
      fundal_height: null,
      abdominal_circumference: null,
      hospital: null,
      is_recommended: "0",
      schedule_item_id: null,
    },
    checkup_report: {
      sub_item: null,
      mime_type: null,
    },
    custom_checkup: {
      items: null,
      name: null,
      notes: null,
    },
    app_config: {
      created_at: null,
      updated_at: null,
      description: null,
    },
    pregnancy: {
      conception_date: null,
      is_active: "1",
      baby_name: null,
    },
    daily_record: {
      blood_pressure_systolic: null,
      blood_pressure_diastolic: null,
      sleep_hours: null,
      sleep_quality: null,
      symptoms: null,
      exercise_type: null,
      exercise_duration: null,
      diet_note: null,
      medication: null,
      edema_level: null,
      vaginal_discharge: null,
      skin_condition: null,
      urination_frequency: null,
      hcg_value: null,
      uric_acid: null,
      supplement_record: null,
      intimacy_note: null,
      plan_text: null,
      plan_date: null,
      water_intake: null,
      stool_record: null,
      contraction_count: null,
      contraction_interval: null,
      fetal_movement_count: null,
      fetal_movement_duration: null,
    },
    contraction_session: {
      pregnancy_id: null,
      avg_duration: null,
      avg_interval: null,
    },
    fetal_movement_session: {
      pregnancy_id: null,
    },
    pregnancy_photo: {
      updated_at: null,
      checkup_id: null,
      milestone_type: null,
      gestational_day: "0",
    },
    checklist_item: {
      description: null,
      is_mandatory: "0",
    },
    lab_result: {
      updated_at: null,
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
          } catch (e) {}
        }
      }
    } catch (e) {}
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

  db.run(SCHEMA);
  log.db('Schema 初始化完成');
  migrateDb();
  saveDb();
  log.db('数据库就绪');

  setInterval(saveDb, 30000);
}

function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = config.DATABASE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, config.DATABASE_PATH);
  } catch (e) {
    console.error('Failed to save DB:', e.message);
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
  const d = getDb();
  d.run(sql, params);
  return { lastInsertRowid: d.exec("SELECT last_insert_rowid()")[0]?.values[0][0] };
}

function generateId() {
  return require('crypto').randomUUID();
}

module.exports = { getDb, initDb, saveDb, queryOne, queryAll, run, generateId };
