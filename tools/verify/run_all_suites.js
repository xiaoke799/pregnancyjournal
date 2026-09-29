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
  // ---- 推送 4 套 ----
  [path.join(WECOM, 'test_wecom_push.js'), '企业微信推送', ''],
  [path.join(WECOM, 'test_wecom_scheduler.js'), '企微调度器', ''],
  [path.join(WECOM, 'test_feishu_push.js'), '飞书推送', ''],
  // e2e_push_real_server 不自包含（要外部先起 smoke 服务），单独在最后手跑
  // ---- 导出 / 兼容 / 媒体 18 套 ----
  [path.join(UP, 'e2e_export_dir.js'), '导出到指定目录', ''],
  [path.join(UP, 'e2e_restore_dirs.js'), '恢复目录分流', '约 95 秒'],
  [path.join(UP, 'e2e_checkup_migration.js'), '产检老用户迁移', ''],
  [path.join(UP, 'verify_checkup_frontend_patch.js'), '产检前端补丁', 'S2 已知常红'],
  [path.join(UP, 'verify_checkup_sorting.js'), '产检列表排序', ''],
  [path.join(UP, 'e2e_backup_field_coverage.js'), '备份字段覆盖', ''],
  [path.join(UP, 'e2e_restore_db_file.js'), '整库恢复', '约 31 秒'],
  [path.join(UP, 'verify_record_entrypoints.js'), '记录类入口', ''],
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
  // ---- 契约 / 探针 6 套 ----
  [path.join(UP, 'verify_navbar_highlight.js'), '导航高亮', ''],
  [path.join(UP, 'verify_push_log_limit.js'), '推送记录限量', ''],
  [path.join(UP, 'probe_cancel_still_completed.js'), '取消完成三场景', ''],
  [path.join(UP, 'verify_upload_field_names.js'), '上传字段名契约', ''],
  [path.join(UP, 'e2e_diary_image_upload.js'), '日记插图上传契约', ''],
  [path.join(UP, 'probe_dashboard_checkup.js'), '首页最近产检', ''],
  // ---- 2026-09-28 新增 ----
  [path.join(UP, 'verify_boot_perf.js'), '首屏性能', ''],
  [path.join(UP, 'verify_api_contracts.js'), '前后端路由契约', ''],
  // ---- 路径安全 ----
  [path.join(UP, 'verify_path_traversal.js'), '路径穿越', ''],
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
})();
