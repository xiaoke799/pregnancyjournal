/**
 * 认证中间件（单用户 NAS 应用模式）
 *
 * 设计意图：本应用部署在 fnOS/NAS 上，属于单用户家庭内网场景，
 * 无需严格的账号密码认证。此中间件的有意设计如下：
 * 1. 尝试从请求头读取用户信息（兼容未来多用户扩展）
 * 2. 若无用户信息，检查 fnOS 的 fn_token cookie
 * 3. 若仍无，直接放行并标记为 local_user（本地用户）
 * 4. 所有 /api/ 路由均放行，不做 token 验证或权限拦截
 *
 * 如需启用严格认证，取消下方 fallback 赋值并添加 token 校验逻辑。
 */

const config = require('../config');

function authMiddleware(req, res, next) {
  const getUserId = () => {
    const header = (config.HEADER_USER_ID || 'x-user-id').toLowerCase()
    return req.headers[header] || ''
  }
  const getUsername = () => {
    const header = (config.HEADER_USERNAME || 'x-username').toLowerCase()
    return req.headers[header] || ''
  }

  req.state = {
    user_id: getUserId(),
    is_admin: 'false',
    username: getUsername(),
  };

  if (!req.state.user_id) {
    const token = (req.cookies && req.cookies.fn_token) || '';
    if (token) {
      req.state.user_id = 'local_user';
      req.state.username = '本地用户';
    }
  }

  const whitelist = ['/api/health', '/docs', '/openapi.json', '/redoc'];
  if (whitelist.some(p => req.path.startsWith(p))) return next();
  if (!req.path.startsWith('/api/')) return next();

  if (!req.state.user_id) {
    req.state.user_id = 'local_user';
    req.state.username = '本地用户';
  }
  next();
}

module.exports = authMiddleware;
