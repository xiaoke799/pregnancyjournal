const path = require('path');

// 日期格式校验正则（YYYY-MM-DD）
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// 时区安全的日期校验：纯按年月日判断，不做本地时区→UTC 的转换。
// ⚠️ 旧实现 `new Date(str + 'T00:00:00')` 会按【本地时间】解析，再用 toISOString()（UTC）
// 取回日期；在东八区等 UTC 以东时区会把当天零点回退成前一天，导致**所有合法日期都判为非法**。
// 后果：POST /checkups 恒报「checkup_date 格式无效」，产检建档失败。
function isValidDate(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_REGEX.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 本地日期 YYYY-MM-DD —— 运行时「今天」的唯一正确取法。
// ⚠️ 绝不能用 `new Date().toISOString().slice(0, 10)`：那是 **UTC**，
// 东八区（及所有 UTC 以东时区）在 00:00~08:00 会算成**前一天**。
// 受影响面：宫缩/胎动会话默认日期、提醒「今天到期」边界、照片归档目录、
// 每日记录默认日期、导出文件名 —— 均曾因此差一天（2026-09-25 统一修复）。
function localToday(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// 本地时间戳 "YYYY-MM-DDTHH-mm-ss"（文件名安全：不含冒号/点）。
// 与旧写法 `new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)` 形状完全一致，
// 只是改用本地时间，避免备份/导出目录名在凌晨落到前一天。
function localFileTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
       + `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// 业务数据根目录：优先 STORAGE_DIR（cmd/main 已导出为 ${TRIM_PKGVAR}/data，持久化、可写），
// 否则退回 process.cwd()/data。
// ⚠️ 关键：生产环境 cwd 是 ${TRIM_APPDEST}/server/node（应用安装目录），
// 如果把照片/报告/导出/备份都写进去，会随升级被覆盖、且用户看不到文件。
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(process.cwd(), 'data');

// 内置只读资源目录（随安装包发布）：checkup_schedule.json / recipes.json /
// food_safety_v3.json / default_checklist_*.json 等。
// ⚠️ 必须与 DATA_DIR 区分开：这些文件是「应用自带的静态知识库」，不是用户数据，
// 一旦被指到 STORAGE_DIR 就会全部读不到（表现为：食材安全空、待产清单初始化空、
// 菜谱只剩兜底数据、产检计划时间轴空）。
// 用 __dirname 解析，避免依赖 cwd（服务可能被以任意工作目录拉起）。
const ASSETS_DIR = process.env.ASSETS_DIR || path.join(__dirname, 'data');

// 应用共享目录（data-share，用户可在文件管理器中看到并手动取走备份/导出）
const SHARE_DIR = (process.env.TRIM_DATA_SHARE_PATHS || '')
  .split(':').map(s => s.trim()).filter(Boolean)[0] || '';

const config = {
  SHARE_DIR,
  STORAGE_DIR,
  // 内置只读知识库目录（菜谱/食材安全/待产清单/产检计划…）——只读，勿写入
  ASSETS_DIR,
  DATABASE_PATH: process.env.DATABASE_PATH || path.join(STORAGE_DIR, 'pregnancyjournal.db'),
  PHOTOS_DIR: process.env.PHOTOS_DIR || path.join(STORAGE_DIR, 'photos'),
  THUMBNAILS_DIR: process.env.THUMBNAILS_DIR || path.join(STORAGE_DIR, 'thumbnails'),
  MEDIA_DIR: process.env.MEDIA_DIR || path.join(STORAGE_DIR, 'media'),
  BACKUPS_DIR: process.env.BACKUPS_DIR || path.join(STORAGE_DIR, 'backups'),
  // 可写状态目录：wecom.json / daily_push_state.json / schedule_dates.json / uploads/ 等
  // 注意：这里**不是**内置资源目录，内置资源请用 config.ASSETS_DIR
  DATA_DIR: process.env.DATA_DIR || STORAGE_DIR,
  STATIC_DIR: process.env.STATIC_DIR || path.join(process.cwd(), 'ui'),
  PORT: parseInt(process.env.TRIM_SERVICE_PORT || process.env.PORT || '3867', 10),
  TRIM_SERVICE_PORT: process.env.TRIM_SERVICE_PORT || '3867',
  APP_MODE: process.env.APP_MODE || 'dev',
  APP_VERSION: '0.0.29',
  // FnOS 统一网关模式：优先用 FNOS_SOCKET_PATH（由 cmd/main 导出）
  FNOS_SOCKET_PATH: process.env.FNOS_SOCKET_PATH || '',
  TRIM_APPDEST: process.env.TRIM_APPDEST || '',
  TRIM_PKGVAR: process.env.TRIM_PKGVAR || '',
  TRIM_DATA_SHARE_PATHS: process.env.TRIM_DATA_SHARE_PATHS || '',
  DATE_REGEX,
  isValidDate,
  localToday,
  localFileTimestamp,
};

module.exports = config;
