/**
 * 记录页「专属小弹窗」风格一致性核验（真实渲染 + 无头浏览器）
 *
 * 【为什么需要它】
 * 记录页的「添加记录」快捷菜单里，每个类型点下去都应弹出一个 420px 的小卡片
 * （日期 / 选项 / 就医提示 / 备注），而不是 26 个类型挤一屏的通用大弹窗。
 * 2026-09-28 之前 水肿 / 分泌物 / 皮肤状况 / 排尿情况 这四类偏偏没有小弹窗，
 * 用户反馈「风格不统一」——这类问题静态检查看不出来，必须真的点一遍。
 *
 * 做法：起真后端 → 建孕期 → 无头 Edge 打开记录页 → 依次点开每个类型的快捷项，
 * 读真实 DOM 与**计算后的样式**（弹窗宽度/字段名/提示条背景与字号/label 颜色），
 * 再与一个「老牌」类型（便便）逐项对比。四条都对齐才算统一。
 *
 * ⚠️ 三个踩过的坑：
 *   ① 不能拿 `.type-menu-item` 的 textContent 匹配类型名 —— 项里还有一个图标 span，
 *      文本实际是「🦵水肿」。必须读内部的 `.type-menu-label`。
 *   ② 不能按 DOM 顺序取 `.n-modal` —— 上一个弹窗还在关闭动画里时它会排在前面，
 *      量到的是别人。必须**按弹窗标题**定位；并且要轮询到宽度稳定再取值，
 *      否则量到的是入场动画的中间态（会得到 210px 这种假宽度）。
 *   ③ 🔴 临时目录会被上一轮被强杀的无头浏览器残留在那，**删除极慢甚至卡死**：
 *      实测 `fs.rmSync(<tmp>/pj-quickmodal-shot)` 要 19.5 秒（profile 里几万个小文件），
 *      而残留实例占着它时会直接挂住 —— 表现为「跑了 9 分钟、日志 0 字节、什么都不打印」，
 *      因为卡在开头的 rm 上，连第一行输出都到不了。
 *      对策：rm 失败/超时就**换一个唯一目录**接着跑，别让整轮核验死在这里；
 *      另外给浏览器进程加了看门狗（`PJ_SHOT_WATCH_MS`，默认 150s），
 *      卡住就按进程树杀掉并如实报「浏览器超时」，而不是无限等 close。
 *
 * 用法：node shot_record_quickmodals.js [标签]
 *       node shot_record_quickmodals.js 标签 shot:水肿     ← 只截图某一种
 * 产物：tools/verify/.tmp/quickmodal-shot/<标签>.json 与 <标签>-<类型>.png
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const env = require('./_env');
const LABEL = process.argv[2] || 'quickmodal';
const SHOT_TYPE = (process.argv[3] || '').replace(/^shot:/, '');
const ROOT = env.REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T0 = path.join(os.tmpdir(), 'pj-quickmodal-shot');
const OUT = path.join(env.TMP, 'quickmodal-shot');
const PORT = Number(process.env.PJ_TCP_PORT || 38507);
const GW = '/app/pregnancyjournal';
const UI_DIR = process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui');
const DESKTOP = process.env.PJ_SHOT_DESKTOP === '1';
const WIN_W = DESKTOP ? 1280 : 504;
const WIN_H = Number(process.env.PJ_SHOT_H || 900);

/** 新补的小弹窗 + 老牌对照。
 *  ⚠️ 对照必须挑一个**自己就带 form-hint-text 提示条**的类型 —— 便便的小弹窗没有提示条，
 *     拿它当基准会把「有没有提示条」这一项比成假失败。饮水/胎动/尿酸/三围都有。
 *  2026-09-29 追加「用药」：它此前**整个入口都不存在**（quickTypes/openQuickAdd/
 *  记录列表/大弹窗四处全漏），补齐后必须与其它类型风格一致。 */
const NEW_TYPES = ['水肿', '分泌物', '皮肤状况', '排尿情况', '用药'];
const REF_TYPES = ['饮水'];
const ALL_TYPES = NEW_TYPES.concat(REF_TYPES);
/**
 * ⚠️ 定位弹窗**不要写死标题全文**（铁律 #44）。
 *    2026-09-29 用药弹窗改名为「临时补记 · 用药」后，这里原来写死的
 *    `TITLES = { 用药: '记录用药' }` 直接把整套判成"弹出的不是本类型"，假红。
 *    改成：**标题里含该类型名就算命中**（参照物 = 类型名本身），
 *    以后给标题加前后缀都不会再误判。
 */

