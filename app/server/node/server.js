const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initDb } = require('./db');
const authMiddleware = require('./middleware/auth');
const log = require('./logger');

if (config.DATABASE_PATH) {
  const logDir = path.dirname(config.DATABASE_PATH);
  log.setLogFile(path.join(logDir, 'info.log'));
}

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

if (config.APP_MODE === 'dev') {
  app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
}

app.use(authMiddleware);

let requestCount = 0;
app.use((req, res, next) => {
  const start = Date.now();
  requestCount++;
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (!req.path.includes('/api/health') && !req.path.startsWith('/assets')) {
      log.request(req.method, req.path, res.statusCode, ms);
    }
  });
  next();
});

const routes = [
  './routes/pregnancy',
  './routes/checkup',
  './routes/lab_result',
  './routes/daily-record',
  './routes/contraction',
  './routes/photo',
  './routes/diary',
  './routes/checklist',
  './routes/reminder',
  './routes/fetal_movement',
  './routes/reference',
  './routes/dashboard',
  './routes/export',
  './routes/habit-checkin',
  './routes/supplement-checkin',
  './routes/app-config',
  './routes/diet',
  './routes/checkup-schedule',
  './routes/logs',
];

let loadedRoutes = 0;
let failedRoutes = 0;

routes.forEach(routePath => {
  try {
    const router = require(routePath);
    app.use('/api/v1', router);
    loadedRoutes++;
    log.info('路由', `加载成功: ${routePath}`);
  } catch (e) {
    failedRoutes++;
    log.error('路由', `加载失败: ${routePath}`, { error: e.message });
  }
});

log.startup(`路由加载完成: ${loadedRoutes}/${routes.length} 成功, ${failedRoutes} 失败`);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: config.APP_VERSION,
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
    requests: requestCount,
    routes: loadedRoutes,
    memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
  });
});

const staticDir = config.STATIC_DIR;
const indexHtmlPath = path.join(staticDir, 'index.html');

function sendIndex(req, res) {
  if (fs.existsSync(indexHtmlPath)) {
    return res.sendFile(indexHtmlPath);
  }
  res.status(404).json({ error: 'not_found', message: '前端未构建', static_dir: staticDir });
}

const assetsDir = path.join(staticDir, 'assets');
if (fs.existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir));
}

if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
}

app.get('*', sendIndex);

app.use((err, req, res, next) => {
  log.error('异常', `${req.method} ${req.path}`, { error: err.message, stack: err.stack?.substring(0, 200) });
  res.status(500).json({ code: 1001, data: null, message: '服务器内部错误' });
});

async function start() {
  log.startup('数据库初始化开始...');
  await initDb();
  log.startup('数据库初始化完成');

  app.listen(config.PORT, '0.0.0.0', () => {
    log.startup('服务启动成功', {
      port: config.PORT,
      mode: config.APP_MODE,
      database: config.DATABASE_PATH,
      static: staticDir,
      staticExists: fs.existsSync(staticDir),
      indexExists: fs.existsSync(indexHtmlPath),
      nodeVersion: process.version,
      pid: process.pid,
    });
  });
}

process.on('uncaughtException', (err) => {
  log.error('进程', 'uncaughtException', { error: err.message, stack: err.stack?.substring(0, 300) });
});

process.on('unhandledRejection', (reason) => {
  log.error('进程', 'unhandledRejection', { reason: String(reason) });
});

start().catch(err => {
  log.error('进程', '启动失败', { error: err.message });
  process.exit(1);
});
