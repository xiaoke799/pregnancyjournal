// 全量回归运行器：顺序跑所有套件，抽取「N 通过 / M 失败」，最后汇总。
// 用法：node tools/verify/run_all_suites.js [--only=kw]
//   --only=关键字   只跑路径或中文名含该关键字的套件（例：--only=推送）
//   产物：tools/verify/regress-out/<套件名>.log，控制台打印逐套结论与总计。
//
// ⚠️ 本机必须用**异步 spawn**：沙箱下 spawnSync(任意 exe) 恒 EBUSY。
// ⚠️ 只收「能打出 N 通过 / M 失败 汇总行」的套件；诊断型探针（只打对照表）不收，
//    否则只会得到 NO-SUMMARY 噪声。诊断型探针见 tools/verify/README.md。
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const ENV_ONLY = require('./_env');
const REPO = ENV_ONLY.REPO;
const V = ENV_ONLY.VERIFY_DIR;
const UP = V;                                   // 两个来源目录已合并到 tools/verify/
const WECOM = path.join(V, 'wecom');
const OUT = path.join(V, 'regress-out');
const NODE = ENV_ONLY.NODE;
const SERVER_DIR = ENV_ONLY.SERVER_DIR;
const NODE_PATH = ENV_ONLY.NODE_MODULES;

fs.mkdirSync(OUT, { recursive: true });

