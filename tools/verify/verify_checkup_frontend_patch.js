/**
 * 验证前端「其他报告」兜底补丁 —— 直接执行 .vue 里的真实函数源码 + 真实排期数据。
 * （不是 grep，而是把 getUncategorizedReports / subItemName 抽出来在 node 里跑）
 *
 * 另含两处静态断言：
 *   S1 排期拉取 getCheckupSchedule(pid) 必须在 if (pid) 之外
 *   S2 前端产物（app/ui/assets/CheckupScheduleView-*.js）必须比 .vue 源码新（证明改完有重新构建）
 */
const fs = require('fs');
const path = require('path');
const { buildFunctions } = require('./_vue_extract');

const ROOT = require('./_env').REPO;
const VUE = path.join(ROOT, 'frontend/src/views/CheckupScheduleView.vue');
const src = fs.readFileSync(VUE, 'utf-8');

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

let getItemReportsImpl = () => [];
// 传"转发器"而不是当前值：getItemReportsImpl 会在各用例间被重新赋值
const built = buildFunctions(VUE, ['subItemName', 'getUncategorizedReports'], {
  getItemReports: (item) => getItemReportsImpl(item),
}, ['getUncategorizedReports']);
check('能从 .vue 抽出 getUncategorizedReports / subItemName', built.ok,
  built.ok ? 'ok' : `缺失=[${built.missing}] err=${built.error && built.error.message}`);
check('抽出后可在 node 中执行（无 TS 残留）',
  built.ok && typeof built.api.getUncategorizedReports === 'function', 'ok');

if (built.ok) {
  // 真实排期数据
  const schedule = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/server/node/data/checkup_schedule.json'), 'utf-8'));
  const cs005 = schedule.find(i => i.id === 'cs_005');
  const cs005Names = (cs005.items || []).map(x => (typeof x === 'string' ? x : x.name));
  const api = built.api;

  const RETIRED = 'GBS(B族链球菌)筛查(新指南推荐提前至24-28周)';
  const cases = [
    {
      name: 'C1 已下架子项名的报告 → 必须被兜底收进「其他报告」',
      item: { _key: 'std_cs_005', items: cs005.items },
      reports: [{ id: 'r1', sub_item: RETIRED }],
      expectIds: ['r1'],
    },
    {
      name: 'C2 名字改过的报告（归一时漏网）→ 也应被兜底收进',
      item: { _key: 'std_cs_009', items: schedule.find(i => i.id === 'cs_009').items },
      reports: [{ id: 'r2', sub_item: 'GBS筛查(如24-28周未做则补做)(阴道拭子)' }],
      expectIds: ['r2'],
    },
    {
      name: 'C3 无 sub_item 的报告 → 仍进「其他报告」（老行为不变）',
      item: { _key: 'std_cs_005', items: cs005.items },
      reports: [{ id: 'r3', sub_item: null }],
      expectIds: ['r3'],
    },
    {
      name: 'C4 名字对得上的报告 → 必须【不】进「其他报告」（否则会重复显示）',
      item: { _key: 'std_cs_005', items: cs005.items },
      reports: [{ id: 'r4', sub_item: cs005Names[0] }],
      expectIds: [],
    },
    {
      name: 'C5 混合场景 → 只挑出未匹配的',
      item: { _key: 'std_cs_005', items: cs005.items },
      reports: [
        { id: 'r5', sub_item: cs005Names[0] },
        { id: 'r6', sub_item: RETIRED },
        { id: 'r7', sub_item: null },
      ],
      expectIds: ['r6', 'r7'],
    },
  ];

  for (const c of cases) {
    getItemReportsImpl = () => c.reports;
    const got = api.getUncategorizedReports(c.item).map(r => r.id).sort();
    const want = c.expectIds.slice().sort();
    check(c.name, JSON.stringify(got) === JSON.stringify(want), `期望=[${want}] 实际=[${got}]`);
  }

  // 对照：旧口径会漏掉 C1/C2
  const oldImpl = () => [{ id: 'r1', sub_item: RETIRED }];
  const oldLen = oldImpl().filter(r => !r.sub_item).length;
  check('C6 对照：旧口径确实收不到该报告（证明本次修补有意义）', oldLen === 0, `旧口径命中数=${oldLen}`);
}

// ---------- S1 排期拉取必须在 if (pid) 之外 ----------
{
  const iFetch = src.indexOf('await getCheckupSchedule(pid)');
  const iPid = src.indexOf('if (pid) {', src.indexOf('async function loadAll'));
  check('S1 排期拉取位于 if (pid) 之外（无孕期也能看到排期）',
    iFetch > 0 && iPid > 0 && iFetch < iPid,
    `getCheckupSchedule@${iFetch} < if(pid)@${iPid}`);
}

// ---------- S3 卡片里的「预计日期」不能又变回两处 ----------
{
  // 模板里每张卡片只允许有一处 expected-date-tag。
  // 原来 .card-left / .card-right 各有一个（完全重复），移动端白占一整行，已按用户要求删掉其中一个。
  const tplEnd = src.indexOf('<style scoped>');
  const tpl = tplEnd > 0 ? src.slice(0, tplEnd) : src;
  const occur = (tpl.match(/class="expected-date-tag"/g) || []).length;
  check('S3 模板里「预计日期」标签只有一处（不再重复显示）', occur === 1, `出现 ${occur} 次`);
}

// ---------- S4 已完成卡片必须有「取消完成」入口（误按「标记完成」的兜底） ----------
{
  const hasBtn = /@click="cancelComplete\(item\)"/.test(src) && /取消完成/.test(src);
  const fnIdx = src.indexOf('async function cancelComplete');
  const callsUnmark = fnIdx > 0 && src.indexOf('unmarkCheckupCompleted', fnIdx) > fnIdx;
  const callsCustom = fnIdx > 0 && src.indexOf('unmarkCustomComplete', fnIdx) > fnIdx;
  check('S4 已完成卡片有「取消完成」按钮，且标准/自定义两条路都接到了取消接口',
    hasBtn && fnIdx > 0 && callsUnmark && callsCustom,
    `按钮=${hasBtn} 函数@${fnIdx} 标准接口=${callsUnmark} 自定义接口=${callsCustom}`);
}

// ---------- S2 前端产物必须比源码新 ----------
{
  // 默认查共享的 app/ui；多会话并行时可用 PJ_UI_DIR 指向验证用的临时构建产物，
  // 避免为了跑这个断言去覆盖 app/ui。
  const assetsDir = path.join(process.env.PJ_UI_DIR || path.join(ROOT, 'app/ui'), 'assets');
  const chunks = fs.readdirSync(assetsDir).filter(f => /^CheckupScheduleView-.*\.js$/.test(f));
  const vueM = fs.statSync(VUE).mtimeMs;
  const newest = chunks
    .map(f => ({ f, m: fs.statSync(path.join(assetsDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0];
  check('S2 前端产物已重新构建（产物比 .vue 新）',
    !!newest && newest.m >= vueM,
    newest ? `${newest.f} mtime-${Math.round((newest.m - vueM) / 1000)}s` : '未找到产物');
}

const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
console.log('\n================ 结果 ================');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  || ${r.detail}`);
console.log(`\n通过 ${pass} / ${results.length}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
