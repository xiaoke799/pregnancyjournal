/**
 * 探针：改动（产检排期 id 重编号）对【推送】有没有影响？
 *
 * 手法：模拟「老用户已经填过实际产检日期」——schedule_dates 里存的是【旧 id】，
 *       然后调用推送引擎的 buildDailyBoardText，看推送正文里显示的是哪个产检名字。
 *       用【新 json】与【旧 json】各跑一次，做同口径对照。
 *
 * 用法：node probe_push_schedule_impact.js new|old
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP = require('./_env').SERVER_DIR;
const WHICH = process.argv[2] === 'old' ? 'old' : 'new';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pj-pushimpact-'));
const STORAGE = path.join(TMP, 'storage');
const ASSETS = path.join(TMP, 'assets');
fs.mkdirSync(STORAGE, { recursive: true });
fs.mkdirSync(ASSETS, { recursive: true });

// 选一份排期 json 放进 ASSETS_DIR（推送引擎就是从这里读的）
// ⚠️ 本机 Node 里 spawn('git') 会被策略挡（EBUSY），所以「取改前的 json」交给 bash 预先做：
//    git show HEAD:app/server/node/data/checkup_schedule.json > tools/verify/.tmp/_old_sched.json
//    再跑：node probe_push_schedule_impact.js old [该文件路径]
let src;
if (WHICH === 'old') {
  src = process.argv[3] || path.join(require('./_env').TMP, '_old_sched.json');
  if (!fs.existsSync(src)) {
    console.error('找不到「改前的随包 json」：' + src +
      '\n请先执行：git show HEAD:app/server/node/data/checkup_schedule.json > tools/verify/.tmp/_old_sched.json');
    process.exit(1);
  }
} else {
  src = path.join(APP, 'data', 'checkup_schedule.json');
}
fs.copyFileSync(src, path.join(ASSETS, 'checkup_schedule.json'));

process.env.STORAGE_DIR = STORAGE;
process.env.DATA_DIR = STORAGE;
process.env.ASSETS_DIR = ASSETS;
process.env.DATABASE_PATH = path.join(STORAGE, 'pregnancy-journal.db');
process.env.APP_MODE = 'dev';
process.env.LOG_DIR = path.join(STORAGE, 'logs');

const db = require(path.join(APP, 'db.js'));
const engine = require(path.join(APP, 'services', 'push-engine.js'));

const dstr = (off) => {
  const d = new Date(); d.setDate(d.getDate() + off);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// 老用户已经填过的实际产检日期 —— 注意用的全是【旧 id】
const OLD_ROWS = [
  ['cs_001', -1],   // 旧含义：早孕检查
  ['cs_004', 1],    // 旧含义：中期唐筛/无创DNA
  ['cs_005', 2],    // 旧含义：大排畸（系统B超）
  ['cs_010', 3],    // 旧含义：B族链球菌筛查
  ['cs_016', 4],    // 旧含义：过期妊娠处理（新版已无 cs_016）
];

(async () => {
  await db.initDb();
  const pid = 'probe-preg';
  db.run('INSERT INTO pregnancy (id,last_period_date,due_date,is_active) VALUES (?,?,?,1)',
    [pid, dstr(-140), dstr(140)]);
  for (const [sid, off] of OLD_ROWS) {
    db.run('INSERT INTO schedule_dates (pregnancy_id,schedule_id,checkup_date) VALUES (?,?,?)',
      [pid, sid, dstr(off)]);
  }
  db.saveDb();

  const text = engine.buildDailyBoardText(pid, { push_daily: true, push_checkup: true, push_reminder: true });

  console.log('================ 使用【' + WHICH + ' json】时，推送正文 ================');
  console.log(text);
  console.log('======================================================================');

  // 抽取出与产检有关的行，方便比对
  const lines = text.split('\n').filter(l => /【产检】|🩺/.test(l));
  console.log('→ 产检相关行（用户会看到的）:');
  lines.forEach(l => console.log('   ' + l));

  process.exit(0);
})().catch((e) => { console.error('探针异常:', e); process.exit(1); });
