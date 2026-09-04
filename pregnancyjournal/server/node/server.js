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
  log.init(path.join(logDir, 'logs'));
}

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 禁止 API 响应被浏览器/代理缓存（解决 304 导致数据不刷新问题）
app.use('/api/', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

if (config.APP_MODE === 'dev') {
  app.use(cors({ origin: true, credentials: true }));
}

// 网关前缀处理：
// 1. 裸前缀 /app/pregnancyjournal → 301 到带尾斜杠形式，
//    否则浏览器相对路径解析会丢掉前缀（./api → /app/api）
// 2. 带前缀的请求剥离前缀后再匹配路由
app.use((req, res, next) => {
  const GW_PREFIX = '/app/pregnancyjournal';
  if (req.url === GW_PREFIX) {
    return res.redirect(301, GW_PREFIX + '/');
  }
  if (req.url.startsWith(GW_PREFIX + '/')) {
    req.url = req.url.slice(GW_PREFIX.length) || '/';
  }
  next();
});

app.use(authMiddleware);

let requestCount = 0;
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = ++requestCount;
  req._reqId = reqId;
  const userId = req.headers['x-trim-username'] || req.headers['x-trim-userid'] || '';

  // POST/PUT 请求：在进入路由前记录请求体摘要（便于排查字段问题）
  if ((req.method === 'POST' || req.method === 'PUT') && req.body && Object.keys(req.body).length > 0) {
    const bodyKeys = Object.keys(req.body);
    const bodyPreview = {};
    for (const k of bodyKeys) {
      const v = req.body[k];
      if (v === null || v === undefined) bodyPreview[k] = null;
      else if (typeof v === 'string' && v.length > 60) bodyPreview[k] = `[${v.length} chars]`;
      else bodyPreview[k] = v;
    }
    log.debug('HTTP', `${req.method} ${req.path}`, { reqId, body: bodyPreview });
  }

  res.on('finish', () => {
    const ms = Date.now() - start;
    if (!req.path.includes('/api/health') && !req.path.startsWith('/assets')) {
      log.request({ id: reqId, method: req.method, path: req.path, status: res.statusCode, ms, userId });
    }
  });
  next();
});


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
    // index.html 必须永不缓存，否则部署后浏览器仍加载旧 JS 文件名
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.sendFile(indexHtmlPath);
  }
  res.status(404).json({ error: 'not_found', message: '前端未构建', static_dir: staticDir });
}

const assetsDir = path.join(staticDir, 'assets');
if (fs.existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir, {
    etag: true, lastModified: true,
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-cache'); // JS/CSS 每次部署后必须更新
    }
  }));
}

if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir, {
    etag: true, lastModified: true,
    setHeaders: (res, filePath) => {
      // HTML 文件不缓存，确保部署后立即生效
      if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      } else {
        res.set('Cache-Control', 'max-age=86400'); // 其他静态资源缓存1天
      }
    }
  }));
}

// 模块级变量记录加载成功的路由数
let loadedRoutes = 0;

app.use((err, req, res, next) => {
  log.error('中间件', `${req.method} ${req.path} 未捕获异常`, {
    reqId: req._reqId,
    error: err.message,
    stack: err.stack?.substring(0, 300),
  });
  const message = config.APP_MODE === 'dev' ? err.message : '服务器内部错误';
  res.status(500).json({ code: 1001, data: null, message });
});

async function start() {
  log.startup('数据库初始化开始...');
  await initDb();
  log.startup('数据库初始化完成');

  // 路由加载必须在数据库初始化之后，否则调度器会在 DB 就绪前执行
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
    './routes/wecom',
    './routes/logs',
  ];

  loadedRoutes = 0;
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

  // 所有/api/v1路由加载完成后，再注册catch-all路由，避免拦截API请求
  app.get('*', sendIndex);

  log.startup(`路由加载完成: ${loadedRoutes}/${routes.length} 成功, ${failedRoutes} 失败`);

  // 确定 Socket 路径：优先 FNOS_SOCKET_PATH（cmd/main 导出），对标模板 ${TRIM_APPDEST}/app.sock
  const socketPath = config.FNOS_SOCKET_PATH || path.join(
    config.TRIM_APPDEST || '/var/apps/pregnancyjournal',
    'app.sock'
  );

  // 清理已存在的 socket 文件（不抛异常 — 无权限的旧 socket 由 cmd/main 处理）
  try {
    if (fs.existsSync(socketPath)) fs.rmSync(socketPath, { force: true });
  } catch (e) {
    log.startup(`清理旧 socket 失败: ${e.message}`);
  }

  const server = app.listen(socketPath, () => {
    // 确保网关反向代理（可能以不同用户运行）可连接
    try { fs.chmodSync(socketPath, 0o666); } catch (e) { log.startup('chmod socket 失败:', e.message); }
    log.startup('服务启动成功 (Unix Socket / 统一网关)', {
      socket: socketPath,
      mode: config.APP_MODE,
      database: config.DATABASE_PATH,
      static: staticDir,
      staticExists: fs.existsSync(staticDir),
      indexExists: fs.existsSync(indexHtmlPath),
      nodeVersion: process.version,
      pid: process.pid,
    });
  });

  // WebSocket 服务（FnOS 统一网关模式）
  // 复用同一 HTTP Server + 同一 Unix Socket
  // 前端通过 wss://<host>/app/pregnancyjournal/ws 连接
  try {
    const { attachWebSocketServer } = require('./websocket');
    attachWebSocketServer(server, '/ws');
  } catch (e) {
    log.warn('WebSocket', `初始化失败（桌面通信不可用）: ${e.message}`);
  }

  return server;
}

