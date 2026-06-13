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
  app.use(cors({ origin: true, credentials: true }));
}

// CGI 路径剥离中间件：网关直接转发模式会携带完整 CGI 路径前缀
// 将 /cgi/ThirdParty/pregnancyjournal/index.cgi/api/v1/... → /api/v1/...
// 将 /cgi/ThirdParty/pregnancyjournal/index.cgi/assets/... → /assets/...
// 将 /cgi/ThirdParty/pregnancyjournal/index.cgi/ → /
app.use((req, res, next) => {
  const CGI_PREFIX = '/cgi/ThirdParty/pregnancyjournal/index.cgi';
  if (req.url.startsWith(CGI_PREFIX)) {
    const stripped = req.url.slice(CGI_PREFIX.length);
    const url = stripped || '/';
    req.url = url;
    req.originalUrl = url;
    req.path = url.split('?')[0];
  }
  next();
});

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
  './routes/wecom',
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

  const port = parseInt(config.TRIM_SERVICE_PORT) || 3867;

  app.listen(port, '0.0.0.0', () => {
    log.startup('服务启动成功 (TCP)', {
      port: port,
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
  // 退出进程避免处于未知状态（定时器将在下次启动时恢复）
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  log.error('进程', 'unhandledRejection', { reason: String(reason) });
});

// ========== 企业微信每日定时推送 ==========
const WECOM_CONFIG_FILE = path.join(__dirname, 'data', 'wecom.json');
const DAILY_PUSH_STATE_FILE = path.join(__dirname, 'data', 'daily_push_state.json');

/** 每日推送调度器：每晚21:00推送次日待办 */
function startDailyPushScheduler() {
  // 每30分钟检查一次是否到推送时间
  const CHECK_INTERVAL = 30 * 60 * 1000;
  const PUSH_HOUR = 21; // 晚上9点推送次日预览

  setInterval(async () => {
    try {
      const now = new Date();
      // 检查是否在推送时间窗口内（PUSH_HOUR点 到 PUSH_HOUR+1点）
      if (now.getHours() !== PUSH_HOUR) return;

      // 读取状态，避免同一天重复推送
      let state = { lastPushDate: null };
      try {
        if (fs.existsSync(DAILY_PUSH_STATE_FILE)) {
          state = JSON.parse(fs.readFileSync(DAILY_PUSH_STATE_FILE, 'utf-8'));
        }
      } catch { /* ignore */ }

      const todayStr = now.toISOString().slice(0, 10);
      if (state.lastPushDate === todayStr) return; // 今天已推过

      // 检查企业微信是否配置
      let wecomConfig = null;
      try {
        if (fs.existsSync(WECOM_CONFIG_FILE)) {
          wecomConfig = JSON.parse(fs.readFileSync(WECOM_CONFIG_FILE, 'utf-8'));
        }
      } catch { /* ignore */ }

      if (!wecomConfig || !wecomConfig.webhook_url || !wecomConfig.configured) return;

      // 获取所有活跃孕期
      const db = require('./db');
      const pregnancies = await db.queryAll("SELECT id FROM pregnancy WHERE status = 'active' LIMIT 10");
      if (!pregnancies || pregnancies.length === 0) return;

      // 对每个孕期发送每日看板
      for (const p of pregnancies) {
        try {
          // 内部调用 daily-push 接口（模拟请求）
          const http = require('http');
          const postData = JSON.stringify({ pregnancy_id: p.id });
          const req = http.request({
            hostname: '127.0.0.1',
            port: parseInt(process.env.TRIM_SERVICE_PORT) || 3867,
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

      // 记录已推送
      state.lastPushDate = todayStr;
      fs.writeFileSync(DAILY_PUSH_STATE_FILE, JSON.stringify(state), 'utf-8');
      log.info('企业微信', `每日看板推送触发成功, 共${pregnancies.length}个孕期`);

    } catch (e) {
      log.error('企业微信', `调度器异常: ${e.message}`);
    }
  }, CHECK_INTERVAL);

  log.info('企业微信', `每日推送调度器已启动 (每天 ${PUSH_HOUR}:00 触发)`);
}

start().then(() => {
  startDailyPushScheduler(); // 启动后开始调度
}).catch(err => {
  log.error('进程', '启动失败', { error: err.message });
  process.exit(1);
});
