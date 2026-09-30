/**
 * 真实渲染验证（无头浏览器）
 *
 * 【为什么必须有它】
 * Vue 模板里引用不存在的变量，`vite build` 不报错、静态检查也未必抓得住 ——
 * 只有**真的把这个页面渲染一遍**才会暴露。
 * 2026-09-28 真实事故：相册页写成 `photos.length`（实际叫 allPhotos），
 * 构建、打包、解包验证全绿，用户装上才发现相册整页变成「这个页面出错了」。
 *
 * 做法：起真后端（tcp_shim 转 TCP）→ 用系统自带 Edge 无头模式逐个打开路由 →
 * 拿回渲染后的 DOM → 判断有没有被 App.vue 的错误边界接住。
 *
 * 判定依据（都来自项目自身的实现）：
 *   - 出现 `app-error-boundary` / `这个页面出错了` ⇒ 该页渲染崩溃（失败）
 *   - `#boot-splash` 还在                        ⇒ Vue 根本没挂载成功（失败）
 *   - 其余                                       ⇒ 通过
 *
 * 用法：node tools/verify/verify_render.js
 */
const { spawn, execFileSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NODE_DIR = path.resolve(__dirname, '../../app/server/node');
const SHIM = path.resolve(__dirname, 'tcp_shim.js');
const UI = path.resolve(__dirname, '../../app/ui');
const PORT = 38521;
const PREFIX = '/app/pregnancyjournal';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// 需要逐个验证的路由（与 frontend/src/router/index.ts 保持一致）
const ROUTES = [
  ['/', '首页'],
  ['/record', '记录'],
  ['/album', '相册'],
  ['/diary', '日记'],
  ['/checkup-schedule', '产检'],
  ['/diet', '饮食'],
  ['/checklist', '清单'],
  ['/stats', '统计'],
  ['/exercise-guide', '运动指南'],
  ['/weekly-detail', '本周变化'],
  ['/dose-plan', '用药/补充'],
  ['/settings', '设置'],
  ['/contraction-timer', '宫缩计时'],
  ['/fetal-movement-counter', '胎动计数'],
  ['/setup', '初始设置'],
];

/**
 * 往测试库里放一条孕期档案 —— **必须做，否则验证会假绿**。
 *
 * 很多页面（相册、统计、记录…）在没有档案时会直接 return，
 * 从而绕过真正要验证的渲染分支。2026-09-28 那个相册 bug 就是这么被漏掉的：
 * `loadPhotos()` 里 `if (!currentPregnancy) return` 在前，
 * 没档案时 `loading` 永远是 false，出问题的那个三元分支根本没被执行到。
 */
async function seedTestData(dbPath) {
  const initSqlJs = require(path.join(NODE_DIR, 'node_modules/sql.js'));
  const SQL = await initSqlJs();

  // ⚠️ 用**全新的空库 + 产品自己的建表语句**，而不是复制那个老的开发库。
  //    老开发库里残留着早已废弃的列（例如 contraction_session.alert_triggered，
  //    NOT NULL 且无默认值，而现在的代码根本不写它），会让「宫缩计时」在建会话时
  //    违反约束而崩 —— 那是**老库兼容性**问题，不该混进「前端渲染」的验证里，
  //    否则本脚本会背着一个永远红的项目，真正的渲染问题反而被淹没。
  const d = new SQL.Database();
  const dbSrc = fs.readFileSync(path.join(NODE_DIR, 'db.js'), 'utf8');
  const schemaBlock = (dbSrc.match(/const SCHEMA = `([\s\S]*?)`;/) || [])[1] || '';
  let created = 0;
  for (const stmt of schemaBlock.split(';').map((s) => s.trim())) {
    if (!/^CREATE TABLE/i.test(stmt)) continue;   // 跳过 PRAGMA 等
    try { d.run(stmt); created++; } catch (e) { /* 单个失败不影响其它表 */ }
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  try {
    if (created === 0) throw new Error('未能从 db.js 解析出建表语句');
    d.run(
      `INSERT OR REPLACE INTO pregnancy
       (id, last_period_date, conception_date, due_date, is_active, baby_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
      ['e2e-render-0001', '2026-01-01', '2026-01-15', '2026-10-08', '渲染验证', now, now]
    );
    fs.writeFileSync(dbPath, Buffer.from(d.export()));
    return true;
  } catch (e) {
    console.log(`⚠️ 写入测试档案失败（页面可能走"无档案"分支）: ${e.message}`);
    return false;
  }
}

const tmpData = path.join(os.tmpdir(), 'pj_render_' + Date.now());
fs.mkdirSync(tmpData, { recursive: true });
const testDbPath = path.join(tmpData, 'pregnancyjournal.db');
// 刻意不复制 data/pregnancy-journal.db：那是长期使用的开发库，带着早已废弃的表结构，
// 会引入与本脚本无关的干扰（详见 seedTestData 的说明）。这里由 seedTestData 建全新库。

let child = null;

/** 起服务（⚠️ 必须在 seedTestData 之后：服务启动时就把库读进内存了） */
function startServer() {
  child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR,
    env: {
      ...process.env,
      PJ_TCP_PORT: String(PORT),
      APP_MODE: 'dev',                 // dev 模式允许 fallback 用户，避免 401 干扰判断
      STORAGE_DIR: tmpData,
      DATABASE_PATH: testDbPath,
      STATIC_DIR: UI,
      ASSETS_DIR: path.join(NODE_DIR, 'data'),
      TRIM_APPDEST: NODE_DIR,
      TRIM_PKGVAR: tmpData,
      PJ_BACKFILL_DELAY_MS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
}

function waitPort(port, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(tick, 50);
      });
    };
    tick();
  });
}

function dumpDom(url) {
  const profile = path.join(os.tmpdir(), 'pj_edge_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const args = [
    // ⚠️ 必须用旧版 --headless：`--headless=new` 配合 `--dump-dom` 拿回来的是
    //    JS 执行前的原始 DOM（页面还停在加载骨架），会得出"全部页面未挂载"的假结论。
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--window-size=420,900',
    '--virtual-time-budget=9000',   // 给动态 import + 接口请求留时间
    `--user-data-dir=${profile}`,
    '--dump-dom',
    url,
  ];
  try {
    const out = execFileSync(EDGE, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    return out;
  } catch (e) {
    return e.stdout ? String(e.stdout) : '';
  } finally {
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* 忽略 */ }
  }
}

(async () => {
  if (!fs.existsSync(EDGE)) {
    console.log(`⚠️ 找不到 Edge（${EDGE}），跳过真实渲染验证`);
    process.exit(0);
  }

  const seeded = await seedTestData(testDbPath);
  console.log(seeded ? '已放入测试孕期档案（让页面走完整的渲染分支）' : '未放入测试档案');

  startServer();
  const up = await waitPort(PORT);
  if (!up) {
    console.log('❌ 后端没起来，无法验证');
    child.kill('SIGKILL');
    process.exit(1);
  }
  console.log(`后端就绪，开始逐个渲染 ${ROUTES.length} 个页面（每页约 3~6 秒）\n`);

  const failures = [];

  for (const [route, name] of ROUTES) {
    const url = `http://127.0.0.1:${PORT}${PREFIX}/#${route}`;
    const dom = dumpDom(url);

    const crashed = /app-error-boundary|这个页面出错了/.test(dom);
    // ⚠️ 只认元素本身（id="boot-splash"）。文案里那个 #boot-splash 是**内联 CSS 的选择器**，
    //    拿它判断会永远命中（样式表一直在），把正常的页面误判成"未挂载"。
    const notMounted = /id="boot-splash"/.test(dom);
    const empty = !dom || dom.length < 200;

    if (crashed) {
      // 尽量把错误摘要抠出来，方便定位
      const m = dom.match(/app-error-desc[^>]*>([^<]{0,160})/);
      failures.push({ name, route, why: '渲染崩溃（被错误边界接住）', detail: m ? m[1].trim() : '' });
      console.log(`  ❌ ${name.padEnd(6)} ${route}  ← 渲染崩溃`);
    } else if (notMounted) {
      failures.push({ name, route, why: 'Vue 未挂载成功（加载骨架还在）', detail: '' });
      console.log(`  ❌ ${name.padEnd(6)} ${route}  ← 未挂载`);
    } else if (empty) {
      failures.push({ name, route, why: '拿不到 DOM', detail: '' });
      console.log(`  ❌ ${name.padEnd(6)} ${route}  ← 无输出`);
    } else {
      console.log(`  ✅ ${name.padEnd(6)} ${route}`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  if (failures.length === 0) {
    console.log(`结果：${ROUTES.length} 个页面全部渲染正常`);
  } else {
    console.log(`结果：${ROUTES.length - failures.length} 正常 / ${failures.length} 有问题\n`);
    for (const f of failures) {
      console.log(`  ${f.name} (${f.route}): ${f.why}`);
      if (f.detail) console.log(`      ${f.detail}`);
    }
  }
  console.log('='.repeat(50));

  child.kill('SIGKILL');
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures.length ? 1 : 0);
})();
