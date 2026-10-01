/**
 * 饮食页「催奶食谱大全」分类切换 —— 真后端 + 无头浏览器端到端核验。
 *
 * 【为什么需要它】
 * 2026-10-01 用户反馈：「饮食 → 催奶食谱大全」只有「猪蹄系列」能显示，
 * 点鱼类 / 禽肉等**没反应**。根因是 `<n-radio-group v-model="boostCat">` 写成了裸 `v-model`
 * ——naive-ui 没有 modelValue 约定（组件用具名 prop `value`），于是：
 *   · boostCat 永远停在初值 'pig' ⇒ 内容永远是猪蹄系列；
 *   · 连**选中态都没有**（组件拿不到 value）。
 * 静态护栏 `verify_naive_vmodel.js` 已把「绑定名对不对」钉死；本套件补的是**行为层**：
 * 真实点击这几个分类，确认**内容与选中态都跟着换**。
 *
 * 【实测口径（反例已验证）】
 * 把源码改回裸 `v-model` 重跑 ⇒ `④ 点鱼类后` 仍是 `猪蹄=true 鲫鱼=false`，
 * 且 radio 列表里**一个 `*`（选中态）都没有**，判定 ❌。修复后 ✅。
 *
 * 【为什么不用 `.click()` 展开折叠区】
 * naive-ui 的 `n-collapse-item__header` 对合成 `click()` 不响应（点了 DOM 也没展开，
 * 内容区还是 `<!---->`）；必须派发**冒泡的真实 MouseEvent**（mousedown/mouseup/click）。
 *
 * 用法：node tools/verify/probe_diet_categories.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const env = require('./_env');
const NODE_DIR = env.SERVER_DIR;
const UI_DIR = env.UI_DIR;
const PORT = Number(process.env.PJ_TCP_PORT || 38641);
const GW = '/app/pregnancyjournal';
const T = path.join(env.TMP, 'diet-categories');
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

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {};
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch (e) { /* 非 JSON */ } resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) { if (!pid) return; try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { /* 已退出 */ } }
function findBrowser() {
  for (const c of ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe']) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

const PROBE = `<script>
(function () {
  var out = { steps: [], radios: [], opened: false, tabbed: false };
  function dump() {
    var o = document.getElementById('DIAG'); if (o) o.remove();
    var d = document.createElement('div'); d.id = 'DIAG';
    d.textContent = JSON.stringify(out); document.body.appendChild(d);
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function has(t) { return document.body.innerText.indexOf(t) >= 0; }
  function snap(tag) {
    out.steps.push({ tag: tag, pig: has('猪蹄黄豆汤'), fish: has('鲫鱼炖木瓜'), chicken: has('黄芪炖鸡汤'),
                     veg: has('木瓜花生大枣汤'), tips: has('大麦芽'), radios: radios() });
  }
  function radios() {
    return Array.prototype.slice.call(document.querySelectorAll('.n-radio-button'))
      .map(function (e) { return (e.textContent || '').trim() + (e.className.indexOf('--checked') >= 0 ? '*' : ''); });
  }
  function clickTab(txt) {
    var ts = Array.prototype.slice.call(document.querySelectorAll('.n-tabs-tab'));
    for (var i = 0; i < ts.length; i++) { if ((ts[i].textContent || '').trim() === txt) { ts[i].click(); return true; } }
    return false;
  }
  function clickCollapse(txt) {
    // ⚠️ naive-ui 的折叠头不响应合成 click()，必须派发冒泡的真实 MouseEvent
    var items = Array.prototype.slice.call(document.querySelectorAll('.n-collapse-item'));
    for (var i = 0; i < items.length; i++) {
      var h = items[i].querySelector('.n-collapse-item__header');
      if (h && (h.textContent || '').indexOf(txt) >= 0) {
        var targets = [h.querySelector('.n-collapse-item__header-main'), h];
        for (var j = 0; j < targets.length; j++) {
          if (!targets[j]) continue;
          ['mousedown', 'mouseup', 'click'].forEach(function (t) {
            targets[j].dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
          });
        }
        return true;
      }
    }
    return false;
  }
  function clickRadio(txt) {
    var ls = Array.prototype.slice.call(document.querySelectorAll('.n-radio-button'));
    for (var i = 0; i < ls.length; i++) { if ((ls[i].textContent || '').trim() === txt) { ls[i].click(); return true; } }
    return false;
  }
  setTimeout(async function () {
    try {
      await wait(2500);
      out.tabbed = clickTab('婴儿喂养');
      await wait(1800);
      out.opened = clickCollapse('催奶食谱大全');
      await wait(1500);
      out.radios = radios();
      snap('展开后');
      var cats = ['鱼类系列', '禽肉类', '素食谷物', '宜忌速查'];
      for (var i = 0; i < cats.length; i++) {
        clickRadio(cats[i]);
        await wait(1500);
        snap(cats[i]);
        out.radios = radios();
      }
      dump();
    } catch (e) { out.err = String(e); dump(); }
  }, 1500);
})();
</script>`;

(async () => {
  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); process.exit(2); }
  if (!fs.existsSync(path.join(UI_DIR, 'index.html'))) { console.log('app/ui 未构建'); process.exit(2); }

  const child = spawn(process.execPath, ['-r', path.join(env.VERIFY_DIR, 'tcp_shim.js'), path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = ''; child.stdout.on('data', (d) => (srvLog += d)); child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => killTree(child.pid);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const h = await req('GET', GW + '/api/health'); if (h.json && h.json.status === 'ok') { ready = true; break; } } catch (e) { /* 等 */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1000)); cleanup(); process.exit(2); }

  await req('POST', GW + '/api/v1/pregnancies', { last_period_date: '2026-01-01' });

  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  const name = '_tmp_dietcats.html';
  fs.writeFileSync(path.join(UI_DIR, name), html.replace('</body>', PROBE + '</body>'), 'utf-8');
  const url = `http://127.0.0.1:${PORT}${GW}/${name}#/diet`;
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${path.join(T, 'edge')}`, '--window-size=430,900',
    '--virtual-time-budget=60000', '--dump-dom', url];

  const dom = await new Promise((resolve) => {
    const pr = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', done = false;
    const fin = () => { if (done) return; done = true; resolve(o); };
    const wd = setTimeout(() => { killTree(pr.pid); fin(); }, 180000);
    pr.stdout.on('data', (d) => (o += d));
    pr.stderr.on('data', (d) => (o += d));
    pr.on('close', () => { clearTimeout(wd); fin(); });
  });
  try { fs.unlinkSync(path.join(UI_DIR, name)); } catch (e) { /* ignore */ }

  const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
  if (!m) {
    check('能取到页面探针结果', false, 'dom 长度=' + dom.length + '；可能 app/ui 未构建或页面没起来');
    console.log('\n' + out.join('\n'));
    console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
    cleanup(); process.exit(1);
  }
  const r = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

  const step = (tag) => (r.steps || []).find((s) => s.tag === tag) || {};
  const hasStar = (radios, cat) => (radios || []).some((x) => x === cat + '*');

  check('切到「婴儿喂养」标签页', r.tabbed === true);
  check('展开「催奶食谱大全」', r.opened === true);
  check('展开后 5 个分类按钮都在',
    (r.radios || []).filter((x) => /系列|禽肉|素食|宜忌/.test(x)).length === 5,
    JSON.stringify(r.radios));
  const s0 = step('展开后');
  check('初始显示「猪蹄系列」内容', s0.pig === true && s0.fish !== true, JSON.stringify(s0));
  check('初始选中态在「猪蹄系列」', hasStar(s0.radios, '猪蹄系列'), JSON.stringify(s0.radios));

  const s1 = step('鱼类系列');
  check('点「鱼类系列」后换成鱼类内容', s1.fish === true && s1.pig !== true, JSON.stringify(s1));
  const s2 = step('禽肉类');
  check('点「禽肉类」后换成禽肉内容', s2.chicken === true && s2.fish !== true, JSON.stringify(s2));
  const s3 = step('素食谷物');
  check('点「素食谷物」后换成素食内容', s3.veg === true && s3.chicken !== true, JSON.stringify(s3));
  const s4 = step('宜忌速查');
  check('点「宜忌速查」后换成宜忌内容', s4.tips === true && s4.veg !== true, JSON.stringify(s4));

  // 选中态必须跟着走（这正是裸 v-model 时缺失的那一半）
  const last = r.radios || [];
  check('末态选中态落在「宜忌速查」（不是一直卡在猪蹄）',
    hasStar(last, '宜忌速查') && !hasStar(last, '猪蹄系列'), JSON.stringify(last));

  console.log('\n' + out.join('\n'));
  if (r.err) console.log('  探针异常: ' + r.err);
  console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
  cleanup();
  process.exit(fail ? 1 : 0);
})();
