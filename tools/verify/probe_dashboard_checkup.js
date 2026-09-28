/**
 * 复现：首页「最近产检」内容不对
 *
 * 背景：v0.0.28 及更早，后端「标记完成」用的是另一份 16 条排期（cs_00N 与界面的 15 条
 * 整体错位一项）⇒ 历史记录里存的是**邻居项目的名字与周数**（用户勾"大排畸"，
 * 库里却存"中期唐筛/无创DNA · 15周"）。首页「最近产检」直接显示库里原始字段。
 *
 * 另外两个疑点：「取消完成」（is_completed=0）的记录仍会被当成最近产检；
 * 「产检建议」列表不排除已完成项目。
 *
 * 用法：node probe_dashboard_checkup.js
 * （每个场景用独立孕期，互不干扰）
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-dashboard-checkup');
const PORT = Number(process.env.PJ_TCP_PORT || 38506);
const GW = '/app/pregnancyjournal';

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev', FNOS_SOCKET_PATH: path.join(T, 'a.sock'), PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T, DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'), MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'), DATA_DIR: T, LOG_DIR: path.join(T, 'logs'),
  ASSETS_DIR: path.join(NODE_DIR, 'data'),
};

function req(m, p, b = null) {
  return new Promise((resolve, reject) => {
    const pay = b ? JSON.stringify(b) : null;
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: m, headers: pay ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(pay) } : {} }, (res) => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (pay) r.write(pay);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ← ' + extra : '')); }
}

(async () => {
  const child = spawn(process.execPath, ['-r', SHIM, 'server.js'], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await req('GET', GW + '/api/v1/health'); if (r.status === 200) break; } catch (e) {} }

  const newPreg = async (tag) => {
    // 孕约 20 周：LMP = 今天 - 138 天
    const lmp = new Date(Date.now() - 138 * 86400000).toISOString().slice(0, 10);
    const r = await req('POST', GW + '/api/v1/pregnancies', { last_period_date: lmp });
    return r.json.data.id;
  };
  const dash = async (pid) => (await req('GET', `${GW}/api/v1/dashboard?pregnancy_id=${pid}`)).json.data;
  const fmtLc = (lc) => lc ? `${lc.checkup_type} · ${lc.checkup_date} · 孕${lc.gestational_week}周 · completed=${lc.is_completed}` : 'null';
  const fmtRecos = (d) => (d.recommended_todos || []).map(t => `${t.week_range}周:${t.name}`).join(' / ') || '(空)';

  console.log('===== 场景 A：正常标记 cs_004（大排畸）完成 =====');
  {
    const pid = await newPreg();
    await req('PUT', `${GW}/api/v1/checkup-schedule/cs_004/complete?pregnancy_id=${pid}`);
    const d = await dash(pid);
    console.log('  最近产检:', fmtLc(d.last_checkup));
    console.log('  产检建议:', fmtRecos(d));
    check('A1 最近产检 = 大排畸（系统超声）', d.last_checkup?.checkup_type === '大排畸（系统超声）', fmtLc(d.last_checkup));
    check('A2 最近产检周数 = 20', d.last_checkup?.gestational_week === 20, String(d.last_checkup?.gestational_week));
    check('A3 已完成的大排畸不再出现在「产检建议」', !(d.recommended_todos || []).some(t => /大排畸/.test(t.name || '')), fmtRecos(d));
  }

  console.log('\n===== 场景 B：历史错位行（v0.0.28 形态：名字=中期唐筛/无创DNA，周=15，标记 [cs_004]）=====');
  {
    const pid = await newPreg();
    await req('POST', GW + '/api/v1/checkups', {
      pregnancy_id: pid, checkup_date: '2026-08-15', gestational_week: 15,
      checkup_type: '中期唐筛/无创DNA', notes: '从产检时间表标记完成: 无创DNA [cs_004]', is_completed: 1,
    });
    const d = await dash(pid);
    console.log('  最近产检:', fmtLc(d.last_checkup));
    check('B1 最近产检名字按 [cs_004] 还原为 大排畸（系统超声）', d.last_checkup?.checkup_type === '大排畸（系统超声）', fmtLc(d.last_checkup));
    check('B2 周数还原为 20（不是旧口径的 15）', d.last_checkup?.gestational_week === 20, String(d.last_checkup?.gestational_week));
  }

  console.log('\n===== 场景 C：标记 cs_002 后立刻取消 =====');
  {
    const pid = await newPreg();
    await req('PUT', `${GW}/api/v1/checkup-schedule/cs_002/complete?pregnancy_id=${pid}`);
    await req('DELETE', `${GW}/api/v1/checkup-schedule/cs_002/complete?pregnancy_id=${pid}`);
    const d = await dash(pid);
    console.log('  最近产检:', fmtLc(d.last_checkup));
    check('C1 已取消的记录不出现在「最近产检」', d.last_checkup == null || d.last_checkup.checkup_type !== 'NT检查（早期唐筛）', fmtLc(d.last_checkup));
  }

  console.log('\n===== 场景 D：取消一条后，应回落到更早的有效记录 =====');
  {
    const pid = await newPreg();
    await req('POST', GW + '/api/v1/checkups', {
      pregnancy_id: pid, checkup_date: '2026-08-01', gestational_week: 6,
      checkup_type: '早孕检查（首次产检·建档）', notes: '从产检时间表标记完成: 建档 [cs_001]', is_completed: 1,
    });
    await req('PUT', `${GW}/api/v1/checkup-schedule/cs_002/complete?pregnancy_id=${pid}`);
    await req('DELETE', `${GW}/api/v1/checkup-schedule/cs_002/complete?pregnancy_id=${pid}`);
    const d = await dash(pid);
    console.log('  最近产检:', fmtLc(d.last_checkup));
    check('D1 回落到更早的有效记录（早孕检查）', d.last_checkup?.checkup_type === '早孕检查（首次产检·建档）', fmtLc(d.last_checkup));
  }

  console.log('\n================ 结果 ================');
  console.log(`总计 ${pass} 通过 / ${fail} 失败`);
  console.log('\n--- 服务端日志尾部（checkup/dashboard 相关）---');
  console.log(srvLog.split('\n').filter((l) => /checkup|dashboard/i.test(l)).slice(-6).join('\n'));

  cleanup();
  process.exit(fail > 0 ? 1 : 0);
})();