// [脚本路径, 中文名, 备注]
const SUITES = [
  // ---- 推送（企业微信 / 企微调度器 / 飞书 / 钉钉 / Bark）----
  // ⚠️ 分组注释**不写套数**：这类写死的数字已漂过多次（「推送 4 套」实际 5、
  //    README「56 套」实际 57）。要数量请看运行器末尾的汇总，别在这里抄。
  [path.join(WECOM, 'test_wecom_push.js'), '企业微信推送', ''],
  [path.join(WECOM, 'test_wecom_scheduler.js'), '企微调度器', ''],
  [path.join(WECOM, 'test_feishu_push.js'), '飞书推送', ''],
  [path.join(WECOM, 'test_dingtalk_push.js'), '钉钉推送', ''],
  [path.join(WECOM, 'test_bark_push.js'), 'Bark推送', ''],
  // e2e_push_real_server 不自包含（要外部先起 smoke 服务），单独在最后手跑
  // ---- 导出 / 兼容 / 媒体 ----
  [path.join(UP, 'e2e_export_dir.js'), '导出到指定目录', ''],
  [path.join(UP, 'e2e_restore_dirs.js'), '恢复目录分流', '约 95 秒'],
  [path.join(UP, 'e2e_checkup_migration.js'), '产检老用户迁移', ''],
  [path.join(UP, 'verify_checkup_frontend_patch.js'), '产检前端补丁', 'S2 已知常红'],
  [path.join(UP, 'verify_checkup_sorting.js'), '产检列表排序', ''],
  [path.join(UP, 'e2e_backup_field_coverage.js'), '备份字段覆盖', ''],
  [path.join(UP, 'verify_backup_schema_coverage.js'), '备份表结构覆盖核对', ''],
  [path.join(UP, 'e2e_backup_all_fields.js'), '备份全字段往返', ''],
  [path.join(UP, 'e2e_restore_db_file.js'), '整库恢复', '约 31 秒'],
  [path.join(UP, 'verify_record_entrypoints.js'), '记录类入口', ''],
  [path.join(UP, 'verify_record_page_functions.js'), '记录页全功能', ''],
  [path.join(UP, 'shot_record_quickmodals.js'), '快捷小弹窗风格一致', '约 60 秒·需无头浏览器'],
  [path.join(UP, 'shot_fetal_movement_click.js'), '胎动/宫缩计时点击', '约 90 秒·需无头浏览器'],
  [path.join(UP, 'shot_contraction_view_error.js'), '宫缩六场景不崩溃', '约 150 秒·需无头浏览器'],
  [path.join(UP, 'shot_all_pages_fuzz.js'), '全页面点击不崩溃', '约 200 秒·需无头浏览器'],
  [path.join(UP, 'shot_record_all_types_e2e.js'), '记录页全类型模拟', '约 120 秒·需无头浏览器'],
  [path.join(UP, 'shot_plan_flow.js'), '计划全流程（今日/孕期/推送）', '约 120 秒·需无头浏览器'],
  [path.join(UP, 'e2e_video_backup.js'), '相册视频备份', ''],
  [path.join(UP, 'e2e_push_config_backup.js'), '推送配置进备份', '约 40 秒'],
  [path.join(UP, 'e2e_export_mobile.js'), '导出手机端', ''],
  [path.join(UP, 'e2e_heic.js'), 'HEIC 转换链路', ''],
  [path.join(UP, 'e2e_media_backfill.js'), '媒体补齐', ''],
  [path.join(UP, 'test_image_thumb.js'), '缩略图生成', ''],
  [path.join(UP, 'e2e_migrate_27_29.js'), '27→29 升级迁移', ''],
  [path.join(UP, 'e2e_album_pdf.js'), '相册 PDF', ''],
  [path.join(UP, 'e2e_diary_image.js'), '日记插图', ''],
  [path.join(UP, 'e2e_checkup_upload.js'), '产检报告上传', ''],
  // ---- 契约 / 探针 ----
  [path.join(UP, 'verify_navbar_highlight.js'), '导航高亮', ''],
  [path.join(UP, 'verify_push_log_limit.js'), '推送记录限量', ''],
  [path.join(UP, 'probe_cancel_still_completed.js'), '取消完成三场景', ''],
  [path.join(UP, 'verify_upload_field_names.js'), '上传字段名契约', ''],
  [path.join(UP, 'e2e_diary_image_upload.js'), '日记插图上传契约', ''],
  [path.join(UP, 'probe_dashboard_checkup.js'), '首页最近产检', ''],
  // ---- 2026-09-28 新增 ----
  [path.join(UP, 'verify_boot_perf.js'), '首屏性能', ''],
  // ---- 2026-09-29 新增：用药/补充 医嘱计划 + 打卡 + 到点提醒 ----
  // ⚠️ rules 那套是**纯函数**（不起服务），跑得快，专防「静默错判该不该吃」；
  //    它自带 TZ=Asia/Shanghai（UTC→本地 换算的缺陷只有在非 UTC 时区才暴露）。
  [path.join(UP, 'verify_dose_rules.js'), '用药/补充判定规则', '纯函数'],
  [path.join(UP, 'verify_dose_plan.js'), '用药/补充计划与打卡', '真后端'],
  [path.join(UP, 'verify_dose_push.js'), '用药/补充到点提醒', ''],
  // ---- 2026-09-30 新增：发布前升级闸门 ----
  // 用线上 v0.0.27 的真实库结构造老库、灌老数据，再跑当前代码的迁移。
  // ⚠️ 含 31 秒落盘等待；并会顺带复现「D1 业务写入不落盘」（只打印、不判红）。
  [path.join(UP, 'e2e_upgrade_from_0027.js'), '线上老库升级闸门', '约 45 秒'],
  [path.join(UP, 'verify_api_contracts.js'), '前后端路由契约', ''],
  [path.join(UP, 'verify_ui_orphans.js'), 'UI产物孤儿', ''],
  // ---- 2026-09-30 新增：发版版本号同步（manifest 之外的 3 处）----
  // 发版要同步 8 处，其中 5 处由 build.ps1 Step1 强制；剩下 3 处（frontend/server 的
  // package.json + package-lock 的**两处**自指版本）此前「无人管」、只能靠人记。
  // ⚠️ 自带**反例自检**（改错版本 / 截断 JSON / 删掉 lock 的 packages[""] 三种都要变红），
  //    防止这套断言变成恒绿的假护栏。同一份判定也被 build.ps1 Step1 调用（fail-closed）。
  [path.join(UP, 'verify_pkg_versions.js'), '发版版本号同步(package.json/lock)', ''],
  // ---- 2026-09-30 新增：前端类型体检 ----
  // 把 `vue-tsc --noEmit` 收进回归。此前仓库常驻 15 个类型错误（client.ts 没暴露
  // 「解包后」的调用签名），噪音大到真错误没人看；清零后必须有套件守住，否则会悄悄攒回来。
  // ⚠️ 需要 frontend/node_modules（vue-tsc 在 devDependencies）；缺了它按**失败**处理，
  //    不报"通过"（fail-closed：工具链缺失 ≠ 类型没问题）。
  [path.join(UP, 'verify_frontend_types.js'), '前端类型体检(vue-tsc)', '约 15 秒'],
  // ---- 2026-10-01 新增：深色模式接线 ----
  // 历史上深色是「半成品」：store 有 currentTheme、CSS 有 html.dark，但都没接到 DOM（页面恒亮色）。
  // 这种退化构建不报错、测试不红，只能靠肉眼看 ⇒ 静态钉死接线（含反例自检）。
  [path.join(UP, 'verify_dark_mode.js'), '深色模式接线(theme/html.dark/图表配色)', ''],
  // ---- 2026-09-30 新增：胎动/宫缩 会话 ↔ 记录页 ↔ 统计 联动 ----
  // 用户口径：「首页能记录，记录页要全部记录，统计里只统计今天最高的一个值做曲线」。
  // ⚠️ 这套是**真后端**（不起浏览器）：验写回口径、单位换算（秒/分差 60 倍）、
  //    「空会话不得把用户手填值清零」、统计「每天取次数最高的那一次」。
  [path.join(UP, 'e2e_session_rollup.js'), '胎动/宫缩会话写回与统计口径', ''],
  // 前端那一半：卡片上到底有没有数字、点「记一笔」弹的是不是那个专属小弹窗、
  // 记录页同一天多次会话是否**一条一行**都列出来、统计页口径说明与取最高值。
  // ⚠️ 依赖 app/ui 已构建（先 `npm run build`），否则只会看到空壳页面。
  [path.join(UP, 'shot_dashboard_session_link.js'), '首页/记录页/统计 联动渲染', '约 90 秒·需无头浏览器'],
  // 记录页点「胎动 / 宫缩」条目的**去向**：条目上「有没有数据」读 daily_record 的汇总列
  //（手填也写这里），而「每次明细」读 *_session 表（只有计数器 / 计时器才写）——两者会不一致。
  // 只手填、零会话的日子若一律跳明细弹窗，用户看到空框且**再也点不开编辑表单**（数据看得见、改不了）。
  // 本套用三个日期钉住三条去处：只手填→编辑 / 有会话→明细（行数≥1）/ 只有空会话→记录小弹窗。
  [path.join(UP, 'probe_session_row_handfill.js'), '胎动宫缩条目点击去向(手填/会话/空会话)', '约 15 秒·需无头浏览器'],
  // 首页「今日记录」板块 ↔ 记录页的**覆盖率**：只记了饮水/运动/备注、或只用过一次胎动计数器时，
  // 板块以前会渲染成一块 0px 的**空盒子**（头部写着「查看详情 →」、正文什么都没有，连空态都被
  // v-else 挡掉）；另外首页「查看详情 →」带的 `?date=` 曾被记录页**静默忽略**（RecordView 不读 route.query）。
  // ⚠️ 这套是**真后端 + 无头浏览器**，5 个场景各起一次浏览器 + 2 次记录页取证 ⇒ 约 2 分钟。
  [path.join(UP, 'probe_dashboard_record_coverage.js'), '首页↔记录页 覆盖与 ?date= 采纳', '约 120 秒·需无头浏览器'],
  // 首页「计时中…」标志的**日期归属**：进一次计时器页面（onMounted 立刻建会话）却没点
  // 「结束计时」，这条会话 end_time 永远是 NULL；本应用没有恢复旧会话的入口（每次进来都新建），
  // 所以只按 pregnancy_id 找未结束会话 ⇒ 一次中途退出就让首页宫缩卡**永久**显示「计时中…」，
  // 而 contractionStatText 在该分支直接 return，把「今日 N 次 · 持续 X 秒」整个盖掉、无法自愈。
  // 三个场景：昨天遗留空壳会话（必须 false）/ 今天确实在计时（true）/ 结束后回落（false）。
  [path.join(UP, 'probe_contraction_active_stale.js'), '首页「计时中」只认今天(陈旧会话不卡住)', ''],
  // 首页时间轴「血压/血糖偏高」的**边界值**：临床阈值一律是「≥」（140/90、空腹 5.1、餐后2h 6.7），
  // 而记录列表 RecordList.vue 也是 `>=140 || >=90`、空腹 `<5.1` 才算正常。
  // dashboard.js 原先写 `>` ⇒ 恰好压线时出现「记录列表标红、首页时间轴一声不响」的两处打架。
  // 场景 A 压线必报（5 项）/ B 低一档必不报（4 项，反例）/ C 明显偏高仍报（1 项）。
  [path.join(UP, 'probe_alert_threshold.js'), '首页告警阈值含边界(压线不漏报)', ''],
  // ---- 模板 / 渲染 / 可读性 ----
  // ⚠️ 这三套此前**一直没进 runner**：记忆里写着「新增路由必须同步 verify_render.js」
  //    「改模板跑 verify_render.js」，但没人跑 ⇒ 约定形同虚设，脚本在旁边烂掉也不知道。
  //    verify_render / verify_template_vars 不打「N 通过 / M 失败」汇总行（只打结论行），
  //    在汇总表里会显示 NO-SUMMARY；但它们**失败时 exit 1**（verdict=EXIT1 会计入红灯），
  //    所以仍然有牙，只是不贡献项数。
  [path.join(UP, 'verify_render.js'), '15 页渲染(改模板必跑)', ''],
  [path.join(UP, 'verify_template_vars.js'), '模板变量引用(防 Undefined)', ''],
  [path.join(UP, 'verify_readability.js'), '文案可读性', ''],
  // 推送数据源四表的改动影响面（记忆：动 pregnancy/schedule_dates/custom_checkup/reminder 前必跑）
  [path.join(UP, 'probe_push_schedule_impact.js'), '推送排期数据源影响面', ''],
  // 铁律 #28：saveDb()(同步) 与 saveDbAsync() 不可混 —— 异步落盘不能把内存快照盖回去
  [path.join(UP, 'probe_async_save_race.js'), '异步落盘不盖回旧快照', ''],
  // ---- 路径安全 ----
  [path.join(UP, 'verify_path_traversal.js'), '路径穿越', ''],
  [path.join(UP, 'verify_path_guard.js'), '路径锚定与白名单', '上线前检查修复回归'],
  [path.join(UP, 'verify_db_persist.js'), '落盘验证', ''],
  // ====================================================================
  // 2026-09-28 v0.0.31 十九项修复的专用探针（t9 / t11–t18）。
  // ⚠️ 这一段此前**漏收**过：探针写好了、人肉跑过，但没进 runner ⇒ 下轮改动时
  //    这些修复没有任何回归护栏。补进来的口径是「能打出 `N 通过 / M 失败` 汇总行」；
  //    t1–t8/t10（t1_sqljs_semantics、t2/t4/t5/t7/t8、t10_probe_choice）是**诊断型**探针，
  //    只打印对照表、没有断言与汇总行，收进来只会得到 NO-SUMMARY 的噪声，故有意不收。
  // t17 必须用异步 spawn（本机 spawnSync 恒 EBUSY），已在脚本内改好。
  // ====================================================================
  [path.join(V, 't9_verify_db_fixes.js'), 'DB修复综合(外键/索引/损坏库)', ''],
  [path.join(V, 't11_contraction_511.js'), '宫缩5-1-1(含跨午夜/历史)', ''],
  [path.join(V, 't12_reference_photo.js'), '照片目录校验（reference 部分已随接口下线移除）', ''],
  [path.join(V, 't13_error_sanitize.js'), '错误脱敏(含URL不误伤)', ''],
  [path.join(V, 't14_access_control.js'), '访问控制(日志/导出鉴权)', ''],
  [path.join(V, 'verify_admin_gate.js'), 'B2 管理操作限管理员(破坏性操作闸门)', ''],
  [path.join(V, 't15_crash_flush.js'), '崩溃/退出前补落盘', ''],
  [path.join(V, 't16_storage_migrate.js'), '存储迁移不落假标记', ''],
  [path.join(V, 't17_index_cgi_body.js'), 'CGI 请求体转发', ''],
  [path.join(V, 't18_fk_schema_fix.js'), '错误外键重建(逐字校验)', ''],
];

