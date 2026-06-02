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
