/**
 * 记录页「全部功能」的端到端核验（真实后端 + 真实 HTTP）
 *
 * 【为什么需要它】
 * 记录页有 25 个可录入的类别，每个类别的通路都是「前端表单 → POST 字段名 → db 列 → 读回 → 列表渲染」。
 * 这条链路上任何一个字段名写错、列名不存在、读侧没做类型归一，表现都是**静默的**：
 * 接口照样 200 + code 0，前端照样弹「已保存」，但库里是空的 / 读回来是字符串。
 * 静态检查（verify_record_entrypoints.js）只能确认「源码里有这么写」，
 * 证明不了「真的存进去了、真的读得回来、类型真的对」。所以这里逐类跑真的 HTTP。
 *
 * 【每个类别跑 8 个断言】
 *   A 建：POST 到空日期 → 提交的每个字段都真的能被读回
 *   B 类型：读回的数字列必须是 number（防老库 TEXT 列把 92 读成 "92"）
 *   C 部分更新：同一天再 POST 另一个字段 → 先前的字段不能被抹掉
 *   D 改：PUT 改一个字段 → 值真的变了，其它字段还在
 *   E 删除守卫：删不存在的 id → 必须报错（不能"假成功"）
 *   F 删：删掉真记录 → code 0 且读回为 null
 *   G 脏值：非法枚举 → 记录实际行为（当前后端不校验，此项只报告不判失败）
 *   H 坏日期：非法日期 → 记录实际行为（关注是否被静默改成今天）
 *
 * 用法：node verify_record_page_functions.js
 * 产物：tools/verify/.tmp/record-functions/report.json（逐项明细）
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env = require('./_env');
const ROOT = env.REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-record-functions');
const OUT = path.join(env.TMP, 'record-functions');
const PORT = Number(process.env.PJ_TCP_PORT || 38511);
const GW = '/app/pregnancyjournal';
const API = GW + '/api/v1';

let pass = 0, fail = 0;
const findings = [];
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`); }
  findings.push({ name, ok: !!ok, detail: detail || '' });
}
function note(msg) { console.log(`  ℹ ${msg}`); findings.push({ name: msg, ok: null, detail: 'report-only' }); }

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const serverEnv = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T, DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'), MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'), DATA_DIR: T, LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: path.join(ROOT, 'app/ui'),
};

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf-8');
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {};
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(d); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, raw: d });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 记录页 25 个可录入类别的字段矩阵：与 RecordView.vue / AddRecordDialog.vue 的提交内容一致 */
const TYPES = [
  { key: '体重', write: { weight: 64.2, note: '体重备注' }, numeric: ['weight'], str: ['note'] },
  { key: '三围', write: { waist: 85.5 }, numeric: ['waist'], str: [] },
  { key: '水肿', write: { edema_level: 'mild' }, numeric: [], str: ['edema_level'] },
  { key: '分泌物', write: { vaginal_discharge: 'more' }, numeric: [], str: ['vaginal_discharge'] },
  { key: '皮肤状况', write: { skin_condition: 'stretch_marks' }, numeric: [], str: ['skin_condition'] },
  { key: '排尿情况', write: { urination_frequency: 'frequent' }, numeric: [], str: ['urination_frequency'] },
  { key: '血压', write: { blood_pressure_systolic: '118', blood_pressure_diastolic: '76' }, numeric: [], str: ['blood_pressure_systolic'] },
  { key: '血糖', write: { blood_glucose_fasting: 4.8 }, numeric: ['blood_glucose_fasting'], str: [] },
  { key: '胎心', write: { fetal_heart_rate: 142 }, numeric: ['fetal_heart_rate'], str: [] },
  { key: '便便', write: { stool_record: JSON.stringify({ count: 2, consistency: 'normal' }) }, numeric: [], str: ['stool_record'] },
  { key: '心情', write: { mood: '4', mood_note: '今天不错' }, numeric: [], str: ['mood', 'mood_note'] },
  { key: '症状', write: { symptoms: JSON.stringify(['恶心', '乏力']) }, numeric: [], str: ['symptoms'] },
  { key: '补充剂', write: { supplement_record: JSON.stringify([{ name: '叶酸' }, { name: '钙片' }]) }, numeric: [], str: ['supplement_record'] },
  { key: '好习惯', write: { habit_text: '散步30分钟' }, numeric: [], str: ['habit_text'] },
  { key: '体温', write: { body_temperature: 36.6 }, numeric: ['body_temperature'], str: [] },
  { key: '睡眠', write: { sleep_hours: 7.5, sleep_quality: 'good' }, numeric: ['sleep_hours'], str: ['sleep_quality'] },
  { key: '饮水', write: { water_intake: 1800 }, numeric: ['water_intake'], str: [] },
  { key: '饮食', write: { diet_note: '早餐吃了鸡蛋' }, numeric: [], str: ['diet_note'] },
  { key: '运动', write: { exercise_type: '散步', exercise_duration: 30 }, numeric: ['exercise_duration'], str: ['exercise_type'] },
  { key: '胎动', write: { fetal_movement_count: 12, fetal_movement_duration: 20 }, numeric: ['fetal_movement_count', 'fetal_movement_duration'], str: [] },
  { key: '宫缩', write: { contraction_count: 1, contraction_duration: 45, contraction_interval: 8.5, contraction_pain: '轻微' }, numeric: ['contraction_duration', 'contraction_interval'], str: ['contraction_pain'] },
  { key: '计划', write: { plan_text: '明天去产检', plan_date: '2026-10-01' }, numeric: [], str: ['plan_text', 'plan_date'] },
  { key: '爱爱', write: { intimacy_record: JSON.stringify({ count: 1, has_protection: 'yes', protection_type: 'condom' }) }, numeric: [], str: ['intimacy_record'] },
  { key: 'hCG', write: { hcg_value: 50000, hcg_weeks: 6 }, numeric: ['hcg_value', 'hcg_weeks'], str: [] },
  { key: '尿酸', write: { uric_acid: 350, uric_acid_period: '空腹' }, numeric: ['uric_acid'], str: ['uric_acid_period'] },
];