const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;

const RE_SUM = /(?:合计|总计|结果)[:：]?\s*(\d+)\s*(?:通过)?\s*[/／]\s*(\d+)\s*(?:通过|失败)?/;
const RE_SUM2 = /(\d+)\s*通过\s*[/／]\s*(\d+)\s*失败/;
const RE_SUM3 = /总计\s*(\d+)\s*[/／]\s*(\d+)\s*通过/;
// 「通过 19 / 24，失败 5」这种把「通过」放前面的写法
const RE_SUM4 = /通过\s*(\d+)\s*[/／]\s*(\d+)\s*[，,]\s*失败\s*(\d+)/;

function parseSummary(out) {
  const lines = out.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    let m = RE_SUM4.exec(l);
    if (m) return { pass: Number(m[1]), total: Number(m[2]), fail: Number(m[3]), line: l.trim() };
    m = RE_SUM2.exec(l);
    if (m) return { pass: Number(m[1]), fail: Number(m[2]), line: l.trim() };
    m = RE_SUM3.exec(l);
    if (m) return { pass: Number(m[1]), total: Number(m[2]), fail: Number(m[2]) - Number(m[1]), line: l.trim() };
  }
  // 兜底：按 [OK]/[FAIL] 或行首 PASS/FAIL 计数（有些套件不打汇总行）
  let okN = 0, failN = 0;
  for (const l of lines) {
    if (/^\s*\[OK\]|^\s*PASS\b/.test(l)) okN++;
    else if (/^\s*\[FAIL\]|^\s*FAIL\b/.test(l)) failN++;
  }
  if (okN + failN > 0) return { pass: okN, fail: failN, line: `(按逐项统计) ${okN} 通过 / ${failN} 失败` };
  return null;
}

