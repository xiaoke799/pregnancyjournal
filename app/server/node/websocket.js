/**
 * 孕程记 - WebSocket 服务
 *
 * 根据飞牛官方 FnOS 网关文档 (references/gateway.md)：
 *   WebSocket 复用同一个网关前缀和 Socket，
 *   前端连接 wss://<host>/app/pregnancyjournal/ws，
 *   后端在主 HTTP Server 上监听 upgrade 事件处理。
 *
 * 本模块导出 attachWebSocketServer(server, path)，
 * 把 WebSocket 处理挂载到已有的 Express HTTP Server 上。
 *
 * 支持的 type 参数（通过 query string）：
 *   - main：主桌面通信通道（桌面关闭通知等）
 *   - timer：计时器通道（后台定时事件）
 */
const WebSocket = require('ws');
const log = require('./logger');
const config = require('./config');
const { randomUUID } = require('crypto');

function attachWebSocketServer(server, wsPath) {
  // noServer 模式：我们自己处理 upgrade
  const wss = new WebSocket.Server({
    noServer: true,
    maxPayload: 1 * 1024 * 1024,  // 1MB
  });

  // 连接管理
  const clients = new Map(); // type -> Set<ws>

  // 安全发送辅助
  function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); }
      catch (e) { log.warn('WebSocket', `发送失败 [${ws._wsId}] ${e.message}`); }
    }
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');

    // 只处理匹配的 WebSocket 路径
    // upgrade 请求不经过 Express 中间件，需同时兼容两种形态：
    // 网关转发带前缀 /app/pregnancyjournal/ws，本地直连为 /ws
    if (url.pathname !== '/ws' && url.pathname !== '/app/pregnancyjournal/ws') {
      return;
    }

    // --- 认证：upgrade 事件绕过 Express authMiddleware，需在此处校验 ---
    if (config.APP_MODE === 'fnos') {
      const uid = (request.headers['x-trim-userid'] || '').trim();
      if (!uid) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        log.warn('WebSocket', '拒绝无认证连接（缺少 X-Trim-Userid）');
        return;
      }
    }

    const type = url.searchParams.get('type') || 'main';

    wss.handleUpgrade(request, socket, head, (ws) => {
      const id = randomUUID().slice(0, 8);
      ws._wsId = id;
      ws._wsType = type;
      ws._connectedAt = Date.now();
      ws.isAlive = true;

      if (!clients.has(type)) clients.set(type, new Set());
      clients.get(type).add(ws);

      log.info('WebSocket', `连接建立 [${id}] type=${type}`);

      // 握手响应
      safeSend(ws, JSON.stringify({
        type: 'hello',
        connectionId: id,
        timestamp: Date.now(),
        app: 'pregnancyjournal',
      }));

      ws.on('message', (data) => {
        let payload;
        try {
          payload = JSON.parse(data.toString());
        } catch {
          payload = { raw: data.toString().slice(0, 100) };
        }
        log.debug('WebSocket', `消息 [${id}] ${JSON.stringify(payload).slice(0, 120)}`);

        if (payload.type === 'ping' || payload.action === 'ping') {
          safeSend(ws, JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      });

      ws.on('close', (code, reason) => {
        const set = clients.get(type);
        set?.delete(ws);
        if (set && set.size === 0) clients.delete(type);  // 清理空 Set
        log.info('WebSocket', `连接关闭 [${id}] code=${code}`, {
          duration: Date.now() - ws._connectedAt,
        });
      });

      ws.on('error', (err) => {
        log.warn('WebSocket', `错误 [${id}] ${err.message}`);
        const set = clients.get(type);
        set?.delete(ws);
        if (set && set.size === 0) clients.delete(type);
      });

      ws.on('pong', () => { ws.isAlive = true; });
    });
  });

  // 定期心跳（25 秒，远低于 nginx 默认 60s timeout）
  const HEARTBEAT_INTERVAL = 25000;
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        log.info('WebSocket', `心跳超时，终止 [${ws._wsId}]`);
        return ws.terminate();
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, HEARTBEAT_INTERVAL);

  server.on('close', () => clearInterval(heartbeat));

  log.startup(`WebSocket 服务附加成功，路径: ${wsPath || '/ws'}`);

  return { wss, clients };
}

module.exports = { attachWebSocketServer };
