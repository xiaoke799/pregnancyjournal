/**
 * 宫缩「手动补记」的时间格式与时长核验（纯函数单测 + 真后端 e2e + 静态断言 + 反例自检）
 *
 * 【为什么需要它】
 * `contraction` 表的 `start_time`/`end_time` 混着两种写法：
 *   · 自动计时 ⇒ 'HH:MM:SS'（本地，服务端 `toTimeString().slice(0,8)`）
 *   · 手动补记 ⇒ **UTC ISO**（前端 `dayjs(...).toISOString()` 原样落库）
 * 所有下游都按 'HH:MM:SS' 解析 ⇒ 手动补记一条，就把**整个会话**的时长算成 NaN（落库变 NULL），
 * 连带当天记录的「宫缩持续时长」整体丢失；明细排序、5-1-1 分析也一起错。
 *
 * 这类缺陷**构建 / 类型检查 / 现有 e2e 全都发现不了**（后端只是老实收下前端传来的值），
 * 只能靠本套件钉住。四个层次：
 *   A 纯函数：`services/hms-time.js` 的 toHmsLocal / hmsDiffSeconds（秒级、不起后端）
 *   B 真后端：手动补记 → 时长 / 落库格式 / 会话平均 / 明细顺序
 *   C 反例自检：内联「修复前的旧算法」，必须对 ISO 输入得出 NaN，证明断言有区分度（铁律 #11）
 *   D 静态断言：三处读侧都走了归一入口 + 前端两处不再按 ISO 假设写
 *
 * 用法：node tools/verify/probe_contraction_manual_time.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const env = require('./_env');
const REPO = env.REPO;
const NODE_DIR = env.SERVER_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38611);
const T = path.join(env.TMP, 'contraction-manual-time');
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
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* 非 JSON */ } resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { if (!pid) return; try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ } }

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