const dstr = (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const spawned = new Set();
function killTree(pid) {
  if (!pid) return;
  try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}

(async () => {
  const SHIM = path.join(env.VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  spawned.add(child);
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { for (const p of spawned) killTree(p.pid); spawned.clear(); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  // ---- 起服务 ----
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', `${API}/pregnancies/active`); if (r.status === 200) { ready = true; break; } } catch (e) { /* not up */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1500)); cleanup(); process.exit(2); }

  const p1 = await req('POST', `${API}/pregnancies`, { last_period_date: dstr(-162), due_date: dstr(118) });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) { const pa = await req('GET', `${API}/pregnancies/active`); pid = pa.json && pa.json.data && pa.json.data.id; }
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p1.json)); cleanup(); process.exit(2); }

  const getByDate = async (date) => {
    const r = await req('GET', `${API}/daily-records/by-date/${date}?pregnancy_id=${encodeURIComponent(pid)}`);
    return { code: r.json && r.json.code, data: r.json && r.json.data };
  };

  console.log(`\n===== 逐类别跑「建 / 读 / 部分更新 / 改 / 删」 =====`);
  let offset = -300;                       // 每天一个类别，互不干扰
  const report = [];

  for (const t of TYPES) {
    const date = dstr(offset--);
    const errs = [];

    // A 建
    const created = await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: date, ...t.write });
    if (!(created.json && created.json.code === 0)) {
      check(`${t.key}：POST 保存成功`, false, `code=${created.json && created.json.code} msg=${created.json && created.json.message}`);
      report.push({ type: t.key, errs: ['POST 失败'] });
      continue;
    }
    let got = (await getByDate(date)).data || {};

    for (const [k, v] of Object.entries(t.write)) {
      if (String(got[k]) !== String(v)) errs.push(`字段 ${k} 未落库/读回不一致（提交 ${JSON.stringify(v)}，读回 ${JSON.stringify(got[k])}）`);
    }
    // B 数字列类型
    for (const k of t.numeric) {
      if (got[k] != null && typeof got[k] !== 'number') errs.push(`数字列 ${k} 读回是 ${typeof got[k]}（应为 number，老库 TEXT 列会读出字符串）`);
    }
    for (const k of t.str) {
      if (got[k] != null && typeof got[k] !== 'string') errs.push(`文本列 ${k} 读回是 ${typeof got[k]}`);
    }
    check(`${t.key}：建 → 读回一致且类型正确（${Object.keys(t.write).length} 个字段）`, errs.length === 0, errs.join('；'));

    // C 部分更新：同一天再写一个别的列，先前字段必须留着
    const second = await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: date, note: '第二轮备注' });
    got = (await getByDate(date)).data || {};
    const wiped = Object.keys(t.write).filter((k) => k !== 'note' && String(got[k]) !== String(t.write[k]));
    check(`${t.key}：同日再存其它字段不抹掉已有字段`, second.json && second.json.code === 0 && wiped.length === 0,
      wiped.length ? '被抹掉: ' + wiped.join(',') : `code=${second.json && second.json.code}`);
    const id = got.id;

    // D 改（PUT）
    if (id) {
      const firstKey = Object.keys(t.write).find((k) => k !== 'note');
      const newVal = t.numeric.includes(firstKey) ? Number(t.write[firstKey]) + 1 : 'changed_value';
      const put = await req('PUT', `${API}/daily-records/${id}`, { [firstKey]: newVal });
      got = (await getByDate(date)).data || {};
      const okD = put.json && put.json.code === 0 && String(got[firstKey]) === String(newVal);
      const others = Object.keys(t.write).filter((k) => k !== firstKey && k !== 'note');
      const lost = others.filter((k) => String(got[k]) !== String(t.write[k]));
      check(`${t.key}：PUT 改单字段生效且不误伤其它字段`, okD && lost.length === 0,
        [okD ? '' : `PUT 后 ${firstKey}=${JSON.stringify(got[firstKey])}（期望 ${JSON.stringify(newVal)}）`, lost.length ? '被误伤: ' + lost.join(',') : ''].filter(Boolean).join('；'));
    } else {
      check(`${t.key}：PUT 改单字段`, false, '读不到 id');
    }

    // E 删除守卫
    const delGhost = await req('DELETE', `${API}/daily-records/no-such-id-${Date.now()}`);
    check(`${t.key}：删不存在的 id 必须报错（防"假成功"）`, !!(delGhost.json && delGhost.json.code !== 0),
      `code=${delGhost.json && delGhost.json.code}`);

    // F 真删
    if (id) {
      const del = await req('DELETE', `${API}/daily-records/${id}`);
      const after = await getByDate(date);
      check(`${t.key}：删除生效（读回为 null）`, del.json && del.json.code === 0 && after.data == null,
        `del.code=${del.json && del.json.code} after=${JSON.stringify(after.data)}`);
    }
    report.push({ type: t.key, errs });
  }

  // ---- G/H 脏值与坏日期（只报告，不判失败：先看现状再决定要不要加校验）----
  console.log(`\n===== 边界行为（只报告） =====`);
  const dirtyDate = dstr(-900);
  const dirty = await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: dirtyDate, edema_level: 'banana', urination_frequency: 'zzz' });
  const dirtyGot = (await getByDate(dirtyDate)).data || {};
  if (dirty.json && dirty.json.code === 0 && dirtyGot.edema_level === 'banana') {
    note(`非法枚举被原样入库：edema_level="banana"、urination_frequency="zzz"（接口零校验；UI 走单选按钮所以用户碰不到，但列表/统计会把这个值原样显示出来）`);
  }

  const badDate = await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: 'not-a-date', weight: 61.1 });
  const todayGot = (await getByDate(dstr(0))).data || {};
  if (badDate.json && badDate.json.code === 0) {
    if (String(todayGot.weight) === '61.1') note(`非法日期 'not-a-date' 被**静默改成今天**并保存成功（weight 落到今天）——用户选错日期时不会得到任何提示`);
    else note(`非法日期 'not-a-date' 未报错，也未落到今天（weight 读回 ${JSON.stringify(todayGot.weight)}）`);
  }

  // ---- 本轮修复的写入格式 / 备注语义 / 取值域（2026-09-29）----
  // 这几条都是「前端改了写入方式」的回归闸门：前端不再写中文睡眠质量、
  // 备注改成显式字符串（可清空）、饮食与用药统一 JSON 形状、枚举取并集。
  console.log(`\n===== 本轮修复：写入格式 / 备注语义 / 取值域 =====`);

  // ① 「当天备注」可清空：曾经前端传 undefined ⇒ 后端整列跳过 ⇒ 用户删不掉备注
  const noteDay = dstr(-1200);
  await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: noteDay, weight: 63.1, note: '先写一条' });
  let nb = (await getByDate(noteDay)).data || {};
  check('当天备注：能写入（前置条件）', nb.note === '先写一条', `读回 ${JSON.stringify(nb.note)}`);
  await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: noteDay, weight: 63.1, note: '' });
  nb = (await getByDate(noteDay)).data || {};
  check('当天备注：传空串能真正清空（写 undefined 会被后端整列跳过 ⇒ 删不掉）',
    !nb.note, `读回 ${JSON.stringify(nb.note)}`);

  // ② 备注是「按天共享的一列」：别的类型保存（不带 note）不能把它抹掉
  const sharedDay = dstr(-1201);
  await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: sharedDay, weight: 60.5, note: '体重备注' });
  await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: sharedDay, edema_level: 'mild' });
  const sd = (await getByDate(sharedDay)).data || {};
  check('当天备注：是同一列，写别的类型不会抹掉它（水肿+体重备注共存）',
    sd.note === '体重备注' && sd.edema_level === 'mild',
    `note=${JSON.stringify(sd.note)} edema_level=${JSON.stringify(sd.edema_level)}`);

  // ③ 饮食备注统一 JSON 数组格式（与「添加记录」大弹窗一致）
  const dietDay = dstr(-1202);
  await req('POST', `${API}/daily-records`, {
    pregnancy_id: pid, record_date: dietDay,
    diet_note: JSON.stringify([{ type: '早餐', content: '鸡蛋牛奶' }]),
  });
  const dd = (await getByDate(dietDay)).data || {};
  let dietParsed = null; try { dietParsed = JSON.parse(dd.diet_note); } catch (e) { /* 非 JSON */ }
  check('饮食备注：以 [{type,content}] JSON 存储（不再是纯文本）',
    Array.isArray(dietParsed) && dietParsed[0] && dietParsed[0].type === '早餐' && dietParsed[0].content === '鸡蛋牛奶',
    `读回 ${JSON.stringify(dd.diet_note)}`);

  // ④ 用药：medication 存 [{name,dosage,frequency}]，且与 note 并存
  const medDay = dstr(-1203);
  await req('POST', `${API}/daily-records`, {
    pregnancy_id: pid, record_date: medDay,
    medication: JSON.stringify([{ name: '叶酸片', dosage: '400μg', frequency: '一日一次' }]),
    note: '医生开的',
  });
  const md = (await getByDate(medDay)).data || {};
  let medParsed = null; try { medParsed = JSON.parse(md.medication); } catch (e) { /* 非 JSON */ }
  check('用药：medication 以 [{name,dosage,frequency}] 存储（记录列表按此形状解析）',
    Array.isArray(medParsed) && medParsed[0] && medParsed[0].name === '叶酸片' && medParsed[0].dosage === '400μg' && medParsed[0].frequency === '一日一次',
    `读回 ${JSON.stringify(md.medication)}`);
  check('用药：与当天备注可并存', md.note === '医生开的', `note=${JSON.stringify(md.note)}`);

  // ⑤ 睡眠质量：新写英文、老中文值原样保留（读侧由前端 normalizeSleepQuality 归一）
  const sqDayNew = dstr(-1204), sqDayOld = dstr(-1205);
  await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: sqDayNew, sleep_hours: 7.5, sleep_quality: 'good' });
  const sqNew = (await getByDate(sqDayNew)).data || {};
  check('睡眠质量：新写入英文值 good 原样存取', sqNew.sleep_quality === 'good', `读回 ${JSON.stringify(sqNew.sleep_quality)}`);
  await req('POST', `${API}/daily-records`, { pregnancy_id: pid, record_date: sqDayOld, sleep_hours: 6, sleep_quality: '好' });
  const sqOld = (await getByDate(sqDayOld)).data || {};
  check('睡眠质量：历史中文值「好」原样保留（老数据不丢；展示侧由前端归一）',
    sqOld.sleep_quality === '好', `读回 ${JSON.stringify(sqOld.sleep_quality)}`);

  // ⑥ 新并入的枚举值确实可用（宫缩疼痛「无感」、尿酸时段「随机」）
  const enumDay = dstr(-1206);
  await req('POST', `${API}/daily-records`, {
    pregnancy_id: pid, record_date: enumDay,
    contraction_count: 1, contraction_pain: '无感',
    uric_acid: 340, uric_acid_period: '随机',
  });
  const ed = (await getByDate(enumDay)).data || {};
  check('宫缩疼痛：新值「无感」可存取（此前只在大弹窗里没有，两处取值域不一致）',
    ed.contraction_pain === '无感', `读回 ${JSON.stringify(ed.contraction_pain)}`);
  check('尿酸时段：新值「随机」可存取（小弹窗有、大弹窗没有）',
    ed.uric_acid_period === '随机', `读回 ${JSON.stringify(ed.uric_acid_period)}`);

  // ⑦ 爱爱：备注统一走 note（不再往备注框里回填 JSON 原文）
  const intimDay = dstr(-1207);
  await req('POST', `${API}/daily-records`, {
    pregnancy_id: pid, record_date: intimDay,
    intimacy_record: JSON.stringify({ count: 1, has_protection: 'yes', protection_type: 'condom' }),
    note: '备注文本',
  });
  const idm = (await getByDate(intimDay)).data || {};
  let intimParsed = null; try { intimParsed = JSON.parse(idm.intimacy_record); } catch (e) { /* */ }
  check('爱爱：结构化数据留在 intimacy_record，备注单独存 note（互不污染）',
    !!(intimParsed && intimParsed.count === 1) && idm.note === '备注文本',
    `intimacy_record=${JSON.stringify(idm.intimacy_record)} note=${JSON.stringify(idm.note)}`);

  // ---- 列表接口：分页 + 日期区间 ----
  console.log(`\n===== 列表接口（记录页「查看全部」依赖它） =====`);
  const list = await req('GET', `${API}/daily-records?pregnancy_id=${encodeURIComponent(pid)}&page=1&page_size=5`);
  const items = list.json && list.json.data && list.json.data.items;
  check('列表：分页 page_size=5 生效', Array.isArray(items) && items.length <= 5, `返回 ${items && items.length} 条`);
  check('列表：返回 total 且 > 0', !!(list.json && list.json.data && list.json.data.total > 0), `total=${list.json && list.json.data && list.json.data.total}`);
  const badRange = await req('GET', `${API}/daily-records?pregnancy_id=${encodeURIComponent(pid)}&start_date=2026/01/01`);
  check('列表：非法 start_date 被拒（不静默忽略）', !!(badRange.json && badRange.json.code !== 0), `code=${badRange.json && badRange.json.code}`);

  // ---- 静态契约（比动态更有牙：动态跑的是新建库，测不出"老库补列成 TEXT"那类问题）----
  console.log(`\n===== 静态契约：schema ↔ 三张硬编码名单 =====`);
  const dbSrc = fs.readFileSync(path.join(NODE_DIR, 'db.js'), 'utf-8');
  const routeSrc = fs.readFileSync(path.join(NODE_DIR, 'routes/daily-record.js'), 'utf-8');
  const mDdl = dbSrc.match(/CREATE TABLE IF NOT EXISTS daily_record \(([\s\S]*?)\n\);/);
  // ⚠️ 列名里**有数字**（blood_glucose_1h / _2h）：`[a-z_]+` 会在 '1' 处停下 ⇒ 少解析两列，
  //    而下面几条断言都是"遍历解析出来的列去比对"，少解析 = 少检查 = **假绿**。
  //    第一次就踩了这个坑（实得 48 列），靠「断言解析数量 == 50」这一条才暴露出来。
  const quoted = (m) => (m ? (m[1].match(/'([a-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, '')) : []);
  const mNumeric = routeSrc.match(/const NUMERIC_FIELDS = \[([\s\S]*?)\];/);
  const mInsert = routeSrc.match(/const INSERT_COLUMNS = \[([\s\S]*?)\];/);
  const mFields = routeSrc.match(/const fields = \[([\s\S]*?)\];/);
  check('能解析出 daily_record 的建表语句', !!mDdl);
  check('能解析出 NUMERIC_FIELDS / INSERT_COLUMNS / fields 三张名单', !!mNumeric && !!mInsert && !!mFields);

  const cols = [];
  if (mDdl) {
    for (const line of mDdl[1].split(/\r?\n/)) {
      const m = line.match(/^\s*([a-z0-9_]+)\s+(REAL|INTEGER|TEXT)\b/i);
      if (m) cols.push({ name: m[1], type: m[2].toUpperCase() });
    }
  }
  check(`解析出 ${cols.length} 个列（期望 50）`, cols.length === 50, `实得 ${cols.length}`);
  const numeric = quoted(mNumeric), insertCols = quoted(mInsert), updateCols = quoted(mFields);

  // ① 数值列必须都登记进 NUMERIC_FIELDS
  //    漏一个的后果：升级过的老库里那列是 TEXT，读出来是 "92" 字符串，折线图和 n-input-number 都会错。
  const numericCols = cols.filter((c) => c.type !== 'TEXT').map((c) => c.name);
  const missingNumeric = numericCols.filter((c) => !numeric.includes(c));
  check(`${numericCols.length} 个数值列全部登记进 NUMERIC_FIELDS（防老库读回字符串）`,
    missingNumeric.length === 0, '漏登记: ' + missingNumeric.join(','));
  const staleNumeric = numeric.filter((c) => !cols.some((x) => x.name === c));
  check('NUMERIC_FIELDS 没有 schema 里不存在的列（名单没漂移）', staleNumeric.length === 0, '多余: ' + staleNumeric.join(','));

  // ② 每个用户列都必须能被 INSERT 写入（漏一个 ⇒ 该字段永远存不进去，接口仍回 200）
  const meta = ['id', 'pregnancy_id', 'record_date', 'created_at', 'updated_at'];
  const userCols = cols.map((c) => c.name).filter((c) => !meta.includes(c));
  const missingInsert = userCols.filter((c) => !insertCols.includes(c));
  check(`${userCols.length} 个用户列全部在 INSERT_COLUMNS 里（漏登记 ⇒ 字段永远存不进去）`,
    missingInsert.length === 0, '漏登记: ' + missingInsert.join(','));

  // ③ 每个用户列也必须能被更新（漏一个 ⇒ 编辑时改不动，且不报错）
  const missingUpdate = userCols.filter((c) => !updateCols.includes(c));
  check(`${userCols.length} 个用户列全部在更新白名单里（漏登记 ⇒ 编辑改不动且不报错）`,
    missingUpdate.length === 0, '漏登记: ' + missingUpdate.join(','));

  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ pass, fail, findings }, null, 2), 'utf-8');
  console.log('明细: ' + path.join(OUT, 'report.json'));
  if (fail) { cleanup(); process.exit(1); }
  cleanup();
  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
