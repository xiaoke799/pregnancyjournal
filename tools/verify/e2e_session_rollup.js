/**
 * 胎动 / 宫缩会话 → 当天记录 的联动核验（真后端 · 端到端）
 *
 * 【为什么需要它】用户反馈：「你的胎动、宫缩和记录页功能没联动起来啊，
 * 首页相关功能是展示和快捷记录啊」。
 * 根因是三处断裂，本脚本逐条钉死：
 *   ① **双存储不通**：计数器写 `fetal_movement_session`/`fetal_movement`，
 *      计时器写 `contraction_session`/`contraction`，
 *      而记录列表 / 统计页 / CSV 导出**全都只读 `daily_record`**
 *      ⇒ 用户在计数器里数完 20 分钟、点「结束计数」回首页，数据在库里却哪儿都看不见。
 *   ② 记录页看不到「每次会话」（只有合并后的一行汇总）。
 *   ③ 首页卡片纯跳转，不展示今日数据、也不能就地记一笔。
 *
 * 本脚本覆盖 ① 与 ②（③ 是纯前端，由工具卡渲染探针覆盖）。四条核心口径：
 *   A. 会话结束 / 每记一次 ⇒ 汇总写回当天记录（不用等「结束」也不会丢）
 *   B. 单位不能错：`contraction_interval` 存**分钟**（会话里的 avg_interval 是**秒**），
 *      `contraction_duration` 存**秒**（与统计页 unit="秒" 一致）
 *   C. 当天会话明细可取回（同一天多次会话**每一次都留痕**，不被合并掉）
 *   D. **零影响**：当天没有会话时一个字段都不写 —— 只手填的用户行为完全不变，
 *      更不会把用户手填的时长抹成空
 *
 * 用法：node e2e_session_rollup.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const env = require('./_env');
const NODE_DIR = env.SERVER_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38557);
const T = path.join(env.TMP, 'session-rollup');
fs.mkdirSync(T, { recursive: true });

const serverEnv = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T,
  DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'),
  MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
};

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) {
  if (!pid) return;
  try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}
/** 数值比较（读回来的可能是字符串，老库列类型是 TEXT） */
function num(v) { return v === null || v === undefined || v === '' ? null : Number(v); }

const DATE = '2026-09-30';   // 有会话的一天
const DATE2 = '2026-09-29';  // 只手填、无会话
const DATE3 = '2026-09-28';  // 手填时长 + 一个**未结束**的会话