/** 把 JS/TS/Vue 里的注释剥掉再断言 —— 注释里出现目标标识符会造成「假绿」 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function readSrc(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }

(async () => {
  // ======================================================================
  console.log('\n########## A. 纯函数：services/hms-time.js ##########');
  // ======================================================================
  const hmsPath = path.join(NODE_DIR, 'services', 'hms-time.js');
  if (!fs.existsSync(hmsPath)) {
    console.log('  ✘ 缺少 services/hms-time.js（归一模块尚未落地）');
    process.exit(1);
  }
  const { toHmsLocal, hmsDiffSeconds } = require(hmsPath);

  check("toHmsLocal('14:30:00') 原样返回", toHmsLocal('14:30:00') === '14:30:00');
  check("toHmsLocal('9:05') 补零到 '09:05:00'", toHmsLocal('9:05') === '09:05:00', `实际 ${JSON.stringify(toHmsLocal('9:05'))}`);
  check("toHmsLocal('14:30') 补秒到 '14:30:00'", toHmsLocal('14:30') === '14:30:00', `实际 ${JSON.stringify(toHmsLocal('14:30'))}`);

  // ISO → 本地墙钟（期望值用 Date 现算，不写死时区）
  const ISO_A = '2026-10-01T06:30:00.000Z';
  const ISO_B = '2026-10-01T06:35:00.000Z';
  const ISO_C = '2026-10-01T06:40:00.000Z';
  const ISO_D = '2026-10-01T06:42:00.000Z';
  const expectA = new Date(ISO_A).toTimeString().slice(0, 8);
  check('toHmsLocal 把 ISO 转成本地 HH:MM:SS', toHmsLocal(ISO_A) === expectA, `实际 ${JSON.stringify(toHmsLocal(ISO_A))} 期望 ${expectA}`);

  check('toHmsLocal(null) = null', toHmsLocal(null) === null);
  check("toHmsLocal('') = null", toHmsLocal('') === null);
  check("toHmsLocal('abc') = null（不编造）", toHmsLocal('abc') === null);
  check("toHmsLocal('25:99:99') 不崩溃", (() => { const r = toHmsLocal('25:99:99'); return r === null || /^\d{2}:\d{2}:\d{2}$/.test(r); })());

  check('hmsDiffSeconds 同格式差 300 秒', hmsDiffSeconds('14:30:00', '14:35:00') === 300);
  check('hmsDiffSeconds 对 ISO 输入也得 300 秒（读时归一）', hmsDiffSeconds(ISO_A, ISO_B) === 300, `实际 ${hmsDiffSeconds(ISO_A, ISO_B)}`);
  check('hmsDiffSeconds 跨午夜 +24h', hmsDiffSeconds('23:50:00', '00:10:00') === 1200, `实际 ${hmsDiffSeconds('23:50:00', '00:10:00')}`);
  check('hmsDiffSeconds 无法识别 = null', hmsDiffSeconds('bad', '14:00:00') === null);

  // ======================================================================
  console.log('\n########## C. 反例自检：修复前的旧算法必须得出错误结果 ##########');
  // ======================================================================
  // 内联「修复前」的写法：`new Date('2000-01-01 ' + 传入值)` —— 传入 ISO 时是 Invalid Date
  const oldDuration = (s, e) => Math.round((new Date(`2000-01-01 ${e}`) - new Date(`2000-01-01 ${s}`)) / 1000);
  const oldVal = oldDuration(ISO_A, ISO_B);
  check('[反例] 旧算法对 ISO 输入得 NaN（说明断言有区分度）', !Number.isFinite(oldVal), `旧算法得 ${oldVal}`);
  const oldVal2 = oldDuration('14:30:00', '14:35:00');
  check('[反例] 旧算法对 HH:MM:SS 输入反而正确（说明它只差格式归一）', oldVal2 === 300, `旧算法得 ${oldVal2}`);

  // ======================================================================
  console.log('\n########## B. 真后端：手动补记的时长 / 落库格式 / 汇总 ##########');
  // ======================================================================
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
  if (!ready) {
    console.log('  ✘ 服务未就绪:\n' + srvLog.slice(-1200));
    cleanup(); process.exit(2);
  }

  const API = '/app/pregnancyjournal/api/v1';
  const p = await req('POST', API + '/pregnancies', { last_period_date: '2026-01-01' });
  const pid = p.json && p.json.data && p.json.data.id;
  check('建孕期', !!pid, JSON.stringify(p.json && p.json.message));
  if (!pid) { cleanup(); process.exit(2); }

  const s = await req('POST', API + '/contractions/sessions', { pregnancy_id: pid });
  const sid = s.json && s.json.data && s.json.data.id;
  check('建宫缩会话', !!sid);
  if (!sid) { cleanup(); process.exit(2); }

  // 手动补记 1：本地 14:30 → 14:35 = 300 秒（前端真实形态：UTC ISO）
  const m1 = await req('POST', `${API}/contractions/sessions/${sid}/contractions`, {
    action: 'manual', start_time: ISO_A, end_time: ISO_B,
  });
  const d1 = m1.json && m1.json.data;
  check('手动补记 1 返回 code 0', !!(m1.json && m1.json.code === 0), JSON.stringify(m1.json && m1.json.message));
  check('手动补记 1 duration = 300 秒（修复前是 null）', d1 && Number(d1.duration) === 300, `实际 ${d1 && JSON.stringify(d1.duration)}`);
  check('手动补记 1 落库为本地 HH:MM:SS（修复前是 ISO）',
    d1 && /^\d{2}:\d{2}:\d{2}$/.test(String(d1.start_time)) && /^\d{2}:\d{2}:\d{2}$/.test(String(d1.end_time)),
    `实际 start_time=${d1 && d1.start_time}`);

  // 手动补记 2：120 秒
  const m2 = await req('POST', `${API}/contractions/sessions/${sid}/contractions`, {
    action: 'manual', start_time: ISO_C, end_time: ISO_D,
  });
  const d2 = m2.json && m2.json.data;
  check('手动补记 2 duration = 120 秒', d2 && Number(d2.duration) === 120, `实际 ${d2 && JSON.stringify(d2.duration)}`);
  check('手动补记 2 的间隔 = 300 秒（距上一条结束 14:35→14:40）',
    d2 && Number(d2.interval_from_prev) === 300, `实际 ${d2 && JSON.stringify(d2.interval_from_prev)}`);

  // 会话汇总：avg_duration = round((300+120)/2) = 210；avg_interval = 300（只有第 2 条有间隔）
  const sess = await req('GET', `${API}/contractions/sessions/${sid}`);
  const sd = sess.json && sess.json.data;
  check('会话 total_count = 2', sd && Number(sd.total_count) === 2, `实际 ${sd && sd.total_count}`);
  check('会话 avg_duration = 210 秒（修复前被 NaN 污染成 null）', sd && Number(sd.avg_duration) === 210, `实际 ${sd && JSON.stringify(sd.avg_duration)}`);
  check('会话 avg_interval = 300 秒', sd && Number(sd.avg_interval) === 300, `实际 ${sd && JSON.stringify(sd.avg_interval)}`);

  // 明细顺序：两条按时间升序（修复前 ISO 与 HH:MM:SS 混排会乱序）
  const list = await req('GET', `${API}/contractions/sessions/${sid}/contractions`);
  const rows = (list.json && list.json.data) || [];
  check('明细返回 2 条', rows.length === 2, `实际 ${rows.length}`);
  const hmsOf = rows.map((c) => toHmsLocal(c.start_time));
  check('明细 start_time 均为本地 HH:MM:SS', hmsOf.every((t) => t && /^\d{2}:\d{2}:\d{2}$/.test(t)), JSON.stringify(hmsOf));
  check('明细按时间升序返回', hmsOf.length === 2 && String(hmsOf[0]) <= String(hmsOf[1]), JSON.stringify(hmsOf));
  check('明细第 1 条是 300 秒那条', rows.length === 2 && Number(rows[0].duration) === 300, `实际 ${rows[0] && rows[0].duration}`);

  // 汇总写回当天记录：contraction_duration 应等于加权平均（会话只有一条 ⇒ 210）
  // ⚠️ 日期必须用**本地**今天：会话的 session_date 由后端按本地日期生成，
  //    而 `toISOString()` 是 UTC，东八区凌晨会取到昨天、查不到任何记录。
  const _d = new Date();
  const todayLocal = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
  const rec = await req('GET', `${API}/daily-records/by-date/${todayLocal}?pregnancy_id=${pid}`);
  const rd = rec.json && rec.json.data;
  check('当天记录宫缩持续 = 210 秒（修复前整体丢失）', rd && Number(rd.contraction_duration) === 210, `实际 ${rd && JSON.stringify(rd.contraction_duration)}`);
  check('当天记录宫缩次数 = 2', rd && Number(rd.contraction_count) === 2, `实际 ${rd && JSON.stringify(rd.contraction_count)}`);

  // ======================================================================
  console.log('\n########## D. 静态断言：读侧都走归一入口，前端不再按 ISO 假设写 ##########');
  // ======================================================================
  const ctSrc = stripComments(readSrc('app/server/node/routes/contraction.js'));
  check('contraction.js 引入 hms-time 归一模块', /require\(\s*['"][^'"]*hms-time['"]\s*\)/.test(ctSrc));
  check('refreshSessionAggregate 用归一入口算每条时长（不再裸拼 2000-01-01）',
    /hmsDiffSeconds\(\s*c\.start_time\s*,\s*c\.end_time\s*\)/.test(ctSrc));
  check('manual 分支用 hmsDiffSeconds 算时长', /hmsDiffSeconds\(/.test(ctSrc));
  check('manual 分支不再把原始入参直接拼到 2000-01-01 上',
    !/2000-01-01 \$\{/.test(ctSrc));
  check('analysis 的 tsOf 用归一入口', /toHmsLocal\(\s*c\.start_time\s*\)/.test(ctSrc));
  check('明细 GET 排序用归一入口（兼容历史 ISO 行）',
    /toHmsLocal\([\s\S]{0,200}localeCompare/.test(ctSrc));
  check('POST 路由对落库值统一归一（start/end/manual 均可）',
    (ctSrc.match(/toHmsLocal\(/g) || []).length >= 4, `实际 ${(ctSrc.match(/toHmsLocal\(/g) || []).length} 处`);

  const viewSrc = stripComments(readSrc('frontend/src/views/ContractionTimerView.vue'));
  check('ContractionTimerView.formatTime 有 HH:MM:SS 分支（防 dayjs 解析出 Invalid Date）',
    /formatTime[\s\S]{0,600}\^\\d\{1,2\}:/m.test(viewSrc));

  // ---- 函数级：抽出 .vue 里的**真实** formatTime 源码执行（不是重写一遍）----
  const dayjsPath = path.join(REPO, 'frontend', 'node_modules', 'dayjs');
  const hasDayjs = fs.existsSync(dayjsPath);
  check('前端依赖 dayjs 可用（缺了不算通过，fail-closed）', hasDayjs);
  if (hasDayjs) {
    const dayjs = require(dayjsPath);
    const { buildFunctions } = require('./_vue_extract');
    const fb = buildFunctions(
      path.join(REPO, 'frontend/src/views/ContractionTimerView.vue'),
      ['formatTime'], { dayjs }
    );
    check('抽取真实 formatTime 成功', fb.ok, fb.ok ? '' : JSON.stringify(fb.missing || (fb.error && fb.error.message)));
    if (fb.ok) {
      const { formatTime } = fb.api;
      check('formatTime(\'14:30:00\') 原样显示（恢复会话后的主要场景）', formatTime('14:30:00') === '14:30:00', `实际 ${formatTime('14:30:00')}`);
      check('formatTime(HH:MM:SS) 不再是 Invalid Date', !/Invalid Date/.test(formatTime('14:30:00')));
      check('formatTime(ISO) 仍能格式化', /^\d{2}:\d{2}:\d{2}$/.test(formatTime(ISO_A)), `实际 ${formatTime(ISO_A)}`);
      check('formatTime(空) = \'--\'', formatTime(undefined) === '--');
    }
    // 反例：旧实现（无脑 dayjs）对 'HH:MM:SS' 必须得出 Invalid Date，证明上面的断言有区分度
    const oldFormatTime = (t) => (t ? dayjs(t).format('HH:mm:ss') : '--');
    check('[反例] 旧 formatTime 对 HH:MM:SS 得 Invalid Date', /Invalid Date/.test(oldFormatTime('14:30:00')));
  }

  const compSrc = stripComments(readSrc('frontend/src/composables/useContractionTimer.ts'));
  check('useContractionTimer.endContraction 使用后端返回值（不再自己 new Date(lastEnd) 算间隔）',
    /endContraction[\s\S]{0,900}res\.data[\s\S]{0,400}start_time/.test(compSrc));
  check('endContraction 不再裸算 new Date(lastEnd) 作为间隔',
    !/new Date\(\s*lastEnd\s*\)/.test(compSrc));

  // ======================================================================
  console.log('\n' + out.join('\n'));
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  cleanup();
  process.exit(fail ? 1 : 0);
})();
