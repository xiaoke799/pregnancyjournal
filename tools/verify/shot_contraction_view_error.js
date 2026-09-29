/**
 * 记录页「宫缩 → 点击查看」崩溃复现（真后端 + 无头浏览器）
 *
 * 【背景】用户反馈：记录宫缩后，点击查看 ⇒ 提示「这个页面出错了」。
 * 该提示来自 App.vue 的错误边界（onErrorCaptured），它会**把具体错误信息显示在
 * .app-error-desc 里** ⇒ 探针直接把它抓出来，不用猜。
 *
 * 做法：起真后端 → 建孕期 → 写一条当天的宫缩记录 → 无头 Edge 打开记录页
 * → 点「宫缩」这一行 → 检查是否出现错误页，若出现则读出错误描述。
 *
 * 用法：node shot_contraction_view_error.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const env = require('./_env');
const UI_DIR = env.UI_DIR;
const NODE_DIR = env.SERVER_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38533);
const GW = '/app/pregnancyjournal';
const LABEL = 'contraction-error';
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
  try {
    require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (e) { /* 已退出 */ }
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

/**
 * 多场景探针（SCENE）：
 *  - record-click ：记录页，点「宫缩」类别行（原场景，已验证正常）
 *  - record-stats ：记录页，切到「统计」子标签（统计卡读 daily_record，最可疑）
 *  - stats-page   ：独立统计页 /stats
 *  - dashboard    ：首页（含宫缩计时器入口）
 * 每个场景都先看「页面本身有没有崩」，再执行点击，再看「点了之后有没有崩」。
 */
const probeFor = (scene) => `
<script>
(function () {
  const SCENE = ${JSON.stringify(scene)};
  const out = { scene: SCENE, steps: [], crashed: false, errMsg: '',
                crashedAfterClick: false, errMsgAfterClick: '', clicked: false, dialogShown: false };
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
  const clickByText = (sel, txt) => {
    const els = Array.from(document.querySelectorAll(sel));
    const el = els.find((e) => (e.textContent || '').trim().indexOf(txt) >= 0);
    if (el) { el.click(); return true; }
    return false;
  };
  setTimeout(async () => {
    try {
      const e0 = errState();
      if (e0.crashed) { out.crashed = true; out.errMsg = e0.msg; dump(); return; }

      if (SCENE === 'record-click') {
        const rows = Array.from(document.querySelectorAll('.category-row'));
        out.steps.push('类别行数=' + rows.length);
        const target = rows.find((r) => (r.textContent || '').indexOf('宫缩') >= 0);
        if (!target) { out.steps.push('没找到「宫缩」类别行'); dump(); return; }
        out.steps.push('找到宫缩行: ' + (target.textContent || '').trim().slice(0, 30).replace(/\\s+/g, ' '));
        target.click(); out.clicked = true;
      } else if (SCENE === 'record-stats') {
        // 记录页顶部子标签：记录 / 统计
        out.clicked = clickByText('button, .n-tab, .sub-tab, .seg-item, .n-radio-button', '统计');
        out.steps.push('点击「统计」子标签=' + out.clicked);
      } else if (SCENE === 'stats-page' || SCENE === 'dashboard') {
        out.clicked = true; // 纯打开页面，看渲染本身
        out.steps.push('页面已打开，等待渲染');
      } else if (SCENE === 'quick-contraction') {
        // 「＋ 添加记录」→ 菜单里点「宫缩」→ 小弹窗 → 直接保存（不填值也应能存）
        const opened = clickByText('button', '添加');
        out.steps.push('点「添加记录」=' + opened);
        await wait(600);
        const item = Array.from(document.querySelectorAll('.type-menu-item'))
          .find((e) => (e.textContent || '').indexOf('宫缩') >= 0);
        if (!item) { out.steps.push('菜单里没找到「宫缩」项'); dump(); return; }
        item.click(); out.clicked = true;
        await wait(1200);
        const modal = Array.from(document.querySelectorAll('.n-modal'))
          .find((e) => (e.textContent || '').indexOf('记录宫缩') >= 0);
        out.dialogShown = !!modal;
        out.steps.push('小弹窗「记录宫缩」=' + out.dialogShown);
        if (modal) {
          const saveBtn = Array.from(modal.querySelectorAll('button'))
            .find((b) => (b.textContent || '').trim() === '保存');
          if (saveBtn) { saveBtn.click(); out.steps.push('已点保存'); await wait(1500); }
          else out.steps.push('小弹窗里没找到「保存」');
        }
      } else if (SCENE === 'fuzz-record') {
        // 把记录页所有类别行逐个点一遍，每次点完都查一次错误边界 —— 自动定位崩点
        const rows = Array.from(document.querySelectorAll('.category-row'));
        const labels = rows.map((r) => (r.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 12));
        out.steps.push('类别行=' + rows.length);
        for (let i = 0; i < rows.length; i++) {
          rows[i].click();
          await wait(500);
          const e = errState();
          if (e.crashed) {
            out.crashedAfterClick = true;
            out.errMsgAfterClick = '点「' + labels[i] + '」后崩：' + e.msg;
            dump(); return;
          }
          // 关掉可能打开的弹窗，避免遮挡后续点击
          const mask = document.querySelector('.n-modal-mask');
          if (mask) mask.click();
          await wait(250);
        }
        out.clicked = true;
        out.steps.push('已逐个点过 ' + rows.length + ' 个类别行，全部无崩溃');
      } else if (SCENE === 'timer-flow') {
        // 计时器完整流程：开始 → 停止 → 结束本次会话
        const start = Array.from(document.querySelectorAll('button'))
          .find((b) => (b.textContent || '').trim() === '开始');
        if (!start) { out.steps.push('没找到「开始」'); dump(); return; }
        start.click(); out.clicked = true;
        out.steps.push('已点开始');
        await wait(1200);
        const stop = Array.from(document.querySelectorAll('button'))
          .find((b) => (b.textContent || '').trim() === '停止');
        if (stop) { stop.click(); out.steps.push('已点停止'); await wait(1200); }
        else out.steps.push('没找到「停止」（点击开始无效？）');
        const endS = document.querySelector('.end-session-btn');
        if (endS) { endS.click(); out.steps.push('已点「结束本次会话」'); await wait(1500); }
        else out.steps.push('没找到「结束本次会话」按钮');
      }

      await wait(2500);
      const e1 = errState();
      if (e1.crashed) { out.crashedAfterClick = true; out.errMsgAfterClick = e1.msg; }
      else {
        out.dialogShown = !!document.querySelector('.n-modal, .n-dialog');
        out.steps.push('弹窗/对话框=' + out.dialogShown);
      }
    } catch (e) {
      out.steps.push('探针异常: ' + (e && e.message));
    }
    dump();
  }, 3500);
  setTimeout(dump, 22000);
})();
</script>
`;

