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

// ============ 错误信息脱敏（出口统一拦一道）============
// 路由层有 160+ 处 `res.json({ code: 1001, message: e.message })`，会把 SQL 报错、
// 文件绝对路径（/vol1/... 、D:\...）原样回给浏览器；而本文件下面的全局错误处理
// 已经做了脱敏（非 dev 模式统一返回「服务器内部错误」）—— 路由层把它绕过了。
// 这里在 res.json 出口统一判断：命中「像内部实现细节」的模式就换成通用文案，
// 原始信息带 reqId 写进错误日志，排查时不受影响。开发模式保留原文以便调试。
// ⚠️ 模式必须覆盖 fnOS 的真实数据路径形态 `/vol1/@appdata/...`（不是 `/vol/`），
//    以及 JS 运行时错误的原文（TypeError 的 "Cannot read properties of ..."）。
//    反过来也要收得住：正常业务文案里不会出现这些词，实测 14 条业务提示零误伤。
// ⚠️ 盘符那一支必须写成 `\b[A-Za-z]:[\\/]`（**前面带词边界**）：
//    没有 `\b` 时 `[A-Za-z]:[\\/]` 会连 `http://`（"p:/"）、`https://`（"s:/"）一起命中
//    —— 那样任何带网址的业务提示（如"请检查推送地址 https://qyapi.…"）都会被整句
//    换成通用文案。加了词边界后，盘符前面必然是空白/引号/中文/行首，而 http(s) 的
//    `p`/`s` 前面是字母，不构成边界，于是不再误伤。t13 的 N2b 两条分支都有断言。
const SENSITIVE_MSG_RE = /(sqlite|no such (table|column)|SQL logic error|constraint failed|malformed|unable to open database|database is locked|transaction within a transaction|no transaction is active|Cannot read propert|is not a function|is not defined|ENOENT|EACCES|EPERM|EISDIR|ENOTDIR|EBUSY|EMFILE|\b[A-Za-z]:[\\/]|\/(vol\d*|home|usr|var|opt|tmp|etc|root|mnt)\/)/i;
app.use((req, res, next) => {
  if (config.APP_MODE === 'dev') return next();
  const rawJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (body && typeof body === 'object' && typeof body.message === 'string'
        && body.message && SENSITIVE_MSG_RE.test(body.message)) {
        log.error('脱敏', `已隐藏内部错误细节: ${req.method} ${req.path}`, { reqId: req._reqId, raw: body.message });
        return rawJson({ ...body, message: '操作失败，请稍后重试；如持续失败请查看应用日志' });
      }
    } catch (e) { /* 脱敏绝不能反噬业务 */ }
    return rawJson(body);
  };
  next();
});

