/**
 * 反例桩件：**不是** 回归套件，也不会被 `run_all_suites.js` 收录。
 * 它冒充 `vue-tsc`，打出与真实 tsc 同格式的错误行并以非 0 退出，
 * 专门用来验证 `verify_frontend_types.js` 的「识别 `error TS` + 判红」路径真的会红
 * （铁律 #11：一个从不失败的检查 = 安慰剂）。
 *
 * 用法（见 tools/verify/README.md「反例口径」）：
 *   PJ_VUE_TSC=tools/verify/_fake_tsc_bad.js node tools/verify/verify_frontend_types.js
 *   期望：0 通过 / 1 失败，并列出下面两行错误，退出码 1。
 *
 * 之所以收进仓库（而不是放 .tmp/）：`.tmp/` 被 gitignore，放那里的桩件别人 clone 下来复现不了，
 * 反例就退化成"作者本机的一次性动作"。
 */
console.log("src/api/client.ts(13,26): error TS2322: Type 'string' is not assignable to type 'number'.");
console.log("src/views/RecordView.vue(88,7): error TS2345: Argument of type 'null' is not assignable to parameter of type 'Date'.");
console.log('');
console.log('Found 2 errors in 2 files.');
process.exit(2);
