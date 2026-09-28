/**
 * 推送记录「条数上限」核查
 *
 * 背景（用户反馈）：推送记录「全部」会把页面无限拉长。
 * 前端已改成区域内滚动；但**光靠滚动不够** —— 后端原本 `SELECT * FROM push_log`
 * 没有任何 LIMIT，应用每天推送，几年下来一次返回几千条、前端全部渲染成 DOM。
 *
 * 本脚本在临时库里塞 350 条记录，断言：
 *   · 默认 / 显式 limit ⇒ 最多返回 limit 条，且是**最新的那些**（倒序）
 *   · limit <= 0 ⇒ 不限量（内部用）
 *   · 过滤条件（今天/近7天）在限量下仍然正确
 *
 * 用法：node verify_push_log_limit.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-pushlog-limit');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

// 让 config 指向临时目录（必须在 require 之前设好）
process.env.APP_MODE = 'dev';
process.env.STORAGE_DIR = T;
process.env.DATA_DIR = T;
process.env.DATABASE_PATH = path.join(T, 'pj.db');
process.env.ASSETS_DIR = path.join(NODE_DIR, 'data');
process.env.LOG_DIR = path.join(T, 'logs');
process.env.BACKUPS_DIR = path.join(T, 'backups');
process.chdir(NODE_DIR);

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

(async () => {
  const db = require(path.join(NODE_DIR, 'db.js'));
  const engine = require(path.join(NODE_DIR, 'services/push-engine.js'));

  await db.initDb();

  const TOTAL = 350;
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // 造 350 条记录，**每条日期各不相同**（相差 i 天）。
  // ⚠️ 不能让多条共享同一时间戳：created_at 并列时 SQLite 的排序不保证稳定，
  // 「第 300 条是谁」就变得不确定 —— 第一版就是这么写错的（不是产品代码的问题）。
  for (let i = 0; i < TOTAL; i++) {
    const d = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const ts = `${dayStr(d)} ${pad(9 + (i % 10))}:00:00`;
    db.run(
      `INSERT INTO push_log (id, push_type, push_content, status, channel, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`log_${String(i).padStart(4, '0')}`, 'daily', `第 ${i} 条`, 'success', i % 2 ? 'wecom' : 'feishu', ts]
    );
  }
  const all = db.queryAll('SELECT COUNT(*) AS n FROM push_log')[0].n;
  check(`造了 ${TOTAL} 条推送记录（实际 ${all}）`, all === TOTAL);

  out.push('');
  out.push('【默认限量】');
  const def = engine.queryPushLogs('all', '');
  check('不传 limit ⇒ 最多 300 条（原来会返回全部 350）', def.length === 300, `实际 ${def.length}`);
  check('返回的是**最新**的（倒序，第一条应是 log_0000）', def[0].id === 'log_0000', `实际 ${def[0].id}`);
  check('末条是第 300 条（log_0299）', def[def.length - 1].id === 'log_0299', `实际 ${def[def.length - 1].id}`);

  out.push('');
  out.push('【显式 limit】');
  check('limit=10 ⇒ 10 条', engine.queryPushLogs('all', '', 10).length === 10);
  check('limit=1000（超过总量）⇒ 全部 350 条', engine.queryPushLogs('all', '', 1000).length === TOTAL);
  check('limit=0 ⇒ 不限量（内部用，返回全部 350）', engine.queryPushLogs('all', '', 0).length === TOTAL);
  check('limit=-1 ⇒ 不限量', engine.queryPushLogs('all', '', -1).length === TOTAL);

  out.push('');
  out.push('【限量与过滤条件共存】');
  const todayLogs = engine.queryPushLogs('today', '', 300);
  check('filter=today 仍然只返回今天的', todayLogs.every((r) => String(r.created_at).startsWith(dayStr(today))),
    `条数=${todayLogs.length}`);
  const week = engine.queryPushLogs('week7', '', 300);
  check('filter=week7 返回条数 ≤ 300 且都是近 7 天',
    week.length <= 300 && week.every((r) => r.created_at >= dayStr(new Date(today.getTime() - 6 * 24 * 3600 * 1000))),
    `条数=${week.length}`);
  const ch = engine.queryPushLogs('all', 'feishu', 300);
  check('按渠道过滤后仍是最近 300 条之内的飞书记录',
    ch.length > 0 && ch.every((r) => r.channel === 'feishu'), `条数=${ch.length}`);

  // ============ 保留策略：只记录最近一个月 ============
  out.push('');
  out.push('【保留策略：只保留最近 30 天】');
  // 用**明确的边界样本**断言，不靠"大概多少条"：
  // 固定用 00:00:00 的时间，避免"现在几点"影响 30 天整那一条的判定。
  const keepIds = ['keep_5d', 'keep_29d'];
  const delIds = ['del_40d', 'del_200d'];
  const mkStamp = (daysAgo) => `${dayStr(new Date(today.getTime() - daysAgo * 24 * 3600 * 1000))} 00:00:00`;
  const samples = [
    ['keep_5d', 5], ['keep_29d', 29], ['del_40d', 40], ['del_200d', 200],
  ];
  for (const [id, daysAgo] of samples) {
    db.run(
      `INSERT INTO push_log (id, push_type, push_content, status, channel, created_at)
       VALUES (?, 'daily', ?, 'success', 'wecom', ?)`,
      [id, `边界样本 ${daysAgo} 天前`, mkStamp(daysAgo)]
    );
  }
  const beforeTotal = db.queryAll('SELECT COUNT(*) AS n FROM push_log')[0].n;
  const removed = engine.pruneOldPushLogs();
  const afterTotal = db.queryAll('SELECT COUNT(*) AS n FROM push_log')[0].n;
  const remainIds = db.queryAll('SELECT id FROM push_log').map((r) => r.id);

  check('清理确实删掉了记录', removed > 0, `删除 ${removed} 条`);
  check(`剩余条数 = 清理前 - 删除数（${beforeTotal} - ${removed} = ${afterTotal}）`,
    beforeTotal - removed === afterTotal);
  for (const id of keepIds) {
    check(`30 天内的样本保留：${id}`, remainIds.includes(id));
  }
  for (const id of delIds) {
    check(`超出 30 天的样本被清理：${id}`, !remainIds.includes(id));
  }
  check('剩余记录全部在 30 天以内', db.queryAll(
    'SELECT COUNT(*) AS n FROM push_log WHERE created_at < ?',
    [mkStamp(30)]
  )[0].n === 0);
  check('重复调用是幂等的（第二次删除 0 条）', engine.pruneOldPushLogs() === 0);
  check('返回的条数上限逻辑不受清理影响（仍能取到记录）',
    engine.queryPushLogs('all', '').length > 0);

  console.log(out.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  try { db.saveDb(); } catch {}
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.log('[FATAL] ' + e.message);
  console.log(e.stack);
  process.exit(1);
});