const results = [];
// ⚠️ 本机沙箱下 `spawnSync(<node.exe>)` 一律返回 EBUSY（子进程创建被 broker 拦），
//    但**异步 spawn** 是好的。所以这里全部用异步 spawn + Promise 包一层。
function runChild(script, timeoutMs) {
  return new Promise((resolve) => {
    const env = { ...process.env, NODE_PATH, PJ_UI_DIR: process.env.PJ_UI_DIR || ENV_ONLY.UI_DIR };
    delete env.NODE_OPTIONS;
    const child = spawn(NODE, [script], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch (e) { } }, timeoutMs);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => out += d);
    child.on('error', e => { clearTimeout(timer); resolve({ out: out + '\n[spawn error] ' + e.message, status: null, spawnError: e.message, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ out, status: code, timedOut }); });
  });
}

async function runOne(script, name, note) {
  const base = path.basename(script, '.js');
  const outFile = path.join(OUT, base + '.log');
  process.stdout.write(`\n>>> ${name} (${base}) ${note ? '[' + note + ']' : ''} ... `);
  const t0 = Date.now();
  const r = await runChild(script, 300000);
  const secs = Math.round((Date.now() - t0) / 1000);
  const out = r.out || '';
  fs.writeFileSync(outFile, out);
  const sum = parseSummary(out);
  const status = r.status;
  let verdict;
  if (r.timedOut) verdict = 'TIMEOUT';
  else if (r.spawnError) verdict = 'SPAWNERR';
  else if (!sum) verdict = status === 0 ? 'NO-SUMMARY' : `EXIT${status}`;
  else verdict = sum.fail === 0 ? 'PASS' : `FAIL(${sum.fail})`;
  results.push({ name, base, verdict, sum, secs, status, outFile, note });
  console.log(`${verdict}  ${secs}s  ${sum ? sum.line : '(未识别到汇总行)'}`);
  if (r.spawnError) console.log('     spawn error: ' + r.spawnError);
  // 套件直接崩了（没汇总行 + 非 0 退出 / 超时）：必须把报错首几行打出来。
  // 只看到一个 EXIT1 是查不出原因的 —— 2026-09-29 迁目录时就因此踩过
  // （wecom 子目录里 require('./_env') 层级写错，3 套静默崩溃）。
  if (verdict === 'SPAWNERR' || verdict === 'TIMEOUT' || verdict.startsWith('EXIT')) {
    out.split('\n').filter(l => l.trim()).slice(0, 6)
      .forEach(l => console.log('     | ' + l.trim().slice(0, 170)));
  }
  if (sum && sum.fail > 0) {
    const bad = out.split('\n').filter(l => /🔴|✗|\[FAIL\]/.test(l)).slice(0, 8);
    bad.forEach(b => console.log('     ' + b.trim().slice(0, 160)));
  }
}

