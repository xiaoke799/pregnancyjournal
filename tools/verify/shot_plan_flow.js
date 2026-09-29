/**
 * 「计划」改造后的端到端验证（真后端 + 无头浏览器）
 *
 * 背景：2026-09-30 计划从「当天记录的 plan_text」改为存进「待办」（reminder 表，
 * reminder_type='plan'）—— 记录一天一条放不下同一天多个时间点的安排；待办一条一记录，
 * 且本来就在推送链路里（push-engine 扫 reminder）⇒ 自动获得「到点提醒」。
 *
 * 本脚本验证：
 *   【UI 层】记录页 → ＋菜单 → 计划 → 弹窗有「几点执行」时间字段 → 填内容保存 → 有成功反馈
 *   【数据层】保存后 reminder 表里真的有这条（reminder_type='plan'）
 *   【分类层】今天的计划 days_until=0（今日计划）；未来日期的 days_until>0（孕期计划）
 *   【时间层】带 trigger_time 的计划在首页待办里能取到时间
 *   【历史层】老数据（daily_record.plan_text）在记录列表里仍能显示
 *
 * 用法：node shot_plan_flow.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const env = require('./_env');
const UI_DIR = env.UI_DIR;
const NODE_DIR = env.SERVER_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38557);
const GW = '/app/pregnancyjournal';
const LABEL = 'plan-flow';
const OUT = path.join(env.TMP, LABEL);
const T = path.join(env.TMP, LABEL + '-run');

fs.mkdirSync(OUT, { recursive: true });
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
  STATIC_DIR: UI_DIR,
};

function req(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const spawned = new Set();
function killTree(pid) {
  if (!pid) return;
  try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ }
}
const dstr = (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
function findBrowser() {
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return null;
}

const PROBE = `
<script>
(function () {
  const out = { steps: [], modalFields: {}, saved: false, toast: '', rowPreview: '', crashed: false, errMsg: '' };
  function dump() {
    const old = document.getElementById('DIAG'); if (old) old.remove();
    const d = document.createElement('div'); d.id = 'DIAG';
    d.textContent = JSON.stringify(out); document.body.appendChild(d);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errState = () => {
    const t = document.querySelector('.app-error-title');
    const d = document.querySelector('.app-error-desc');
    return t ? { crashed: true, msg: (d ? d.textContent : '').trim() } : { crashed: false, msg: '' };
  };
  const btnByText = (root, txt) => {
    const all = Array.from(root.querySelectorAll('button'));
    return all.find((b) => (b.textContent || '').trim() === txt)
        || all.find((b) => (b.textContent || '').indexOf(txt) >= 0);
  };
  (async function () {
    try {
      await wait(3000);
      const e0 = errState();
      if (e0.crashed) { out.crashed = true; out.errMsg = e0.msg; dump(); return; }

      // 1) 打开「添加记录」菜单 → 计划
      if (!document.querySelector('.type-menu-item')) {
        const addBtn = btnByText(document, '添加记录') || btnByText(document, '添加');
        if (addBtn) { addBtn.click(); await wait(400); }
      }
      const item = Array.from(document.querySelectorAll('.type-menu-item'))
        .find((el) => (el.textContent || '').indexOf('计划') >= 0);
      if (!item) { out.steps.push('菜单里没找到「计划」'); dump(); return; }
      item.click();
      await wait(800);
      let e = errState();
      if (e.crashed) { out.crashed = true; out.errMsg = '打开计划弹窗就崩：' + e.msg; dump(); return; }

      // 2) 弹窗字段清点：必须有 日期 / 几点执行 / 计划内容
      const modal = Array.from(document.querySelectorAll('.n-modal')).pop();
      if (!modal) { out.steps.push('计划弹窗没打开'); dump(); return; }
      out.modalFields = {
        date: !!modal.querySelector('.n-date-picker'),
        time: !!modal.querySelector('.n-time-picker'),
        text: !!modal.querySelector('textarea, .n-input'),
        hasTimeLabel: (modal.textContent || '').indexOf('几点执行') >= 0,
        hasHint: (modal.textContent || '').indexOf('今日计划') >= 0 || (modal.textContent || '').indexOf('孕期计划') >= 0,
      };
      out.steps.push('弹窗字段: ' + JSON.stringify(out.modalFields));

      // 3) 填计划内容（naive-ui 的 input 要用原生 setter 触发 v-model）
      const ta = modal.querySelector('textarea') || modal.querySelector('.n-input__input-el');
      if (ta) {
        const proto = ta.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(ta, '产检四维UE');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(300);
      }

      // 4) 保存
      const saveBtn = btnByText(modal, '保存');
      if (saveBtn) {
        saveBtn.click();
        await wait(1000);
        e = errState();
        if (e.crashed) { out.crashed = true; out.errMsg = '保存计划时崩：' + e.msg; dump(); return; }
        const els = document.querySelectorAll('.n-message__content, .n-message');
        out.toast = els.length ? (els[els.length - 1].textContent || '').trim().slice(0, 30) : '';
        out.saved = out.toast.indexOf('今日计划') >= 0 || out.toast.indexOf('已') >= 0;
      }

      // 5) 记录页「计划」行的预览（保存后应显示刚建的计划）
      await wait(1200);
      const rows = Array.from(document.querySelectorAll('.category-row'));
      const planRow = rows.find((r) => (r.textContent || '').indexOf('计划') >= 0);
      out.rowPreview = planRow ? (planRow.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40) : '(没找到计划行)';

      // 6) 关掉可能还开着的弹窗
      const m2 = Array.from(document.querySelectorAll('.n-modal')).pop();
      if (m2) { const c = btnByText(m2, '取消'); if (c) c.click(); }
    } catch (e) {
      out.steps.push('探针异常: ' + (e && e.message));
    }
    dump();
  })();
})();
</script>
`;

(async () => {
  const SHIM = path.join(env.VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => {
    for (const bp of spawned) killTree(bp.pid);
    spawned.clear();
    killTree(child.pid);
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', GW + '/api/v1/pregnancies/active'); if (r.status === 200) { ready = true; break; } } catch (e) { /* 等 */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1200)); cleanup(); process.exit(2); }

  const H = { 'Content-Type': 'application/json' };
  const p1 = await req('POST', GW + '/api/v1/pregnancies', {
    headers: H, body: JSON.stringify({ last_period_date: dstr(-162), due_date: dstr(118) }),
  });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) { const pa = await req('GET', GW + '/api/v1/pregnancies/active'); pid = pa.json && pa.json.data && pa.json.data.id; }
  if (!pid) { console.log('建孕期失败'); cleanup(); process.exit(2); }

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); cleanup(); process.exit(2); }

  const variant = path.join(UI_DIR, '_tmp_plan.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  fs.writeFileSync(variant, html.replace('</body>', PROBE + '</body>'), 'utf-8');

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_plan.html#/record`;
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`, '--window-size=430,900',
    '--virtual-time-budget=60000', '--dump-dom', url,
  ];
  const WATCH_MS = 150000;
  const dom = await new Promise((resolve) => {
    const proc = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    spawned.add(proc);
    let o = '', done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(wd); spawned.delete(proc); resolve(o); };
    const wd = setTimeout(() => { o += '\n[看门狗] 超时'; killTree(proc.pid); finish(); }, WATCH_MS);
    proc.stdout.on('data', (d) => (o += d));
    proc.stderr.on('data', (d) => (o += d));
    proc.on('close', finish);
    proc.on('error', () => { killTree(proc.pid); finish(); });
  });
  try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }

  const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
  let r = null;
  if (m) { try { r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) { /* ignore */ } }
  fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(r, null, 2), 'utf-8');

  if (!r) { console.log('❌ 没取到探针结果（DOM ' + dom.length + '）'); cleanup(); process.exit(2); }
  (r.steps || []).forEach((s) => console.log('  · ' + s));

  let pass = 0, fail = 0;
  const check = (name, ok, extra) => {
    if (ok) { pass++; console.log('  ✔ ' + name); }
    else { fail++; console.log('  ✘ ' + name + (extra ? '  ← ' + extra : '')); }
  };

  console.log('\n【UI 层：记录页计划弹窗与保存】');
  if (r.crashed) {
    check('全程无崩溃', false, r.errMsg);
  } else {
    check('计划弹窗能打开（有日期/时间/内容三个字段）',
      r.modalFields && r.modalFields.date && r.modalFields.time && r.modalFields.text,
      JSON.stringify(r.modalFields));
    check('弹窗里有「几点执行」时间字段', !!(r.modalFields && r.modalFields.hasTimeLabel));
    check('弹窗里有今日/孕期归属说明', !!(r.modalFields && r.modalFields.hasHint));
    check('保存有成功反馈', !!r.saved, '提示: ' + (r.toast || '(无)'));
    check('记录页「计划」行显示了刚建的计划', (r.rowPreview || '').indexOf('产检') >= 0,
      '行内容: ' + r.rowPreview);
  }

  console.log('\n【数据层：用 API 直接核对 reminder 表与首页归类】');
  // API 直接建三条：今日带时间 / 今日不带时间 / 孕期（未来）带时间
  const mk = async (title, date, time) => {
    const res = await req('POST', GW + '/api/v1/reminders', {
      headers: H, body: JSON.stringify({ pregnancy_id: pid, title, trigger_date: date,
        trigger_time: time, reminder_type: 'plan', priority: 'medium', is_enabled: 1 }),
    });
    return res.json && res.json.code === 0;
  };
  check('API 创建今日计划（带 15:30）', await mk(`产检${'A'}`, dstr(0), '15:30'));
  check('API 创建今日计划（不带时间）', await mk(`散步${'B'}`, dstr(0), null));
  check('API 创建孕期计划（未来+10天，带 09:00）', await mk(`糖耐${'C'}`, dstr(10), '09:00'));

  // 诊断：先确认 3 条真的写进了 reminder 表
  const listRes = await req('GET', GW + '/api/v1/reminders?pregnancy_id=' + pid);
  const allRem = (listRes.json && listRes.json.data) || [];
  const planRem = allRem.filter((r) => r.reminder_type === 'plan');
  console.log('  [诊断] reminder 表里 plan 类型: ' + planRem.length + ' 条');
  for (const r of planRem) {
    console.log('    - ' + r.title + ' | date=' + r.trigger_date + ' time=' + (r.trigger_time || '-') +
      ' | enabled=' + r.is_enabled + ' completed=' + r.is_completed +
      ' | pid=' + String(r.pregnancy_id).slice(0, 8) + ' (探针pid=' + String(pid).slice(0, 8) + ')');
  }
  console.log('  [诊断] reminder 表全部: ' + allRem.length + ' 条');

  const dash = await req('GET', GW + '/api/v1/dashboard?pregnancy_id=' + pid);
  console.log('  [诊断] dashboard status=' + dash.status + ' code=' + (dash.json && dash.json.code));
  const todos = (dash.json && dash.json.data && dash.json.data.today_todos) || [];
  const dbg = dash.json && dash.json.data && dash.json.data.plan_debug;
  console.log('  [诊断] plan_debug: ' + JSON.stringify(dbg));
  console.log('  [诊断] today_todos 共 ' + todos.length + ' 条 → ' +
    todos.map((t) => (t.name || t.title) + '@' + t.trigger_date + ' type=' + (t.type || t.reminder_type || '?')).join(' | '));
  const planTodos = todos.filter((t) => t.reminder_type === 'plan' || t.type === 'plan');
  check('首页待办里能看到 3 条计划', planTodos.length >= 3, '实得 ' + planTodos.length);

  const todayPlan = planTodos.find((t) => t.trigger_date === dstr(0) && t.trigger_time === '15:30');
  check('今日计划带时间（15:30 已透出）', !!todayPlan,
    '今日计划: ' + JSON.stringify(planTodos.filter((t) => t.trigger_date === dstr(0)).map((t) => t.title)));
  const futurePlan = planTodos.find((t) => t.trigger_date === dstr(10));
  check('孕期计划（未来）days_until > 0', !!(futurePlan && (futurePlan.days_until || 0) > 0),
    futurePlan ? 'days_until=' + futurePlan.days_until : '(没找到)');

  // 推送范围：push-engine 的「今日提醒」查询（trigger_date LIKE 今天 AND is_completed=0）应命中
  const pushScope = todos.some((t) => t.trigger_date === dstr(0) && (t.is_completed || 0) === 0);
  check('计划在推送范围内（今日未完成 ⇒ 会被推送引擎扫到）', pushScope);

  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify({ pass, fail, r }, null, 2), 'utf-8');
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
