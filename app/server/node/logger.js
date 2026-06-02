const fs = require('fs');
const path = require('path');

let logFile = null;

function setLogFile(filePath) {
  logFile = filePath;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function write(level, category, msg, extra) {
  const ts = timestamp();
  const line = `[${ts}] [${level}] [${category}] ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  console.log(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, line + '\n'); } catch {}
  }
}

module.exports = {
  setLogFile,
  info: (cat, msg, extra) => write('INFO', cat, msg, extra),
  warn: (cat, msg, extra) => write('WARN', cat, msg, extra),
  error: (cat, msg, extra) => write('ERROR', cat, msg, extra),
  debug: (cat, msg, extra) => write('DEBUG', cat, msg, extra),

  startup: (msg, extra) => write('INFO', '启动', msg, extra),
  shutdown: (msg, extra) => write('INFO', '停止', msg, extra),
  request: (method, path, status, ms) => write('INFO', '请求', `${method} ${path} ${status} ${ms}ms`),
  db: (msg, extra) => write('INFO', '数据库', msg, extra),
  api: (route, msg, extra) => write('INFO', 'API', `[${route}] ${msg}`, extra),
  migrate: (msg) => write('INFO', '迁移', msg),
};