/**
 * 准备一个干净的临时目录。
 * ⚠️ 不能只 `fs.rmSync(T)` 了事：残留的无头浏览器会占着它，删除要么极慢（实测 19.5 秒）
 *    要么直接卡住 —— 卡在开头会让整轮核验「9 分钟没输出、日志 0 字节」。
 *    所以删不掉就**换一个唯一目录**继续跑，最多多占一点临时空间，但不会把本轮拖死。
 */
function prepareTmpDir() {
  const t0 = Date.now();
  try {
    fs.rmSync(T0, { recursive: true, force: true });
    console.log(`临时目录已清空（${Date.now() - t0}ms）：${T0}`);
    return T0;
  } catch (e) {
    const alt = `${T0}-${process.pid}-${Date.now()}`;
    console.log(`⚠️ 旧临时目录清不掉（${e.code}），改用新目录：${alt}`);
    return alt;
  }
}
const T = prepareTmpDir();
fs.mkdirSync(T, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

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

/** 本脚本起过的浏览器进程（供 cleanup 连树杀掉，避免留下常驻无头实例） */
const spawned = new Set();
/** Windows 下必须按进程树杀：直接 kill 父进程会留下渲染/GPU 子进程 */
function killTree(pid) {
  if (!pid) return;
  try {
    require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (e) { /* 进程可能已退出 */ }
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
 * 「统一风格」的判定契约（不是逐字相等 —— 不同指标的字段数本来就不同）：
 *   ① 弹窗必须是**小卡片**，不是 26 类型选择器的通用大弹窗
 *   ② 宽度：四类之间一致，且落在既有小弹窗的档位区间内（项目里现用 400/420/440 三档）
 *   ③ 结构一致：首字段「日期」，末字段与**对照类型**的末字段同名（现为「当天备注（可选）」），且有日期选择器
 *   ④ 配色/字号走同一套令牌（label 颜色、提示条背景与字号）
 *   ⑤ 有就医提示文案
 *
 * ⚠️ 宽度取 `getComputedStyle().maxWidth` 而不是 `getBoundingClientRect().width`：
 *    无头模式 + virtual-time 下动画帧不一定会推进，rect 会取到入场缩放的中间态
 *    （实测得到「正好一半」的 210px），断言会时红时绿完全不可信。max-width 不参与动画。
 */
function judge(row, ref, allNew) {
  if (!row || !row.found) {
    const why = row && row.diag ? '｜DOM 里 .n-modal ' + (row.modalNodeCount || 0) + ' 个：' + row.diag : '';
    return ['没弹出任何弹窗' + (row && row.why ? '（' + row.why + '）' : '') + why];
  }
  const bad = [];
  if (row.titleMismatch) bad.push('弹出的不是本类型的小弹窗（实际标题「' + row.title + '」）');
  if (!row.isQuick) bad.push('打开的是通用大弹窗（不是专属小弹窗）');
  if (!row.hasDatePicker) bad.push('缺日期选择器');
  const labels = String(row.labels).split(' / ');
  if (labels[0] !== '日期') bad.push('首字段不是「日期」(' + labels[0] + ')');
  // ⚠️ 末字段必须与**对照类型**一致，而不是写死字符串 ——
  //    2026-09-29 把「备注（可选）」统一改成「当天备注（可选）」时，这里因为写死了旧文案，
  //    5 个类型**全体假红**（明明彼此完全一致）。对照式断言才不会随文案漂移。
  const refLabels = ref && ref.labels ? String(ref.labels).split(' / ') : [];
  const refLast = refLabels.length ? refLabels[refLabels.length - 1] : '';
  const selfLast = labels[labels.length - 1];
  if (refLast) {
    if (selfLast !== refLast) bad.push('末字段「' + selfLast + '」≠ 对照「' + refLast + '」');
  } else if (selfLast !== '备注（可选）') {
    bad.push('末字段不是「备注（可选）」(' + selfLast + ')');
  }
  if (String(row.hintText) === '(无)') bad.push('缺就医提示文案');
  if (!(row.maxWidth >= 400 && row.maxWidth <= 440)) bad.push('弹窗 max-width ' + row.maxWidth + 'px 不在既有档位 400~440');
  // 四类之间互相对齐：只有「偏离多数」的那个才算不统一（否则会顺手把三个正常的也标红）
  const counted = allNew.filter((o) => o && o.found).map((o) => o.maxWidth);
  if (counted.length > 1) {
    const freq = {};
    counted.forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
    const mode = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0]);
    if (row.maxWidth !== mode) bad.push('与其余新类型的 max-width 不一致（本类 ' + row.maxWidth + '，多数 ' + mode + '）');
  }
  if (ref) {
    if (row.labelColor !== ref.labelColor) bad.push('label 颜色 ' + row.labelColor + ' ≠ 对照 ' + ref.labelColor);
    if (row.hintBg !== ref.hintBg) bad.push('提示条底色 ' + row.hintBg + ' ≠ 对照 ' + ref.hintBg);
    if (row.hintFont !== ref.hintFont) bad.push('提示条字号 ' + row.hintFont + ' ≠ 对照 ' + ref.hintFont);
  }
  return bad;
}

const PROBE = `
<script>
(function () {
  var TYPES = __TYPES__;
  var SHOT = '__SHOT__';
  var out = [];
  var i = 0;

  function clean(s) { return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim(); }
  function trigger() { return document.querySelector('.action-bar button.n-button'); }

  // ⚠️ 一律用 offsetWidth / offsetHeight 判断「弹窗有没有渲染出来」，不要用 getBoundingClientRect：
  //    naive-ui 的弹窗入场是 Vue <Transition> + transform:scale，无头模式 + virtual-time 下
  //    动画帧不一定推进到位，rect 会取到 scale≈0（看着像"没弹窗"）或 0.5（宽度正好一半）的中间态。
  //    offsetWidth 是布局值，不受 transform 影响，稳定可靠。
  //    （也试过注入 *{transition:none} 去禁动画 —— 那会破坏 Vue Transition 移除 enter 类的时机，
  //      元素永远停在 scale(0.5)，反而更糟。）

  /** 当前所有可见的弹窗（offsetWidth 判定，不受入场缩放影响） */
  function visibleModals() {
    var ms = document.querySelectorAll('.n-modal'), r = [];
    for (var k = 0; k < ms.length; k++) if (ms[k].offsetWidth > 4 && ms[k].offsetHeight > 4) r.push(ms[k]);
    return r;
  }

  /** 按标题精确定位「这一个」弹窗（不能按 DOM 顺序取，会拿到正在关闭的旧弹窗） */
  function modalFor(label) {
    var ms = visibleModals();
    for (var k = ms.length - 1; k >= 0; k--) {
      var h = ms[k].querySelector('.n-card-header__main') || ms[k].querySelector('.n-card-header');
      if (h && clean(h.textContent).indexOf(label) >= 0) return ms[k];
    }
    return null;
  }

  function titleOf(m) {
    return clean((m.querySelector('.n-card-header__main') || m.querySelector('.n-card-header') || {}).textContent);
  }

  /** 菜单项的 textContent 含图标（「🦵水肿」），必须读内部 .type-menu-label */
  function clickType(label) {
    var items = document.querySelectorAll('.type-menu .type-menu-item');
    for (var k = 0; k < items.length; k++) {
      var l = items[k].querySelector('.type-menu-label');
      if (l && clean(l.textContent) === label) { items[k].click(); return true; }
    }
    return false;
  }

  function closeModal(label) {
    var m = modalFor(label);
    if (!m) { var any = visibleModals(); m = any.length ? any[any.length - 1] : null; }
    if (!m) return;
    var bs = m.querySelectorAll('button');
    for (var k = 0; k < bs.length; k++) {
      if (clean(bs[k].textContent) === '取消') { bs[k].click(); return; }
    }
  }

  function measure(label, el) {
    var m = el || modalFor(label);
    if (!m) { out.push({ type: label, found: false }); return; }
    var groups = m.querySelectorAll('.qf-group');
    var labels = [];
    for (var k = 0; k < groups.length; k++) {
      var l = groups[k].querySelector('label');
      labels.push(l ? clean(l.textContent) : '(无label)');
    }
    var hint = m.querySelector('.form-hint-text');
    var radios = m.querySelectorAll('.n-radio-button');
    var radioTexts = [];
    for (var j = 0; j < radios.length; j++) radioTexts.push(clean(radios[j].textContent));
    var noteEls = m.querySelectorAll('.qf-group input');
    var note = noteEls.length ? noteEls[noteEls.length - 1] : null;
    var lbl = m.querySelector('.qf-group label');
    var mw = parseInt(getComputedStyle(m).maxWidth, 10);
    var title = titleOf(m);
    out.push({
      type: label,
      found: true,
      /** 弹出来的弹窗标题不是本类型的（例如掉进了通用大弹窗） */
      titleMismatch: title.indexOf(label) < 0,
      isQuick: !m.querySelector('.type-selector'),   // 通用大弹窗会带 26 类型的 .type-selector
      title: title,
      /** 只用 max-width 做宽度断言；rectWidth 仅作参考（会受动画影响） */
      maxWidth: isNaN(mw) ? -1 : mw,
      /** 布局宽度，仅作参考（真正的宽度断言走 maxWidth） */
      layoutWidth: m.offsetWidth,
      groups: groups.length,
      labels: labels.join(' / '),
      hintText: hint ? clean(hint.textContent).slice(0, 16) : '(无)',
      hintBg: hint ? getComputedStyle(hint).backgroundColor : '(无)',
      hintFont: hint ? getComputedStyle(hint).fontSize : '(无)',
      labelColor: lbl ? getComputedStyle(lbl).color : '(无)',
      radioCount: radios.length,
      radios: radioTexts.join(','),
      notePlaceholder: note ? clean(note.getAttribute('placeholder')) : '(无)',
      hasDatePicker: !!m.querySelector('.n-date-picker'),
    });
  }

  /** 轮询到布局宽度连续两次不变再取值 —— 避免量到还没完成布局的中间状态 */
  function measureStable(label, done) {
    var last = -1, same = 0, tries = 0;
    (function poll() {
      tries++;
      var m = modalFor(label);
      if (m) {
        var w = m.offsetWidth;
        if (w === last && w > 4) same++; else { same = 0; last = w; }
        if (same >= 2) { measure(label, m); done(); return; }
      }
      if (tries > 30) {
        // 标题没匹配上（可能弹的是别的弹窗，比如通用大弹窗）→ 退一步量「当前可见的那个」，
        // 这样 report 里能看出「开错了弹窗」而不是含糊的「没弹窗」。
        var any = visibleModals();
        if (any.length) { measure(label, any[any.length - 1]); done(); return; }
        // 连可见弹窗都没有：把 DOM 里所有 .n-modal 的实况记下来（否则只剩一句「没弹窗」，没法排查）
        var all = document.querySelectorAll('.n-modal'), diag = [];
        for (var q = 0; q < all.length; q++) {
          diag.push(clean(all[q].className).slice(0, 40) + '[' + all[q].offsetWidth + 'x' + all[q].offsetHeight + ']' + titleOf(all[q]));
        }
        out.push({
          type: label, found: false, modalNodeCount: all.length,
          diag: diag.length ? diag.join(' | ') : '(DOM 里没有任何 .n-modal)',
          menuOpen: !!document.querySelector('.type-menu'),
        });
        done(); return;
      }
      setTimeout(poll, 120);
    })();
  }

  function loop() {
    if (i >= TYPES.length) { dump(); return; }
    var label = TYPES[i];
    if (!clickType(label)) {
      out.push({ type: label, found: false, why: '菜单里没找到该项' });
      i++; setTimeout(loop, 300); return;
    }
    setTimeout(function () {
      measureStable(label, function () {
        closeModal(label);
        i++;
        setTimeout(loop, 900);
      });
    }, 700);
  }

  function start() {
    // n-popover 的内容要展开过一次才进 DOM，所以只开一次，之后直接点菜单项
    trigger().click();
    if (SHOT) {
      setTimeout(function () { clickType(SHOT); }, 700);
      setTimeout(function () { try { trigger().click(); } catch (e) {} }, 1800);
      return;
    }
    setTimeout(loop, 700);
  }

  function dump() {
    var host = document.getElementById('DIAG') || document.createElement('div');
    host.id = 'DIAG';
    host.textContent = JSON.stringify(out);
    host.style.display = 'none';
    document.body.appendChild(host);
  }

  setTimeout(start, 1800);
  setTimeout(dump, 30000);
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
    // ⚠️ 必须连浏览器子进程一起收掉：只杀 server 的话，被 SIGTERM 打断时会留下
    //    一堆无头 Edge 进程常驻吃资源（实测残留 10 个，后面几次运行都被拖到超时）。
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
    } catch (e) { /* not up */ }
  }
  if (!ready) { console.log('服务未就绪:\n' + srvLog.slice(-1500)); cleanup(); process.exit(2); }

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

  // 写一条记录让记录页有内容（四类留空 ⇒ 快捷项处于「+」可添加态）
  await req('POST', GW + '/api/v1/daily-records', {
    headers: H, body: JSON.stringify({ pregnancy_id: pid, record_date: dstr(0), weight: 64.2 }),
  });

  const variant = path.join(UI_DIR, '_tmp_quickmodal.html');
  const html = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf-8');
  const probeJs = PROBE
    .replace('__TYPES__', JSON.stringify(ALL_TYPES))
    .replace('__SHOT__', SHOT_TYPE);
  fs.writeFileSync(variant, html.replace('</body>', probeJs + '</body>'), 'utf-8');

  const browser = findBrowser();
  if (!browser) { console.log('找不到 Edge/Chrome'); fs.unlinkSync(variant); cleanup(); process.exit(2); }

  const profile = path.join(T, 'edge-profile');
  const url = `http://127.0.0.1:${PORT}${GW}/_tmp_quickmodal.html#/record`;
  const common = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    `--user-data-dir=${profile}`,
    `--window-size=${WIN_W},${WIN_H}`,
    '--virtual-time-budget=60000',
  ];
  /**
   * 起一次浏览器并等它自己退出。
   * ⚠️ 必须有看门狗：headless + `--virtual-time-budget` 偶发不退出（网络请求一直挂起时
   *    虚拟时钟会停住），没有看门狗就是无限等 `close`。第一次踩到时表现为
   *    「命令跑了 9 分钟、日志 0 字节」，只能人工发现。
   *    超时按**进程树**杀，返回 timedOut 让调用方明确报出来，而不是装作成功。
   */
  const WATCH_MS = Number(process.env.PJ_SHOT_WATCH_MS || 150000);
  const run = (args) => new Promise((resolve) => {
    const p = spawn(browser, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    spawned.add(p);
    let o = '', done = false;
    const finish = (timedOut) => {
      if (done) return;
      done = true;
      clearTimeout(wd);
      spawned.delete(p);
      resolve({ out: o, timedOut });
    };
    const wd = setTimeout(() => {
      o += `\n[看门狗] 浏览器 ${WATCH_MS}ms 未退出，按进程树结束（PID ${p.pid}）`;
      killTree(p.pid);
      finish(true);
    }, WATCH_MS);
    p.stdout.on('data', (d) => (o += d));
    p.stderr.on('data', (d) => (o += d));
    p.on('close', () => finish(false));
    p.on('error', () => finish(true));
  });

  try {
    if (SHOT_TYPE) {
      const png = path.join(OUT, `${LABEL}-${SHOT_TYPE}.png`);
      try { fs.unlinkSync(png); } catch (e) { /* 没有就算了 */ }
      const r = await run([...common, `--screenshot=${png}`, url]);
      if (r.timedOut) console.log('⚠️ 浏览器超时被杀，截图可能不完整');
      if (!fs.existsSync(png) || fs.statSync(png).size < 1000) {
        console.log('❌ 截图没有生成：' + png);
        process.exitCode = 1;
      } else {
        console.log('截图: ' + png + `（${Math.round(fs.statSync(png).size / 1024)} KB）`);
      }
    } else {
      const { out: dom, timedOut } = await run([...common, '--dump-dom', url]);
      if (timedOut) console.log('⚠️ 浏览器超时被杀，DOM 可能不完整（结果仅供参考）');
      if (process.env.PJ_QM_DEBUG) console.log('--- BROWSER 输出长度 ' + dom.length + ' ---');
      const m = dom.match(/<div id="DIAG"[^>]*>(.*?)<\/div>/s);
      let rows = [];
      if (m) { try { rows = JSON.parse(m[1].replace(/&quot;/g, '"')); } catch (e) { /* ignore */ } }
      fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(rows, null, 2), 'utf-8');
      console.log('探针结果: ' + path.join(OUT, LABEL + '.json'));

      const byType = {};
      rows.forEach((r) => { byType[r.type] = r; });
      const ref = byType[REF_TYPES[0]];
      const newRows = NEW_TYPES.map((t) => byType[t]).filter(Boolean);
      console.log(`\n对照类型「${REF_TYPES[0]}」（老牌小弹窗）: ` + (ref && ref.found
        ? `max-width ${ref.maxWidth}px · 提示条 ${ref.hintBg}/${ref.hintFont} · label ${ref.labelColor}`
        : '未取到！'));
      console.log('\n【风格一致性判定】');
      let failed = 0;
      for (const t of NEW_TYPES) {
        const r = byType[t];
        const bad = judge(r, ref, newRows);
        if (bad.length) { failed++; console.log(`  ✘ ${t}: ${bad.join('；')}`); }
        else console.log(`  ✔ ${t}: max-width ${r.maxWidth}px · 字段「${r.labels}」· ${r.radioCount} 选项 · 提示「${r.hintText}…」`);
      }
      console.log(`\n合计: ${NEW_TYPES.length - failed} 通过 / ${failed} 失败`);
      if (!ref || !ref.found) console.log('⚠️ 没取到对照类型，配色三项未纳入对比（判定不完整）');
      if (failed || !ref || !ref.found) { cleanup(); process.exit(1); }
    }
  } finally {
    try { fs.unlinkSync(variant); } catch (e) { /* ignore */ }
    cleanup();
  }
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
