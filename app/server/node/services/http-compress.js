/**
 * 静态资源 gzip 压缩中间件 —— 零依赖（Node 内置 zlib）。
 *
 * 【为什么自己写而不用 compression 包】
 * 打包环境（fnOS）的 node_modules 是随包发布的，加一个新依赖意味着设备上要能联网
 * npm install，失败就直接起不来。zlib 是 Node 自带的，不需要任何安装步骤。
 *
 * 【为什么要自己缓存】
 * 首屏主包 1.40 MB，gzip 一次约 30~60 ms（本机）／数百 ms（NAS 弱 CPU）。
 * 如果每个请求都压一遍，省下的带宽又被 CPU 吃回去了。这里**每个文件只压一次**，
 * 结果按「路径 + 修改时间 + 大小」缓存，之后直接送缓存的 Buffer。
 *
 * 【刻意不做的事】
 * - 不压缩 < 1 KB 的响应：压缩收益为负，还白白占缓存。
 * - 不碰图片/视频/字体：这些格式本身已经压过，再压纯浪费 CPU。
 * - 不支持 gzip 的客户端直接 next()，交给 express.static 原样发送。
 * - 不处理 Range：本中间件只覆盖带 hash 的前端资源，不涉及断点续传场景。
 */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// 值得压缩的扩展名（都是文本类，压缩率 60%~80%）
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.htm', '.json', '.svg', '.xml', '.txt', '.map']);

// 小于这个体积不压（字节）
const MIN_SIZE = 1024;

// 缓存上限：前端资源数量有限（约几十个），设个上限防止无限增长
const MAX_CACHE_ENTRIES = 200;

const cache = new Map();

// 压完反而更大的文件（极少数，比如本身已是压缩数据）：记下来别每次都白压一遍
const notWorthIt = new Set();

function cacheKey(stat) {
  // 文件被重新构建（内容变了）时 mtime/size 必然变化 ⇒ key 变化 ⇒ 自动重压
  return `${stat.size}:${stat.mtimeMs}`;
}

function remember(filePath, key, buffer) {
  // 极简 FIFO：超出上限就丢最早的（Map 保持插入顺序）
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(filePath, { key, buffer });
}

function shouldCompress(filePath, acceptEncoding) {
  if (!/\bgzip\b/.test(acceptEncoding || '')) return false;
  const ext = path.extname(filePath).toLowerCase();
  return COMPRESSIBLE.has(ext);
}

/**
 * 返回 gzip 中间件。命中条件：GET/HEAD + 客户端支持 gzip + 扩展名在白名单 + 文件够大。
 * 不命中一律 next()，行为与原来完全一致。
 *
 * ⚠️ options.cacheControlFor 必传：本中间件是自己发响应的，**不会**经过
 * express.static 的 setHeaders，缓存头必须在这里照同一套规则再设一遍
 * （否则压缩过的响应就没有 Cache-Control 了，与未压缩响应行为不一致）。
 */
function gzipStatic(options = {}) {
  const cacheControlFor = typeof options.cacheControlFor === 'function' ? options.cacheControlFor : null;
  return function gzipMiddleware(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // 交给调用方解析出真实文件路径（见 server.js）；拿不到就放行
    const filePath = req._staticFilePath;
    if (!filePath) return next();

    if (!shouldCompress(filePath, req.headers['accept-encoding'])) return next();

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (e) {
      return next();
    }
    if (!stat.isFile() || stat.size < MIN_SIZE) return next();

    const key = cacheKey(stat);
    // 这个文件上次压过、结论是"不值得压"——别每个请求都白压一遍
    if (notWorthIt.has(filePath) && notWorthIt.has(filePath + '|' + key)) return next();

    let entry = cache.get(filePath);
    if (!entry || entry.key !== key) {
      let raw;
      try {
        raw = fs.readFileSync(filePath);
      } catch (e) {
        return next();
      }
      let gzipped;
      try {
        gzipped = zlib.gzipSync(raw, { level: 6 });
      } catch (e) {
        return next(); // 压缩失败就降级为不压缩，绝不让资源发不出去
      }
      // 压完反而更大（极少见，比如已经是压缩数据）——放弃压缩，并记住这个结论
      if (gzipped.length >= raw.length) {
        notWorthIt.add(filePath);
        notWorthIt.add(filePath + '|' + key);
        return next();
      }
      entry = { key, buffer: gzipped };
      remember(filePath, key, gzipped);
    }

    // 与 express.static 一样给出校验器：否则同一份文件「压缩响应没有 ETag、原样响应有」，
    // 两边缓存行为不一致，重新部署后也没法被条件请求触发回源。
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    res.set('ETag', etag);
    // 必须声明 Vary：否则中间代理可能把 gzip 响应发给不支持 gzip 的客户端
    res.set('Vary', 'Accept-Encoding');
    // 与 express.static 用同一套缓存策略（唯一真源在 server.js）
    if (cacheControlFor) {
      const cc = cacheControlFor(filePath);
      if (cc) res.set('Cache-Control', cc);
    }

    // 条件请求命中：304，一个字节都不传
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.set('Content-Encoding', 'gzip');
    res.set('Content-Type', MIME[ext] || 'application/octet-stream');
    res.set('Content-Length', String(entry.buffer.length));

    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(entry.buffer);
  };
}

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** 供外部（如核查脚本）查看压缩缓存状态 */
function stats() {
  return { entries: cache.size, max: MAX_CACHE_ENTRIES };
}

module.exports = { gzipStatic, stats };
