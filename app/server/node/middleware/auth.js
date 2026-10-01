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

/**
 * 直连本机 / 内网 —— 可信来源判定。
 *
 * ⚠️ 只用 express 的 `req.ip`（它本身从 socket 派生、且遵循 trust proxy 决策）。
 *    不要再回退去读 `req.socket.remoteAddress`：那是第二处出处，还会绕开 trust proxy 的判断。
 * ⚠️ **拿不到 IP 一律不视为本地**。历史坑：本判定原写在 logs.js，写成
 *    `if (!req.ip || req.ip === 'unknown') return true;` —— 而真实部署所有请求都从统一网关
 *    经 Unix Socket 进来、**根本没有 IP** ⇒ 那条「仅允许本地访问」在线上恒真、形同虚设。
 */
function isDirectLocal(req) {
  const ip = req.ip || '';
  if (!ip || ip === 'unknown') return false;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (ip.startsWith('192.168.') || ip.startsWith('::ffff:192.168.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('::ffff:10.')) return true;
  // 172.16.0.0/12
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  return false;
}

/**
 * 「整体性 / 破坏性操作」的管理员闸门（2026-09-30 上架前加固 B2）。
 *
 * 【为什么需要】应用内**有意不做用户隔离**（家庭共用是设计目标），网关鉴权只保证
 * 「登录过 NAS」。于是在这之前，NAS 上**任何账号**都能：恢复/导入备份（整库覆盖）、
 * 导出整份数据、浏览并下载任意目录、改推送配置、读日志 —— 孕期照片与产检报告
 * 等于对全家人（以及任何拿到 NAS 账号的人）敞开。
 *
 * 【范围】只锁**整体性 / 破坏性**操作：
 *   备份/恢复/导入/整库覆盖、整份数据导出、目录浏览与下载、改授权目录、改推送配置、看/清日志。
 *   ⚠️ **明确不锁**：逐条增删改（记一笔、删错的那一条、传照片）、单份 CSV / 日记 PDF / 相册 PDF 导出、
 *   以及一切只读查询。⇒ 家人的**可见性与日常操作零变化**，只是「能把全部数据抹掉 / 整份拿走」的路被堵上。
 *
 * 【语义】与 logs.js 原有的 checkAdmin **逐字一致**（本次只是抽出来共用，不引入新判定）：
 *   ① `APP_MODE=dev` → 放行（本地调试，也是回归套件跑的模式）
 *   ② 网关身份（auth_source === 'gateway'）→ 必须是 `is_admin === 'true'`
 *   ③ 直连本机/内网（isDirectLocal）→ 视为可信
 *   ④ 其余 → 403
 *
 * ⚠️ 本闸门**不改变可见性**，不要拿它当"用户隔离"用 —— 零隔离是有意决策。
 */
function requireAdmin(req, res, next) {
  if (config.APP_MODE === 'dev') return next();
  const st = req.state || {};
  if (st.auth_source === 'gateway') {
    if (st.is_admin === 'true') return next();
    return res.status(403).json({
      code: 403,
      data: null,
      message: '需要管理员权限：该操作会影响全部数据，仅管理员可执行',
    });
  }
  if (isDirectLocal(req)) return next();
  return res.status(403).json({
    code: 403,
    data: null,
    message: '需要管理员权限：该操作会影响全部数据，仅管理员可执行',
  });
}

module.exports = authMiddleware;
// 具名导出：供路由挂闸门用（`router.post('/restore', requireAdmin, handler)`）
module.exports.requireAdmin = requireAdmin;
module.exports.isDirectLocal = isDirectLocal;