process.on('uncaughtException', (err) => {
  log.error('进程', 'uncaughtException', { error: err.message, stack: err.stack?.substring(0, 300) });
  // 退出进程避免处于未知状态（定时器将在下次启动时恢复）
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  log.error('进程', 'unhandledRejection', { reason: String(reason) });
});

// 优雅退出：被系统停止（SIGTERM）或中断（SIGINT）时记录日志
process.on('SIGTERM', () => {
  log.startup('收到 SIGTERM，进程退出', { pid: process.pid, uptime: Math.floor(process.uptime()) });
  process.exit(0);
});
process.on('SIGINT', () => {
  log.startup('收到 SIGINT，进程退出', { pid: process.pid, uptime: Math.floor(process.uptime()) });
  process.exit(0);
});

// ============ 网关用户身份读取（仅在 FNOS_SOCKET_PATH 存在时信任 X-Trim-* Header） ============
function getGatewayUser(req) {
  const hasGateway = !!config.FNOS_SOCKET_PATH;
  return {
    authenticated: hasGateway && !!req.headers['x-trim-userid'],
    uid: hasGateway ? (req.headers['x-trim-userid'] || '') : '',
    isAdmin: hasGateway && req.headers['x-trim-isadmin'] === 'true',
    username: hasGateway ? (req.headers['x-trim-username'] || '') : '',
  };
}
// 暴露给路由模块使用
app.getGatewayUser = getGatewayUser;

// ============ 每日推送调度器（使用 Unix Socket 自调用） ============
const WECOM_CONFIG_FILE = path.join(__dirname, 'data', 'wecom.json');
const DAILY_PUSH_STATE_FILE = path.join(__dirname, 'data', 'daily_push_state.json');

function startDailyPushScheduler(server) {
  const CHECK_INTERVAL = 30 * 60 * 1000;
  const PUSH_HOUR = 21;
  const socketPath = server.address();

  setInterval(async () => {
    try {
      const now = new Date();
      if (now.getHours() !== PUSH_HOUR) return;

      let state = { lastPushDate: null };
      try {
        if (fs.existsSync(DAILY_PUSH_STATE_FILE)) {
          state = JSON.parse(fs.readFileSync(DAILY_PUSH_STATE_FILE, 'utf-8'));
        }
      } catch { /* ignore */ }

      const todayStr = now.toISOString().slice(0, 10);
      if (state.lastPushDate === todayStr) return;

      let wecomConfig = null;
      try {
        if (fs.existsSync(WECOM_CONFIG_FILE)) {
          wecomConfig = JSON.parse(fs.readFileSync(WECOM_CONFIG_FILE, 'utf-8'));
        }
      } catch { /* ignore */ }

      if (!wecomConfig || !wecomConfig.webhook_url || !wecomConfig.configured) return;

      const db = require('./db');
      const pregnancies = await db.queryAll("SELECT id FROM pregnancy WHERE status = 'active' LIMIT 10");
      if (!pregnancies || pregnancies.length === 0) return;

      for (const p of pregnancies) {
        try {
          const http = require('http');
          const postData = JSON.stringify({ pregnancy_id: p.id });
          const req = http.request({
            socketPath: socketPath,
            path: '/api/v1/wecom/daily-push',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
          }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
              log.info('企业微信', `每日推送完成: pregnancy=${p.id}, result=${body.slice(0, 100)}`);
            });
          });
          req.on('error', (e) => log.error('企业微信', `推送失败: ${e.message}`));
          req.write(postData);
          req.end();
        } catch (e) {
          log.error('企业微信', `推送异常: ${e.message}`);
        }
      }

      state.lastPushDate = todayStr;
      fs.writeFileSync(DAILY_PUSH_STATE_FILE, JSON.stringify(state), 'utf-8');
      log.info('企业微信', `每日看板推送触发成功, 共${pregnancies.length}个孕期`);

    } catch (e) {
      log.error('企业微信', `调度器异常: ${e.message}`);
    }
  }, CHECK_INTERVAL);

  log.info('企业微信', `每日推送调度器已启动 (每天 ${PUSH_HOUR}:00 触发)`);
}

start().then((server) => {
  startDailyPushScheduler(server);
}).catch(err => {
  log.error('进程', '启动失败', { error: err.message });
  process.exit(1);
});