const SCENES = [
  { key: 'record-click', hash: 'record', title: '记录页 · 点「宫缩」类别行' },
  { key: 'fuzz-record', hash: 'record', title: '记录页 · 逐个点所有类别行（自动找崩点）' },
  { key: 'quick-contraction', hash: 'record', title: '记录页 · 「添加记录」→ 宫缩 → 保存' },
  { key: 'record-stats', hash: 'record', title: '记录页 · 切「统计」子标签' },
  { key: 'stats-page', hash: 'stats', title: '独立统计页 /stats' },
  { key: 'dashboard', hash: '', title: '首页（含宫缩计时器入口）' },
  { key: 'timer-flow', hash: 'contraction-timer', title: '宫缩计时器 · 开始→停止→结束会话' },
];

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
    try {
      const r = await req('GET', GW + '/api/v1/pregnancies/active');
      if (r.status === 200) { ready = true; break; }
    } catch (e) { /* 还没起来 */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1200)); cleanup(); process.exit(2); }

  const H = { 'Content-Type': 'application/json' };
  const p1 = await req('POST', GW + '/api/v1/pregnancies', {
    headers: H, body: JSON.stringify({ last_period_date: dstr(-162), due_date: dstr(118) }),
  });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) {
    const pa = await req('GET', GW + '/api/v1/pregnancies/active');
    pid = pa.json && pa.json.data && pa.json.data.id;
  }
  if (!pid) { console.log('建孕期失败:', JSON.stringify(p1.json)); cleanup(); process.exit(2); }

  // 写一条**当天**的宫缩记录（记录页默认显示今天）
  const rec = await req('POST', GW + '/api/v1/daily-records', {
    headers: H,
    body: JSON.stringify({
      pregnancy_id: pid, record_date: dstr(0),
      contraction_count: 3,
      contraction_duration: 45,
      contraction_interval: 8,
      contraction_pain: '明显',
      note: '',
    }),
  });
  console.log('写宫缩记录: ' + (rec.json && rec.json.code));

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); cleanup(); process.exit(2); }

  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  const profile = path.join(T, 'edge-profile');

  /** 打开一个场景并取回探针结果 */
  async function runScene(s) {
    const name = `_tmp_err_${s.key}.html`;
    const variant = path.join(UI_DIR, name);
    fs.writeFileSync(variant, html.replace('</body>', probeFor(s.key) + '</body>'), 'utf-8');
    const url = `http://127.0.0.1:${PORT}${GW}/${name}#/${s.hash}`;
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', '--mute-audio', '--disable-extensions',
      `--user-data-dir=${profile}`, '--window-size=430,900',
      '--virtual-time-budget=60000', '--dump-dom', url,
    ];
    const WATCH_MS = 120000;
    const dom = await new Promise((resolve) => {
      const p = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      spawned.add(p);
      let o = '', done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(wd); spawned.delete(p); resolve(o); };
      const wd = setTimeout(() => { o += '\n[看门狗] 超时'; killTree(p.pid); finish(); }, WATCH_MS);
      p.stdout.on('data', (d) => (o += d));
      p.stderr.on('data', (d) => (o += d));
      p.on('close', finish);
      p.on('error', () => { killTree(p.pid); finish(); });
    });
    try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }
    fs.writeFileSync(path.join(OUT, `dom-${s.key}.html`), dom, 'utf-8');
    const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
    if (!m) return null;
    try { return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch (e) { return null; }
  }

  let fail = 0;
  const results = [];
  for (const s of SCENES) {
    const r = await runScene(s);
    console.log('\n【' + s.title + '】');
    if (!r) { console.log('  ⚠️ 没取到探针结果'); results.push({ s, r: null }); continue; }
    (r.steps || []).forEach((x) => console.log('  · ' + x));
    if (r.crashed) {
      fail++;
      console.log('  ✘ 打开页面就崩了');
      console.log('    💬 错误描述: ' + (r.errMsg || '(空)'));
    } else if (r.crashedAfterClick) {
      fail++;
      console.log('  ✘ 点击后崩了');
      console.log('    💬 错误描述: ' + (r.errMsgAfterClick || '(空)'));
    } else {
      console.log('  ✔ 无崩溃' + (r.dialogShown ? '（弹窗正常打开）' : ''));
    }
    results.push({ s, r });
  }

  fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log('\n明细: ' + path.join(OUT, LABEL + '.json'));
  console.log('合计: ' + (SCENES.length - fail) + ' 通过 / ' + fail + ' 失败');
  cleanup();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
