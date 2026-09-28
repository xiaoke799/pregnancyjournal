/**
 * 测试垫片：把 server.js 的 Unix Socket 监听透明改写为 TCP 环回。
 *
 * 为什么需要它：本机安全策略禁止监听 Unix Domain Socket
 * （任何路径都报 listen EACCES: permission denied），而 server.js 只支持
 * `app.listen(<socketPath>)`。用 -r 预加载本文件即可在不改动产品代码的前提下
 * 让真实 server.js 完整跑起来（含全部 20 个路由、中间件、错误处理）。
 */
const net = require('net');
const PORT = Number(process.env.PJ_TCP_PORT || 38471);

const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  if (typeof args[0] === 'string') {
    const cb = args.slice(1).find((a) => typeof a === 'function');
    const opts = args.slice(1).find((a) => a && typeof a === 'object') || {};
    return origListen.call(this, { ...opts, port: PORT, host: '127.0.0.1' }, cb);
  }
  return origListen.apply(this, args);
};

module.exports = { PORT };