app.get('/api/health', (req, res) => {
  // 数据库健康：库损坏又没有可用备份时 status 变 degraded。
  // 目的就是消灭「网关显示健康、日志说就绪，但每个请求都失败」这种假正常。
  let dbHealth = null;
  try { dbHealth = require('./db').getDbHealth(); } catch (e) { /* 数据库尚未就绪 */ }
  const degraded = !!((dbHealth && dbHealth.ok === false) || (dbHealth && dbHealth.last_save_error));
  res.json({
    status: degraded ? 'degraded' : 'ok',
    version: config.APP_VERSION,
    uptime: Math.floor(process.uptime()),
    pid: process.pid,
    requests: requestCount,
    routes: loadedRoutes,
    db: dbHealth,
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

// 缓存策略的唯一真源：express.static 与 gzip 中间件都用它，
// 避免「压缩过的响应」和「原样响应」拿到两套 Cache-Control。
const assetsDirPrefix = path.join(assetsDir, path.sep);
function cacheControlFor(filePath) {
  // HTML 永不缓存：部署后必须立刻生效（它引用着新文件名的 JS）
  if (filePath.endsWith('.html') || filePath.endsWith('.htm')) {
    return 'no-store, no-cache, must-revalidate';
  }
  // assets/ 下的文件名自带内容 hash，内容一变文件名就变 ⇒ 可以放心永久缓存。
  // 用 immutable 后浏览器连「304 校验」那一轮往返都省了（旧的 no-cache 每次都要问一遍）。
  if (filePath.startsWith(assetsDirPrefix)) {
    return 'public, max-age=31536000, immutable';
  }
  return 'public, max-age=86400'; // 其他静态资源（UI 图片等，无 hash）缓存 1 天
}

// 把 URL 解析成静态目录下的真实文件路径，供 gzip 中间件判断是否值得压缩。
// ⚠️ 只解析、不发送；解析不出文件就留空，让请求照原样落到 express.static。
function resolveStaticFile(req, res, next) {
  let rel;
  try {
    rel = decodeURIComponent(req.path || '');
  } catch (e) {
    return next(); // URL 编码非法，交给下游处理
  }
  if (!rel || rel.includes('\0')) return next();

  let base;
  let sub;
  if (rel === '/assets' || rel.startsWith('/assets/')) {
    base = assetsDir;
    sub = rel.slice('/assets'.length);
  } else {
    base = staticDir;
    sub = rel;
  }
  const full = path.normalize(path.join(base, sub));
  // 防目录穿越：解析后必须仍在目标目录内
  if (!full.startsWith(path.join(base, path.sep))) return next();
  req._staticFilePath = full;
  next();
}

// 先解析路径，再尝试 gzip；不命中就直接放行给下面的 express.static
app.use(resolveStaticFile);
try {
  // ⚠️ cacheControlFor 必须传进去：压缩中间件自己发响应，不走 express.static 的
  // setHeaders，缓存头要按同一套规则再设一遍，否则压缩响应会丢掉 Cache-Control。
  app.use(require('./services/http-compress').gzipStatic({ cacheControlFor }));
} catch (e) {
  log.warn('压缩', `gzip 中间件未启用（不影响功能）: ${e.message}`);
}

if (fs.existsSync(assetsDir)) {
  app.use('/assets', express.static(assetsDir, {
    etag: true, lastModified: true,
    setHeaders: (res, filePath) => {
      res.set('Cache-Control', cacheControlFor(filePath));
    }
  }));
}

if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir, {
    etag: true, lastModified: true,
    setHeaders: (res, filePath) => {
      res.set('Cache-Control', cacheControlFor(filePath));
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
    './routes/dashboard',
    './routes/export',
    './routes/habit-checkin',
    './routes/supplement-checkin',
    './routes/app-config',
    './routes/diet',
    './routes/checkup-schedule',
    './routes/wecom',
    './routes/feishu',
    './routes/dingtalk',
    './routes/bark',
    './routes/push',
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
  // 退出前必须补一次落盘：数据是「内存数据库 + 每 30 秒整库落盘」，
  // 不补的话崩溃即丢掉最多 30 秒的写入（可能正是用户刚记的体重、刚上传的照片）。
  // SIGTERM/SIGINT 早就走 flushAndExit() 落盘了，这里原来漏了。
  try { require('./db').saveDb(); } catch (e) { /* 落盘失败也不能挡住退出 */ }
  // 退出进程避免处于未知状态（定时器将在下次启动时恢复）
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason) => {
  log.error('进程', 'unhandledRejection', { reason: String(reason) });
  // 同样补一次落盘：未处理的 Promise 拒绝往往发生在「刚写完数据、还没到落盘周期」的时刻
  try { require('./db').saveDb(); } catch (e) { /* ignore */ }
});

// 优雅退出：被系统停止（SIGTERM）或中断（SIGINT）时**先落盘再退出**。
// 数据是「内存数据库 + 每 30 秒整库落盘」，不在退出前补一次的话，
// 每次停止/升级应用都会丢掉最多 30 秒的写入（用户刚记的体重、刚上传的照片就没了）。
// saveDb() 是同步的，可以安全地放在 process.exit() 之前；
// 数据库尚未初始化或正处于恢复锁定中时它会自行跳过，不会抛错。
function flushAndExit(signal) {
  log.startup(`收到 ${signal}，进程退出`, { pid: process.pid, uptime: Math.floor(process.uptime()) });
  try {
    require('./db').saveDb();
    log.startup('退出前落盘完成');
  } catch (e) {
    log.warn('退出', `退出前落盘失败: ${e.message}`);
  }
  process.exit(0);
}
process.on('SIGTERM', () => flushAndExit('SIGTERM'));
process.on('SIGINT', () => flushAndExit('SIGINT'));

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

// ============ 每日推送调度器 ============
// 说明：推送调度器已统一放在 routes/wecom.js（读取设置页的「每日推送时间」push_time，
// 支持失败自动重试）。本文件此前还有一个硬编码 21:00 的重复调度器，它有两个问题：
//   1) 查询了不存在的 pregnancy.status 列（真实列名是 is_active）→ 每次都抛
//      「no such column: status」，从未真正推送成功过；
//   2) 与 wecom.js 的调度器并存 → 修好后会变成一天推两次。
// 因此这里整体移除，只保留 wecom.js 里那一个。
start().then(() => {
  log.startup('服务已就绪');
}).catch(err => {
  log.error('进程', '启动失败', { error: err.message });
  process.exit(1);
});
