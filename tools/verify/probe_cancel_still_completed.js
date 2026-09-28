/**
 * 复现/验证「取消完成在『用户还有手填产检记录』时不再自相矛盾」。
 *
 * 用户反馈：点「取消完成」提示已取消，界面却还是已完成。
 * 根因：显示口径 = 「周区间命中 ∪ 标记命中」，周区间命中把【用户自己填写的】
 *       产检记录也算进去。撤销自动标记后 loadAll() 一拉，手填记录又把这项判成完成。
 *
 * 修复：DELETE 返回 still_completed；前端据此保持状态并给出真实原因。
 *
 * 场景 A：无手填记录 —— 标记 → 取消 ⇒ 应 is_completed=false（正常取消）。
 * 场景 B：有手填记录（同孕周）—— 标记 → 取消 ⇒ 应 still_completed=true、
 *         GET 回来仍是完成（但不再「提示已取消却状态没变」）。
 *
 * 用法：node probe_cancel_still_completed.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-cancel-still');
const PORT = Number(process.env.PJ_TCP_PORT || 38502);

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev', FNOS_SOCKET_PATH: path.join(T, 'a.sock'), PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T, DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'), MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'), DATA_DIR: T, LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: path.join(ROOT, 'app/ui'),
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
  if (cond) { pass++; console.log(`  [OK]   ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${extra ? '  ← ' + extra : ''}`); }
}

(async () => {
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], { cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) {} };
  process.on('exit', cleanup);

  for (let i = 0; i < 60; i++) { await sleep(300); try { const r = await req('GET', '/api/v1/health'); if (r.status === 200) break; } catch (e) {} }

  try {
    const H = { 'Content-Type': 'application/json' };
    const p1 = await req('POST', '/api/v1/pregnancies', { last_period_date: '2026-06-01' });
    const pid = p1.json.data.id;

    const sched = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid));
    const items = sched.json.data;
    const target = items.find((x) => !x.is_completed);
    console.log(`目标: ${target.id} ${target.name}（${target.week_start}-${target.week_end} 周）`);

    console.log('\n===== 场景 A：没有手填记录（正常取消）=====');
    const mkA = await req('PUT', `/api/v1/checkup-schedule/${target.id}/complete?pregnancy_id=${encodeURIComponent(pid)}`);
    check('A1 标记完成成功', mkA.json.code === 0, mkA.json.message);
    const unA = await req('DELETE', `/api/v1/checkup-schedule/${target.id}/complete?pregnancy_id=${encodeURIComponent(pid)}`);
    check('A2 取消完成成功', unA.json.code === 0 && unA.json.data.changed > 0, JSON.stringify(unA.json.data));
    check('A3 后端明确「不会仍然完成」', unA.json.data.still_completed === false, `still_completed=${unA.json.data.still_completed}`);
    const gA = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid));
    const a3 = gA.json.data.find((x) => x.id === target.id);
    check('A4 界面口径回到未完成', a3.is_completed === false, `is_completed=${a3.is_completed}`);

    console.log('\n===== 场景 B：同孕周还有一条【用户手填】的记录 =====');
    // 手填记录：不带 MARK（notes 不是「从产检时间表标记完成」开头）→ 属于用户数据
    const ws = target.week_start, we = target.week_end;
    const mk = await req('POST', '/api/v1/checkups', {
        pregnancy_id: pid, checkup_date: '2026-09-20', gestational_week: ws,
        checkup_type: target.name, notes: '用户手填的产检记录', is_completed: 1, is_recommended: 1,
      });
    check('B1 手填记录写入成功', mk.json.code === 0, `code=${mk.json.code} ${mk.json.message}`);
    const g1 = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid));
    const b1 = g1.json.data.find((x) => x.id === target.id);
    check('B2 手填后该项显示为完成（周区间命中）', b1.is_completed === true);

    const mkB = await req('PUT', `/api/v1/checkup-schedule/${target.id}/complete?pregnancy_id=${encodeURIComponent(pid)}`);
    check('B3 再点「标记完成」成功', mkB.json.code === 0, mkB.json.message);
    const unB = await req('DELETE', `/api/v1/checkup-schedule/${target.id}/complete?pregnancy_id=${encodeURIComponent(pid)}`);
    check('B4 撤销了本页标记（changed>0）', unB.json.code === 0 && unB.json.data.changed > 0, JSON.stringify(unB.json.data));
    check('B5 后端如实回报「仍然完成」← 修复点', unB.json.data.still_completed === true,
      `still_completed=${unB.json.data.still_completed}`);
    check('B6 返回的 is_completed 与实际一致（true）', unB.json.data.is_completed === true,
      `is_completed=${unB.json.data.is_completed}`);
    const g2 = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid));
    const b2 = g2.json.data.find((x) => x.id === target.id);
    check('B7 手填记录未被破坏（仍是 is_completed=1 的用户数据）', b2.is_completed === true);

    console.log('\n===== 场景 C：极早期无标记记录的兜底取消不受影响 =====');
    // 造一条「带 MARK 但没有 [cs_xxx] 标记」的记录，落在同一孕周 → 兜底口径应能撤销
    const mkC = await req('POST', '/api/v1/checkups', {
        pregnancy_id: pid, checkup_date: '2026-09-21', gestational_week: ws,
        checkup_type: target.name + '（旧版）', notes: '从产检时间表标记完成: 旧版无标记', is_completed: 1, is_recommended: 1,
      });
    check('C1 造旧式标记记录成功', mkC.json.code === 0);
    const unC = await req('DELETE', `/api/v1/checkup-schedule/${target.id}/complete?pregnancy_id=${encodeURIComponent(pid)}`);
    check('C2 兜底口径撤销成功（changed>0）', unC.json.code === 0 && unC.json.data.changed > 0,
      JSON.stringify(unC.json.data));
  } catch (e) {
    fail++;
    console.log('\n[FATAL] ' + e.message);
    console.log(srvLog.slice(-1000));
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
})();