(async () => {
  const SHIM = path.join(env.VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => killTree(child.pid);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const h = await req('GET', '/app/pregnancyjournal/api/health'); if (h.json && h.json.status === 'ok') { ready = true; break; } } catch (e) { /* 等 */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1200)); cleanup(); process.exit(2); }

  const GW = '/app/pregnancyjournal';
  const API = GW + '/api/v1';
  const p = await req('POST', API + '/pregnancies', { last_period_date: '2026-01-01' });
  const pid = p.json && p.json.data && p.json.data.id;
  check('建孕期', !!pid, JSON.stringify(p.json && p.json.message));
  if (!pid) { cleanup(); process.exit(2); }

  const dayRecord = async (d) => {
    const r = await req('GET', `${API}/daily-records/by-date/${d}?pregnancy_id=${pid}`);
    return (r.json && r.json.data) || null;
  };

  // ========================================================================
  console.log('\n########## A. 胎动：每记一次就写回，同一天多次会话相加 ##########');
  // ========================================================================
  const s1 = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: DATE });
  const sid1 = s1.json && s1.json.data && s1.json.data.id;
  check('建胎动会话 1', !!sid1, JSON.stringify(s1.json && s1.json.message));
  for (let i = 0; i < 3; i++) await req('POST', `${API}/fetal-movements/sessions/${sid1}/kicks`);

  // 关键：**还没点「结束计数」**，当天记录就应该已经看得到 3 次
  // （用户数到一半直接关掉应用 / 切走，数据也不能丢）
  let rec = await dayRecord(DATE);
  check('未结束时已写回：胎动次数 = 3', num(rec && rec.fetal_movement_count) === 3,
    `实际 ${rec && rec.fetal_movement_count}`);

  // 第二个会话：结束它，两次会话应相加
  // ⚠️ start_time 用 '00:00:00' 而不是随便一个时刻：会话的 end_time 由服务端取**当前墙钟**
  //    （PUT 里 `new Date().toTimeString()`），若开始时间设在当前时刻之后，
  //    服务端按 `b < a` 正确地把这一段判为非法、不计时长 —— 于是「时长写回了吗」这条
  //    会变成一条**随时钟漂移**的假红。'00:00:00' 保证 end >= start 恒成立。
  const s2 = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: DATE, start_time: '00:00:00' });
  const sid2 = s2.json && s2.json.data && s2.json.data.id;
  check('建胎动会话 2', !!sid2);
  for (let i = 0; i < 2; i++) await req('POST', `${API}/fetal-movements/sessions/${sid2}/kicks`);
  await req('PUT', `${API}/fetal-movements/sessions/${sid2}`);

  rec = await dayRecord(DATE);
  check('两次会话相加：胎动次数 = 5', num(rec && rec.fetal_movement_count) === 5,
    `实际 ${rec && rec.fetal_movement_count}`);
  // 会话 2 从 00:00 到当前时刻，至少 1 分钟 ⇒ 时长列必须有值（列是 INTEGER，不足 1 分钟记 1）
  check('胎动时长列已写入（分钟，≥1）', (num(rec && rec.fetal_movement_duration) || 0) >= 1,
    `实际 ${rec && rec.fetal_movement_duration}`);

  // ========================================================================
  console.log('\n########## B. 宫缩：条数 / 持续时间(秒) / 间隔(分) —— 单位不能错 ##########');
  // ========================================================================
  const cs = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: DATE, start_time: '09:50:00' });
  const cid = cs.json && cs.json.data && cs.json.data.id;
  check('建宫缩会话', !!cid, JSON.stringify(cs.json && cs.json.message));

  // 用 manual 精确构造时长与间隔，否则「立刻点两下」算出来的间隔≈0，换算对不对根本验不出来：
  //   第 1 条 10:00:00–10:00:50 ⇒ 持续 50 秒
  //   第 2 条 10:04:00–10:04:50 ⇒ 持续 50 秒；距上一条结束 10:04:00-10:00:50 = 190 秒
  await req('POST', `${API}/contractions/sessions/${cid}/contractions`,
    { action: 'manual', start_time: '10:00:00', end_time: '10:00:50' });
  await req('POST', `${API}/contractions/sessions/${cid}/contractions`,
    { action: 'manual', start_time: '10:04:00', end_time: '10:04:50' });
  await req('PUT', `${API}/contractions/sessions/${cid}`);

  rec = await dayRecord(DATE);
  const cCount = num(rec && rec.contraction_count);
  const cDur = num(rec && rec.contraction_duration);
  const cInt = num(rec && rec.contraction_interval);

  check('宫缩条数 = 2', cCount === 2, `实际 ${cCount}`);
  // 平均持续 = (50+50)/2 = 50 **秒**。若被当成分钟写、或除以 60，这里就会露馅
  check('平均持续时间 = 50（秒，不是分钟）', cDur === 50, `实际 ${cDur}`);
  // 平均间隔 = 190 **秒** ⇒ 必须换算成分钟 190/60 = 3.1667 → 保留 1 位 = 3.2
  // （忘了换算会写 190；只取整会写 3；两者都不等于 3.2 ⇒ 这条能真正验出换算）
  check('平均间隔 = 3.2（分钟，由 190 秒换算）', cInt === 3.2, `实际 ${cInt}`);
  check('contraction_pain 不被写回覆盖（会话里没有疼痛信息）',
    !rec || rec.contraction_pain == null || rec.contraction_pain === '',
    `实际 ${rec && rec.contraction_pain}`);

  // ========================================================================
  console.log('\n########## C. 当天会话明细：同一天每一次都留痕 ##########');
  // ========================================================================
  const sd = await req('GET', `${API}/daily-records/session-detail?pregnancy_id=${pid}&date=${DATE}`);
  const detail = sd.json && sd.json.data;
  check('明细接口可用', !!(detail && Array.isArray(detail.fetal_movement) && Array.isArray(detail.contraction)),
    JSON.stringify(sd.json && sd.json.message));
  const fmList = (detail && detail.fetal_movement) || [];
  const ctList = (detail && detail.contraction) || [];
  check('胎动明细 2 条（两次会话都在，没有被合并成 1 条）', fmList.length === 2, `实际 ${fmList.length}`);
  check('宫缩明细 1 条', ctList.length === 1, `实际 ${ctList.length}`);
  const counts = fmList.map((x) => num(x.count)).sort((a, b) => a - b);
  check('明细里两次会话的次数分别是 2 和 3', counts.length === 2 && counts[0] === 2 && counts[1] === 3,
    JSON.stringify(counts));
  const ct0 = ctList[0] || {};
  check('宫缩明细带 平均持续(秒) = 50', num(ct0.avg_duration) === 50, `实际 ${ct0.avg_duration}`);
  check('宫缩明细带 平均间隔(分钟) = 3.2', num(ct0.avg_interval_minutes) === 3.2,
    `实际 ${ct0.avg_interval_minutes}`);
  check('明细按开始时间升序（早的在前）',
    fmList.length < 2 || String(fmList[0].start_time || '') <= String(fmList[1].start_time || ''),
    JSON.stringify(fmList.map((x) => x.start_time)));

  // ========================================================================
  console.log('\n########## D. 零影响：没有会话的日期 / 算不出的字段，一律不碰 ##########');
  // ========================================================================
  // D1. DATE2 只手填、无任何会话：即便别处触发了写回，这一天也不能被动
  await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: DATE2, fetal_movement_count: 99, contraction_interval: 7 });
  // 在 DATE（有会话）上再触发一次写回，确认不会串到 DATE2
  await req('POST', `${API}/fetal-movements/sessions/${sid1}/kicks`);
  const rec2 = await dayRecord(DATE2);
  check('无会话的日期不被写回（手填 99 仍是 99）', num(rec2 && rec2.fetal_movement_count) === 99,
    `实际 ${rec2 && rec2.fetal_movement_count}`);
  check('无会话的日期手填间隔不被清空（仍是 7）', num(rec2 && rec2.contraction_interval) === 7,
    `实际 ${rec2 && rec2.contraction_interval}`);

  // D2. DATE3：手填时长 45 分钟 + 一个**未结束**的会话
  //     会话没结束 ⇒ 整天算不出时长（duration_minutes = null）⇒ 必须**跳过**该字段，
  //     绝不能把用户手填的 45 抹成空
  await req('POST', API + '/daily-records', { pregnancy_id: pid, record_date: DATE3, fetal_movement_count: 40, fetal_movement_duration: 45 });
  const s3 = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: DATE3 });
  const sid3 = s3.json && s3.json.data && s3.json.data.id;
  await req('POST', `${API}/fetal-movements/sessions/${sid3}/kicks`);
  const rec3 = await dayRecord(DATE3);
  check('未结束会话：次数被更新为 1（计数即时可见）', num(rec3 && rec3.fetal_movement_count) === 1,
    `实际 ${rec3 && rec3.fetal_movement_count}`);
  check('未结束会话：手填的「用时 45 分钟」没被抹成空', num(rec3 && rec3.fetal_movement_duration) === 45,
    `实际 ${rec3 && rec3.fetal_movement_duration}`);

  // D3. DATE4：手填了数据，然后用户开了计数器/计时器**一条都没记就结束**
  //     空会话不携带任何信息 ⇒ 不能用 0 把用户手填的值清零。
  //     （这是很常见的操作：点开看看、试一下，然后关掉。）
  const DATE4 = '2026-09-27';
  await req('POST', API + '/daily-records',
    { pregnancy_id: pid, record_date: DATE4, fetal_movement_count: 20, contraction_count: 3 });
  const es = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: DATE4 });
  const esid = es.json && es.json.data && es.json.data.id;
  await req('PUT', `${API}/fetal-movements/sessions/${esid}`);           // 0 次胎动就结束
  const ecd = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: DATE4 });
  const ecid = ecd.json && ecd.json.data && ecd.json.data.id;
  await req('PUT', `${API}/contractions/sessions/${ecid}`);               // 0 条宫缩就结束
  const rec4 = await dayRecord(DATE4);
  check('空胎动会话不清零手填次数（仍是 20）', num(rec4 && rec4.fetal_movement_count) === 20,
    `实际 ${rec4 && rec4.fetal_movement_count}`);
  check('空宫缩会话不清零手填次数（仍是 3）', num(rec4 && rec4.contraction_count) === 3,
    `实际 ${rec4 && rec4.contraction_count}`);

  // ========================================================================
  console.log('\n########## F. 统计口径：每天只取「次数最高的那一次会话」##########');
  // ========================================================================
  // 用户要求：「在统计里面，只统计今天最高的一个值来做曲线」。
  // 一天可能记好几次（且每条都要保留、可以往回翻），把几次**相加**画曲线会抬高曲线、
  // 也没有临床意义 —— 胎动/宫缩看的都是单次计数。
  const DATE5 = '2026-09-26';
  // 胎动：两次会话分别是 2 次、5 次 ⇒ 代表值应取 5（不是 2，也不是合计 7）
  for (const [st, kicks] of [['00:00:00', 2], ['00:00:00', 5]]) {
    const s = await req('POST', API + '/fetal-movements/sessions', { pregnancy_id: pid, session_date: DATE5, start_time: st });
    const sid = s.json && s.json.data && s.json.data.id;
    for (let i = 0; i < kicks; i++) await req('POST', `${API}/fetal-movements/sessions/${sid}/kicks`);
    await req('PUT', `${API}/fetal-movements/sessions/${sid}`);
  }
  // 宫缩：A 只有 1 条（持续 30 秒、无间隔）；B 有 3 条（持续 40 秒、间隔 80 秒）
  //       ⇒ 代表值必须整体取自 B：条数 3、持续 40、间隔 1.3 —— 不能条数取 B 而持续取 A
  const cA = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: DATE5, start_time: '10:00:00' });
  const cAid = cA.json && cA.json.data && cA.json.data.id;
  await req('POST', `${API}/contractions/sessions/${cAid}/contractions`, { action: 'manual', start_time: '10:00:00', end_time: '10:00:30' });
  await req('PUT', `${API}/contractions/sessions/${cAid}`);
  const cB = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid, session_date: DATE5, start_time: '11:00:00' });
  const cBid = cB.json && cB.json.data && cB.json.data.id;
  for (const [s0, e0] of [['11:00:00', '11:00:40'], ['11:02:00', '11:02:40'], ['11:04:00', '11:04:40']]) {
    await req('POST', `${API}/contractions/sessions/${cBid}/contractions`, { action: 'manual', start_time: s0, end_time: e0 });
  }
  await req('PUT', `${API}/contractions/sessions/${cBid}`);

  const sdAll = await req('GET', `${API}/daily-records/session-daily?pregnancy_id=${pid}`);
  const dmap = (sdAll.json && sdAll.json.data) || {};
  check('统计接口可用（返回日期 → 代表会话的映射）', !!dmap && typeof dmap === 'object' && !Array.isArray(dmap),
    JSON.stringify(sdAll.json && sdAll.json.message));
  const d5 = dmap[DATE5] || {};
  check('胎动取次数最多的那一次（5，不是 2、也不是合计 7）',
    d5.fetal_movement && num(d5.fetal_movement.count) === 5, JSON.stringify(d5.fetal_movement));
  check('宫缩取条数最多的那一次（3，不是 1、也不是合计 4）',
    d5.contraction && num(d5.contraction.count) === 3, JSON.stringify(d5.contraction));
  check('宫缩持续取自同一次会话（40 秒，不是 A 的 30 秒）',
    d5.contraction && num(d5.contraction.duration_seconds) === 40, JSON.stringify(d5.contraction));
  check('宫缩间隔取自同一次会话（80 秒 → 1.3 分钟）',
    d5.contraction && num(d5.contraction.interval_minutes) === 1.3, JSON.stringify(d5.contraction));
  // 只手填、没有任何会话的日期不能出现在结果里（前端要沿用 daily_record 里手填的值）
  check('只手填、无会话的日期不在结果里（DATE2）', !dmap[DATE2], JSON.stringify(Object.keys(dmap)));
  // 只有空会话的日期同样不能出现 —— 否则前端会把用户手填的 20 次覆盖成 0
  check('只有空会话的日期不在结果里（DATE4）', !dmap[DATE4], JSON.stringify(Object.keys(dmap)));

  // ========================================================================
  console.log('\n########## E. 导出标签口径（静态护栏）##########');
  // ========================================================================
  // 数值是秒，导出表头以前写「宫缩持续(分)」，差 60 倍。这里做一条字面量护栏；
  // 真正的数值口径由上面 B 段的断言保证。
  const exportSrc = fs.readFileSync(path.join(NODE_DIR, 'routes', 'export.js'), 'utf-8');
  check('导出表头「宫缩持续」标注为(秒)', /contraction_duration',\s*label:\s*'宫缩持续\(秒\)'/.test(exportSrc),
    'export.js 里仍是 (分) 或已改成别的写法');
  check('导出表头不再出现「宫缩持续(分)」', !/宫缩持续\(分\)/.test(exportSrc));

  console.log('\n【逐条结果】');
  out.forEach((l) => console.log(l));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
