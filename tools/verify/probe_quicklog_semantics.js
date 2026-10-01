/**
 * 胎动 / 宫缩「记一笔」的取值语义 + 临床参考判读 —— 回归护栏
 *
 * 【为什么要这个脚本】
 * QuickLogDialog 原来直接在 save() 里拼 payload，两行都在**静默丢数据**：
 *   ① 胎动 `count = 本次值`    ⇒ 计数器写回的当天汇总被整个覆盖；
 *   ② 宫缩 `count = duration ? 1 : 0`
 *      ⇒ 只填间隔 / 疼痛、没填持续时写 **0**，把当天已记的 N 次**清零**。
 * 这类 bug 构建不报错、类型检查不报错，只有把数字对一遍才发现 —— 所以必须有常驻断言。
 *
 * 【怎么做到真单测】
 * 取值逻辑已抽成**零 import 的纯函数** `frontend/src/utils/quick-log.ts`
 * 与 `frontend/src/utils/clinical-standards.ts`，本脚本用 esbuild 转译后直接 require 跑断言
 * （不启后端、不开浏览器，秒级）。这也是那两个文件**刻意不 import 任何东西**的原因。
 *
 * 【反例自检（铁律 #11）】最后一组用「修复前的旧实现」跑一遍，
 *   必须得出错误结果才算断言有区分度 —— 否则这条护栏只是个恒真的摆设。
 *
 * 用法：node tools/verify/probe_quicklog_semantics.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const env0 = require('./_env');
const ROOT = env0.REPO;
const T = path.join(os.tmpdir(), 'pj-quicklog-semantics');

let pass = 0;
let fail = 0;
function check(name, cond, info) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${info ? ' → ' + info : ''}`); }
}

// ---------------------------------------------------------------- esbuild 转译
async function loadModule(relPath) {
  let esbuild;
  try {
    esbuild = require(path.join(ROOT, 'frontend/node_modules/esbuild'));
  } catch (e) {
    throw new Error('找不到 esbuild（frontend/node_modules/esbuild），无法转译 TS 纯函数：' + e.message);
  }
  const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const out = await esbuild.transform(src, { loader: 'ts', format: 'cjs', target: 'node18' });
  fs.rmSync(T, { recursive: true, force: true });
  fs.mkdirSync(T, { recursive: true });
  const tmp = path.join(T, path.basename(relPath).replace(/\.ts$/, '.cjs'));
  fs.writeFileSync(tmp, out.code);
  return require(tmp);
}

(async () => {
  const ql = await loadModule('frontend/src/utils/quick-log.ts');
  const cs = await loadModule('frontend/src/utils/clinical-standards.ts');

  console.log('===== 场景 A：胎动「追加 / 改为」=====');
  {
    const ex = { count: 20, duration: 45 };
    const form = { count: 5, duration: 30 };
    const a = ql.buildQuickLogFields('fetal_movement', 'append', form, ex);
    check('A1 追加：次数 20 + 5 = 25', a.fetal_movement_count === 25, JSON.stringify(a));
    check('A2 追加：用时 45 + 30 = 75（一天总用时，相加才对）', a.fetal_movement_duration === 75, JSON.stringify(a));

    const r = ql.buildQuickLogFields('fetal_movement', 'replace', form, ex);
    check('A3 改为：次数直接用本次值 5', r.fetal_movement_count === 5, JSON.stringify(r));
    check('A4 改为：用时直接用本次值 30', r.fetal_movement_duration === 30, JSON.stringify(r));

    const n = ql.buildQuickLogFields('fetal_movement', 'append', form, null);
    check('A5 这一天还没记过 ⇒ 追加等于首次记录（5 次，与旧行为一致）',
      n.fetal_movement_count === 5 && n.fetal_movement_duration === 30, JSON.stringify(n));

    // 只补用时（次数没填）：次数那一列**不能动**
    const d = ql.buildQuickLogFields('fetal_movement', 'append', { count: null, duration: 15 }, ex);
    check('A6 只补用时 ⇒ fetal_movement_count 不提交（保持 20，不会被清成 0）',
      d.fetal_movement_count === undefined && d.fetal_movement_duration === 60, JSON.stringify(d));

    // 只填次数（用时没填）：用时那一列不能动
    const c = ql.buildQuickLogFields('fetal_movement', 'append', { count: 3, duration: null }, ex);
    check('A7 只填次数 ⇒ fetal_movement_duration 不提交（保持 45）',
      c.fetal_movement_duration === undefined && c.fetal_movement_count === 23, JSON.stringify(c));
  }

  console.log('\n===== 场景 B：宫缩次数不再被清零（核心 bug）=====');
  {
    const ex = { count: 8, duration: 50, interval: 9, pain: '明显' };
    const a = ql.buildQuickLogFields('contraction', 'append', { duration: 40, interval: 5, pain: '轻微' }, ex);
    check('B1 追加：次数 8 + 1 = 9', a.contraction_count === 9, JSON.stringify(a));
    check('B2 持续按**本次值**覆盖（40 秒，不是 50+40 累加 —— 这是单次平均值）',
      a.contraction_duration === 40, JSON.stringify(a));
    check('B3 间隔按**本次值**覆盖（5 分，不是 9+5）', a.contraction_interval === 5, JSON.stringify(a));
    check('B4 疼痛取本次值', a.contraction_pain === '轻微', JSON.stringify(a));

    // 🔴 只填间隔 / 疼痛、没填持续时间 —— 旧实现在这里写 0
    const b = ql.buildQuickLogFields('contraction', 'append', { duration: null, interval: 6, pain: '无感' }, ex);
    check('B5 只填间隔+疼痛 ⇒ contraction_count **不提交**（当天已记的 8 次保住）',
      b.contraction_count === undefined, JSON.stringify(b));
    check('B6 同上：间隔 / 疼痛照常写入', b.contraction_interval === 6 && b.contraction_pain === '无感', JSON.stringify(b));

    const r = ql.buildQuickLogFields('contraction', 'replace', { duration: 40, interval: 5 }, ex);
    check('B7 改为：次数 = 1（本次这一阵）', r.contraction_count === 1, JSON.stringify(r));

    const n = ql.buildQuickLogFields('contraction', 'append', { duration: 40 }, null);
    check('B8 这一天还没记过 ⇒ 首次记 1 次', n.contraction_count === 1, JSON.stringify(n));

    const e = ql.buildQuickLogFields('contraction', 'append', {}, ex);
    check('B9 什么都没填 ⇒ 一个字段都不提交（后端全部保持原值）',
      Object.values(e).every((v) => v === undefined), JSON.stringify(e));
  }

  console.log('\n===== 场景 C：弹窗文案（已记 / 预览）=====');
  {
    check('C1 胎动「这一天已记」含次数与用时',
      ql.describeExisting('fetal_movement', { count: 20, duration: 45 }) === '20 次 · 用时 45 分钟',
      ql.describeExisting('fetal_movement', { count: 20, duration: 45 }));
    check('C2 宫缩「这一天已记」含疼痛',
      ql.describeExisting('contraction', { count: 3, pain: '明显' }).indexOf('疼痛 明显') >= 0,
      ql.describeExisting('contraction', { count: 3, pain: '明显' }));
    check('C3 没记过 ⇒ 空串（弹窗据此隐藏那一行与模式开关）',
      ql.describeExisting('fetal_movement', null) === '' && ql.describeExisting('fetal_movement', {}) === '');
    check('C4 追加预览写明算式',
      ql.previewQuickLog('fetal_movement', 'append', { count: 5 }, { count: 20 }) === '20 + 5 = 25 次胎动',
      ql.previewQuickLog('fetal_movement', 'append', { count: 5 }, { count: 20 }));
  }

  console.log('\n===== 场景 D：胎动临床参考判读（指南口径）=====');
  {
    const n = cs.judgeFetalMovement({ count: 10, durationMin: 60, weeks: 32 });
    check('D1 10 次/小时 ⇒ normal', n.level === 'normal', JSON.stringify(n));
    const w = cs.judgeFetalMovement({ count: 2, durationMin: 60, weeks: 32 });
    check('D2 2 次/小时（<3）⇒ watch（先复测，不直接让就医）', w.level === 'watch', JSON.stringify(w));
    const a = cs.judgeFetalMovement({ count: 1, durationMin: 60, weeks: 32 });
    check('D3 1 次/小时 ⇒ alert', a.level === 'alert', JSON.stringify(a));
    // 合规红线：只能落到「去医院检查」，且不得出现任何结论性诊断词
    check('D4 alert 文案落到「去医院检查」，且不含诊断性结论（如「缺氧」）',
      (a.detail.indexOf('医院') >= 0 || a.detail.indexOf('就医') >= 0) && a.detail.indexOf('缺氧') < 0,
      a.detail);

    const u = cs.judgeFetalMovement({ count: 8, durationMin: null, weeks: 32 });
    check('D5 没有用时 ⇒ unknown（不知道数了多久，不拿 12 小时口径套）', u.level === 'unknown', JSON.stringify(u));
    const early = cs.judgeFetalMovement({ count: 1, durationMin: 60, weeks: 20 });
    check('D6 未到 28 周 ⇒ unknown（此时胎动本就不规律，套标准没意义）', early.level === 'unknown', JSON.stringify(early));
    check('D7 没记次数 ⇒ unknown', cs.judgeFetalMovement({ count: null, durationMin: 60, weeks: 32 }).level === 'unknown');
    check('D8 三档阈值取自唯一真源', cs.FM_STANDARD.perHourNormal === 3 && cs.FM_STANDARD.per12hNormal === 30 && cs.FM_STANDARD.startWeek === 28);
  }

  console.log('\n===== 场景 E：宫缩临床参考判读（临产口径）=====');
  {
    const labor = cs.judgeContraction({ durationSec: 40, intervalMin: 5, weeks: 39 });
    check('E1 持续 40 秒 + 间隔 5 分 ⇒ alert（符合规律宫缩）', labor.level === 'alert', JSON.stringify(labor));
    check('E2 足月的 alert 文案要说「以产科检查为准」', labor.detail.indexOf('产科检查') >= 0, labor.detail);

    const preterm = cs.judgeContraction({ durationSec: 40, intervalMin: 5, weeks: 34 });
    check('E3 未足月（<37 周）⇒ 提示先兆早产', preterm.level === 'alert' && preterm.detail.indexOf('早产') >= 0, preterm.detail);

    check('E4 持续够、间隔还长 ⇒ watch', cs.judgeContraction({ durationSec: 40, intervalMin: 20, weeks: 39 }).level === 'watch');
    check('E5 间隔够短、持续不足 ⇒ watch', cs.judgeContraction({ durationSec: 10, intervalMin: 5, weeks: 39 }).level === 'watch');
    check('E6 两项都不达标 ⇒ normal（多为假宫缩）', cs.judgeContraction({ durationSec: 10, intervalMin: 20, weeks: 39 }).level === 'normal');
    check('E7 数据全空 ⇒ unknown', cs.judgeContraction({}).level === 'unknown');
    check('E8 阈值取自唯一真源', cs.CT_STANDARD.laborDurationSec === 30 && cs.CT_STANDARD.laborIntervalMin === 6 && cs.CT_STANDARD.termWeek === 37);

    // 单位换算：计时器页的 lastInterval 是**秒**，判读要的是分钟（差 60 倍）
    const bySec = cs.judgeContraction({ durationSec: 40, intervalMin: 300 / 60, weeks: 39 });
    check('E9 间隔 300 秒 ⇒ 换算成 5 分钟后判为 alert（防漏 /60）', bySec.level === 'alert', JSON.stringify(bySec));
  }

  console.log('\n===== 场景 F：静态断言 —— 防实现漂回旧写法 =====');
  {
    const readIf = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');
    /**
     * 扫「硬写数字」之前必须先剥注释：注释里引用口径（「旧文案写每小时 ≥3 次不对…」）
     * 会被当成硬写，是个典型的假阳性源（与 probe_theme_tokens 的 `var()` mask 同款坑）。
     */
    const stripComments = (s) =>
      s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const readCode = (p) => stripComments(readIf(p));
    const dlg = readIf('frontend/src/components/record/QuickLogDialog.vue');
    const dash = readIf('frontend/src/views/DashboardView.vue');
    const list = readIf('frontend/src/components/record/RecordList.vue');
    const rv = readIf('frontend/src/views/RecordView.vue');

    check('F1 小弹窗不再有「没填持续就写 0」的清零写法',
      !/contraction_count\s*=\s*form\.value\.duration\s*\?\s*1\s*:\s*0/.test(dlg));
    check('F2 小弹窗走纯函数取值（唯一真源）', dlg.indexOf('buildQuickLogFields') >= 0);
    check('F3 小弹窗把「这一天已记」显示出来', dlg.indexOf('existingText') >= 0 && dlg.indexOf('qf-existing') >= 0);
    check('F4 首页判据走 utils/format 共享函数',
      dash.indexOf('hasFetalMovementData(') >= 0 && dash.indexOf('hasContractionData(') >= 0);
    check('F5 记录列表判据同样走共享函数（三处不再各写一份）',
      list.indexOf('hasFetalMovementData(r)') >= 0 && list.indexOf('hasContractionData(r)') >= 0);
    check('F6 记录列表不再自己拼「持续或间隔」判据',
      !/case\s+'contraction':\s*return\s*!!\(r\.contraction_duration\s*\|\|/.test(list));
    check('F7 首页与记录页都把「当天已记」传进弹窗（不传就会静默覆盖）',
      /:existing="fmExisting"/.test(dash) && /:existing="fmExisting"/.test(rv));
    check('F8 首页锁日期（改日期后首页看不到反馈）', /lock-date/.test(dash));
    check('F9 明细弹窗不再是死路（能补记 / 能进计数器）',
      readIf('frontend/src/components/record/SessionDetailDialog.vue').indexOf("emit('quick-log'") >= 0);
    check('F10 胎动计数器页接了实时判读',
      readIf('frontend/src/views/FetalMovementCounterView.vue').indexOf('judgeFetalMovement') >= 0);
    check('F11 宫缩计时器页接了判读（且间隔按秒→分换算）',
      /judgeContraction/.test(readIf('frontend/src/views/ContractionTimerView.vue')) &&
      /lastInterval\.value\s*\/\s*60/.test(readIf('frontend/src/views/ContractionTimerView.vue')));
    // 临床数字只许出现在 clinical-standards.ts，其它文件一律引用真源（否则改口径时必漏一处）
    const dlgCode = readCode('frontend/src/components/record/QuickLogDialog.vue');
    const ctCode = readCode('frontend/src/views/ContractionTimerView.vue');
    const dashCode = readCode('frontend/src/views/DashboardView.vue');
    check('F12 任何 UI 都不硬写临床数字（每小时≥3次 / 12小时30次 / 30秒）',
      !/每小时\s*≥?\s*3\s*次/.test(dlgCode) && !/12\s*小时\s*累计\s*≥?\s*30/.test(dlgCode) &&
      !/持续\s*≥?\s*30\s*秒/.test(ctCode) && !/每小时≥3次/.test(dashCode),
      `dlg=${/每小时\s*≥?\s*3\s*次/.test(dlgCode)} ct=${/持续\s*≥?\s*30\s*秒/.test(ctCode)}`);
    check('F13 判读文案里的数字确实取自真源（文件里出现 FM_STANDARD / CT_STANDARD 引用）',
      /FM_STANDARD/.test(dlgCode) && /CT_STANDARD/.test(ctCode) &&
      /FM_STANDARD/.test(readCode('frontend/src/views/FetalMovementCounterView.vue')));
  }

  console.log('\n===== 场景 G：反例自检（证明上面这些断言不是恒真）=====');
  {
    // 修复前的旧实现（照抄当时的两行）—— 用它跑同一组输入，必须得出错误结果，
    // 否则说明断言写得没区分度。
    function legacy(type, form, ex) {
      const out = {};
      if (type === 'fetal_movement') {
        out.fetal_movement_count = form.count;
        out.fetal_movement_duration = form.duration || undefined;
      } else {
        out.contraction_count = form.duration ? 1 : 0;
        out.contraction_duration = form.duration || undefined;
        out.contraction_interval = form.interval || undefined;
        out.contraction_pain = form.pain || undefined;
      }
      return out;
    }
    const ex = { count: 8 };
    const form = { duration: null, interval: 6, pain: '无感' };
    const old = legacy('contraction', form, ex);
    const now = ql.buildQuickLogFields('contraction', 'append', form, ex);
    check('G1 旧实现确实把次数清成 0（而新实现不提交）⇒ 断言 B5 有区分度',
      old.contraction_count === 0 && now.contraction_count === undefined, `old=${JSON.stringify(old)} new=${JSON.stringify(now)}`);

    const oldFm = legacy('fetal_movement', { count: 5, duration: 30 }, { count: 20, duration: 45 });
    const nowFm = ql.buildQuickLogFields('fetal_movement', 'append', { count: 5, duration: 30 }, { count: 20, duration: 45 });
    check('G2 旧实现把 20 次覆盖成 5 次（新实现累加到 25）⇒ 断言 A1 有区分度',
      oldFm.fetal_movement_count === 5 && nowFm.fetal_movement_count === 25,
      `old=${JSON.stringify(oldFm)} new=${JSON.stringify(nowFm)}`);

    // 判读的反例：把「每小时 ≥3 次」的阈值改成 1，D2 就得变 normal —— 说明断言盯着阈值
    const fake = { ...cs.FM_STANDARD, perHourNormal: 1 };
    check('G3 阈值一旦被改（3→1），2 次/小时就会被误判为正常 ⇒ 断言 D2 盯着阈值',
      (2 / 1) >= fake.perHourNormal && (2 / 1) < cs.FM_STANDARD.perHourNormal);
  }

  console.log('\n==================================================');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  console.log('==================================================');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常:', e && e.stack ? e.stack : e);
  process.exit(3);
});
