/**
 * 孕程记 - 结构化日志系统
 * 特性：异步批量写入、JSON 格式、级别过滤、文件轮转、分类输出
 */
const fs = require('fs');
const path = require('path');
const { Console } = require('console');

// ============ 配置 ============
const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, SILENT: 99 };

const CONFIG = {
  level: LOG_LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LOG_LEVELS.INFO,
  maxFileSize: 5 * 1024 * 1024, // 5MB 单文件上限
  maxFiles: 5,                  // 保留历史文件数
  flushInterval: 2000,          // 批量写入间隔(ms)
  enableConsole: true,
  enableFile: true,
};

// ============ 状态 ============
let _logDir = null;
let _appLogPath = null;
let _errorLogPath = null;
let _writeQueue = [];
let _flushTimer = null;
let _writing = false;
let _ready = false;

// ============ 初始化 ============
function init(logDirectory) {
  if (_ready) return;

  // 优先使用传入目录，其次环境变量，最后默认
  _logDir = logDirectory
    || (process.env.TRIM_PKGVAR ? path.join(process.env.TRIM_PKGVAR, 'logs') : null)
    || path.join(process.cwd(), 'data', 'logs');

  try {
    if (!fs.existsSync(_logDir)) fs.mkdirSync(_logDir, { recursive: true });
    _appLogPath = path.join(_logDir, 'app.jsonl');
    _errorLogPath = path.join(_logDir, 'error.jsonl');
    _ready = true;
    _startFlushTimer();
  } catch (e) {
    // 文件不可用时仅控制台输出
    _ready = false;
    console.error('[logger] 初始化写入失败:', e.message);
  }
}

function setLogFile(filePath) {
  // 兼容旧调用，推导目录
  if (filePath) {
    init(path.dirname(filePath));
  }
}

// ============ 核心写入 ============
function _startFlushTimer() {
  if (_flushTimer) clearInterval(_flushTimer);
  _flushTimer = setInterval(_flush, CONFIG.flushInterval);
  // 进程退出前确保刷出
  process.on('beforeExit', _flush);
}

function _flush() {
  if (!_ready || _writing || _writeQueue.length === 0) return;

  _writing = true;
  const batch = _writeQueue.splice(0, _writeQueue.length);

  const appLines = [];
  const errorLines = [];

  for (const entry of batch) {
    const line = JSON.stringify(entry) + '\n';
    appLines.push(line);
    if (LOG_LEVELS[entry.level] >= LOG_LEVELS.ERROR) {
      errorLines.push(line);
    }
  }

  // 异步写入
  const tasks = [];
  if (appLines.length > 0) tasks.push(_appendFile(_appLogPath, appLines.join(''), true));
  if (errorLines.length > 0) tasks.push(_appendFile(_errorLogPath, errorLines.join(''), false));

  Promise.all(tasks).then(() => {
    _writing = false;
  }).catch((e) => {
    _writing = false;
    console.error('[logger] 写入失败:', e.message);
  });
}

function _appendFile(filePath, content, checkRotation) {
  return new Promise((resolve) => {
    const doWrite = () => fs.appendFile(filePath, content, (err) => {
      if (err) resolve(); // 静默失败，避免影响业务
      else resolve();
    });

    // 写入后检查文件大小，超限时触发轮转
    if (checkRotation) {
      fs.stat(filePath, (err, stat) => {
        if (!err && stat.size > CONFIG.maxFileSize) {
          _rotate(filePath).then(doWrite);
        } else {
          doWrite();
        }
      });
    } else {
      doWrite();
    }
  });
}

function _rotate(filePath) {
  return new Promise((resolve) => {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, path.extname(filePath));
    const ext = path.extname(filePath);

    // 从最旧开始依次重命名
    const tryRename = (i) => {
      if (i <= 0) return resolve();
      const src = path.join(dir, i === 1 ? `${base}${ext}` : `${base}.${i}${ext}`);
      const dst = path.join(dir, `${base}.${i + 1}${ext}`);
      fs.rename(src, dst, () => {
        // 超出保留数的文件直接删除
        if (i >= CONFIG.maxFiles) {
          fs.unlink(path.join(dir, `${base}.${i + 1}${ext}`), () => resolve());
        } else {
          tryRename(i - 1);
        }
      });
    };
    tryRename(CONFIG.maxFiles);
  });
}

// ============ 日志记录 API ============
function log(level, category, message, meta) {
  const levelVal = LOG_LEVELS[level] ?? LOG_LEVELS.INFO;
  if (levelVal < CONFIG.level) return;

  const entry = {
    ts: new Date().toISOString(),
    level,
    cat: category || 'app',
    msg: message,
  };

  // 合并可选元数据（如 reqId、pregnancy_id 等）
  if (meta && typeof meta === 'object') {
    // 移除undefined值，保留有效字段
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined) entry[k] = v;
    }
  }

  // 控制台输出（人类可读）
  if (CONFIG.enableConsole) {
    const ts = entry.ts.substring(11, 19); // HH:MM:SS
    const prefix = `[${ts}] [${level.padEnd(5)}] [${category || '-'}]`;
    if (level === 'ERROR' || level === 'WARN') {
      console.error(prefix, message, meta ? JSON.stringify(meta) : '');
    } else {
      console.log(prefix, message, meta ? JSON.stringify(meta) : '');
    }
  }

  // 写入缓冲
  if (CONFIG.enableFile && _ready) {
    _writeQueue.push(entry);
  }
}

// 便捷方法（兼容旧 API + 新方法）
const logger = {
  init,
  setLogFile,

  debug: (cat, msg, meta) => log('DEBUG', cat, msg, meta),
  info: (cat, msg, meta) => log('INFO', cat, msg, meta),
  warn: (cat, msg, meta) => log('WARN', cat, msg, meta),
  error: (cat, msg, meta) => log('ERROR', cat, msg, meta),

  // 启动/停止（语义化快捷）
  startup: (msg, meta) => log('INFO', '启动', msg, meta),
  shutdown: (msg, meta) => log('INFO', '停止', msg, meta),

  // 请求日志
  request: (reqInfo) => {
    // reqInfo: { id, method, path, status, ms, userId? }
    const level = reqInfo.status >= 500 ? 'ERROR' : reqInfo.status >= 400 ? 'WARN' : 'INFO';
    log(level, 'HTTP', `${reqInfo.method} ${reqInfo.path} → ${reqInfo.status} (${reqInfo.ms}ms)`, {
      reqId: reqInfo.id,
      status: reqInfo.status,
      ms: reqInfo.ms,
      userId: reqInfo.userId,
    });
  },

  // 数据库迁移日志
  migrate: (catOrMsg, msg, meta) => {
    // 兼容两种调用：log.migrate('消息') 与 log.migrate('分类','消息',meta)
    if (msg === undefined) return log('INFO', '迁移', catOrMsg, meta);
    return log('INFO', catOrMsg, msg, meta);
  },

  // 数据库操作日志
  db: (msg, meta) => log('DEBUG', 'DB', msg, meta),

  // 获取当前日志目录（供 logs 路由使用）
  getLogDir: () => _logDir,
  getLogPaths: () => ({ app: _appLogPath, error: _errorLogPath }),
  isReady: () => _ready,

  // 手动刷出（用于测试）,
  flush: () => { if (_writeQueue.length > 0) _flush(); },
};

module.exports = logger;