(async () => {
  for (const [script, name, note] of SUITES) {
    if (only && !script.includes(only) && !name.includes(only)) continue;
    if (!fs.existsSync(script)) { console.log(`\n>>> 跳过（文件不存在）: ${script}`); continue; }
    await runOne(script, name, note);
  }

  console.log('\n================ 汇总 ================');
  const pad = (s, n) => String(s).padEnd(n, ' ');
  for (const r of results) {
    console.log(`${pad(r.verdict, 10)} ${pad(r.name, 22)} ${String(r.secs).padStart(4)}s  ${r.sum ? `${r.sum.pass} 通过` : ''}${r.note ? '   # ' + r.note : ''}`);
  }
  const okc = results.filter(r => r.verdict === 'PASS').length;
  const bad = results.filter(r => r.verdict !== 'PASS' && r.verdict !== 'NO-SUMMARY');
  console.log(`\n套件：${okc}/${results.length} 全绿；有红灯的：${bad.length ? bad.map(b => b.name + '(' + b.verdict + ')').join(', ') : '无'}`);
  const totalItems = results.reduce((a, r) => a + (r.sum ? r.sum.pass + r.sum.fail : 0), 0);
  console.log(`项数合计：${totalItems}`);

  // ---- 文档一致性绊线：README 声明的「N 套 / M 项」必须与实际相符 ----
  // 为什么设：这套数字已漂过两次（42/778 → 56/1220 → 57/1266），靠人记必漏，
  //   而 README 是外部读者判断"这套回归有多大"的唯一依据。
  // ⚠️ 只在全量跑时检查：--only 的部分运行数字天然对不上。
  // ⚠️ 套数不一致**计入退出码**；项数不一致只告警（环境缺浏览器时会有套件变 NO-SUMMARY，
  //    那种情况下项数会少，属于环境噪音，不该判死）。
  if (!only) {
    const docs = [path.join(REPO, 'README.md'), path.join(V, 'README.md')];
    const rx = /(\d+)\s*套\s*\/\s*约?\s*(\d+)\s*项/;
    let docBad = 0;
    for (const f of docs) {
      if (!fs.existsSync(f)) continue;
      const m = rx.exec(fs.readFileSync(f, 'utf-8'));
      if (!m) { console.log(`⚠️ 文档声明：${path.relative(REPO, f)} 里找不到「N 套 / M 项」声明行（已跳过）`); continue; }
      const [, suites, items] = m;
      const rel = path.relative(REPO, f);
      if (Number(suites) !== SUITES.length) {
        docBad++;
        console.log(`🔴 文档声明不符：${rel} 写「${suites} 套」，实际 ${SUITES.length} 套 —— 请同步`);
      }
      if (Number(items) !== totalItems) {
        console.log(`⚠️ 文档项数：${rel} 写「${items} 项」，本次实际 ${totalItems} 项（环境差异时可忽略，改过套件请同步）`);
      }
    }
    if (docBad) process.exitCode = 1;
  }
})();
