/**
 * 认证中间件（飞牛 OS 统一网关模式）
 *
 * 通过统一网关访问时，fnOS 会先校验用户会话，再转发请求并在 Header 中携带用户信息：
 *   - X-Trim-Userid:   当前用户 UID
 *   - X-Trim-Isadmin:  是否为管理员 ("true"/"false")
 *   - X-Trim-Username: 当前用户名
 *
 * 审核要求：接入统一网关后，必须校验网关 Header，禁止无鉴权访问。
 * - fnOS 生产模式（APP_MODE=fnos）：缺少网关 Header 的请求返回 401
 * - 开发模式（APP_MODE=dev）：允许 fallback 到 local_user 便于本地调试
 *
 * 应用需负责自身的业务鉴权规则（用户只能访问自己的数据、管理接口需管理员身份等）。
 */

const config = require('../config');

function authMiddleware(req, res, next) {
  const uid = (req.headers['x-trim-userid'] || '').trim();
  const isAdmin = req.headers['x-trim-isadmin'] === 'true';
  const username = (req.headers['x-trim-username'] || '').trim();

  req.state = {
    user_id: uid,
    is_admin: isAdmin ? 'true' : 'false',
    username: username || (uid ? `user_${uid}` : ''),
    auth_source: uid ? 'gateway' : 'none',
  };

  // 公开白名单路由（无需鉴权）
  const whitelist = ['/api/health', '/docs', '/openapi.json', '/redoc'];
  if (whitelist.some(p => req.path.startsWith(p))) return next();

  // 非 API 路由（静态文件等）放行
  if (!req.path.startsWith('/api/')) return next();

  // 生产模式（fnOS 网关）：必须有网关鉴权 Header，否则拒绝
  if (config.APP_MODE === 'fnos') {
    if (!uid) {
      return res.status(401).json({
        code: 401,
        data: null,
        message: 'Unauthorized: missing gateway authentication headers',
      });
    }
    // 网关已通过鉴权，放行
    return next();
  }

  // 开发模式：允许 fallback 便于本地调试
  if (!uid) {
    req.state.user_id = 'local_user';
    req.state.username = '本地用户';
    req.state.auth_source = 'fallback';
  }
  next();
}

module.exports = authMiddleware;
