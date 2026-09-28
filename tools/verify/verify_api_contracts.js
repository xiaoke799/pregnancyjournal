/**
 * 前后端接口契约核查：「前端调用的路径」必须真的存在于后端路由表
 *
 * 为什么需要它（2026-09-26 的教训）：
 *   日记插图上传因为「前端传 file / 后端收 image」而 **100% 不可用**，
 *   接口却返 HTTP 200 —— 这类"前后端对不上"的问题不会报错，只会静默失效。
 *   字段名那一维已由 `verify_upload_field_names.js` 覆盖；
 *   这里覆盖另一维：**路径本身**（前端调了一个后端没有的接口 ⇒ 404 ⇒ 功能点了没反应）。
 *
 * 做法：
 *   ① 扫后端 `routes/*.js` 的 `router.<method>('<path>')`（全部挂在 /api/v1 下）；
 *   ② 扫前端 `client.<method>('路径')` 与模板串写法 `` client.post(`/x/${id}/y`) ``；
 *   ③ 归一化（`:param` 与 `${...}` 都当成同一个占位符）后比对。
 *
 * ⚠️ 解析类检查的铁律：必须断言"解析到了预期数量"，否则正则失配会变成假绿。
 *
 * 用法：node verify_api_contracts.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = require('./_env').REPO;
const BACKEND_ROUTES = path.join(ROOT, 'app/server/node/routes');
const FRONTEND_SRC = path.join(ROOT, 'frontend/src');

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

/** 归一化：参数占位统一成 :p，去掉尾斜杠与查询串 */
function norm(p) {
  let s = String(p)
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, ':p')    // 前端模板串 / 后端工厂里的 ${base}
    .replace(/:[A-Za-z0-9_]+/g, ':p') // 后端 :param
    .replace(/\/+$/, '');             // 去尾斜杠
  // ⚠️ 必须单独补前导斜杠，不能写成 `... || '/'.replace(...)` ——
  // `||` 优先级低于方法调用，那样会作用到字符串字面量上（我第一版就是这么错的）。
  // 后端工厂写的是 `${base}/status`（base = `/${channelKey}`，自带斜杠），
  // 不补的话段数与前端对不上 ⇒ 8 条 push 路由被误报成"前端调了不存在的接口"。
  if (s && !s.startsWith('/')) s = '/' + s;
  return s || '/';
}

// ---------- ① 后端路由表 ----------
// ⚠️ 有两种写法：字符串字面量 router.get('/photos') 与**动态生成** router.get(`${base}/config`)
// （push 的渠道路由是工厂函数按渠道生成的）。两种都要收，否则会误报"前端调了不存在的接口"。
const backendRoutes = [];   // {method, path}
for (const f of fs.readdirSync(BACKEND_ROUTES).filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(BACKEND_ROUTES, f), 'utf-8');
  for (const m of src.matchAll(/router\.(get|post|put|delete|patch)\(\s*(?:'([^']+)'|`([^`]+)`)/g)) {
    const p = m[2] !== undefined ? m[2] : m[3];
    if (p) backendRoutes.push({ method: m[1].toUpperCase(), path: p, file: f });
  }
}
check(`后端解析出 ${backendRoutes.length} 条路由（期望 > 50）`, backendRoutes.length > 50,
  `实际 ${backendRoutes.length}`);
const hasDynamic = backendRoutes.filter((r) => r.path.includes('${')).length;
check(`其中识别出 ${hasDynamic} 条动态生成的路由（push 渠道工厂）`, hasDynamic >= 8, `实际 ${hasDynamic}`);

/** 模式匹配：段数相同，且每段相等或任一侧是参数占位符（:p） */
function matchesPattern(feNorm, beNorm) {
  const a = feNorm.split('/');
  const b = beNorm.split('/');
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i] || seg === ':p' || b[i] === ':p');
}

// ---------- ② 前端调用 ----------
const feFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(vue|ts)$/.test(e.name)) feFiles.push(p);
  }
})(FRONTEND_SRC);

const calls = [];        // {method, raw, file, dynamic}
const dynamicCalls = []; // 路径是变量，无法静态判定
for (const file of feFiles) {
  const src = fs.readFileSync(file, 'utf-8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  // 形如 client.get('/x') / client.post(`/x/${y}`) / api.get(...)
  for (const m of src.matchAll(/\bclient\.(get|post|put|delete|patch)\(\s*('([^']*)'|`([^`]*)`)/g)) {
    const raw = (m[3] !== undefined ? m[3] : m[4]) || '';
    if (raw.startsWith('/')) calls.push({ method: m[1].toUpperCase(), raw, file: rel });
  }
  // client.get(url) —— 路径来自变量（如 photoApi 的封装）
  for (const m of src.matchAll(/\bclient\.(get|post|put|delete|patch)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    dynamicCalls.push({ method: m[1].toUpperCase(), file: rel });
  }
}
check(`前端解析出 ${calls.length} 处字面量调用（期望 > 60）`, calls.length > 60, `实际 ${calls.length}`);
out.push(`  · 另有 ${dynamicCalls.length} 处路径来自变量，无法静态判定（如 api 层的 formData 封装）`);

// ---------- ③ 比对 ----------
out.push('');
out.push('【前端调用的接口必须在后端存在】');
const missing = [];
const seen = new Set();
for (const c of calls) {
  const key = `${c.method} ${norm(c.raw)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const ok = backendRoutes.some((r) => r.method === c.method && matchesPattern(norm(c.raw), norm(r.path)));
  if (!ok) missing.push(`${c.method} ${c.raw}  (${c.file})`);
}
check(`前端 ${seen.size} 个不同调用全部能在后端找到对应路由`,
  missing.length === 0, missing.slice(0, 8).join(' ; '));

// ---------- ④ 反向：后端有没有"前端从不调用"的路由（仅供参考） ----------
const uncalled = [...new Set(backendRoutes.map((r) => `${r.method} ${norm(r.path)}`))]
  .filter((r) => {
    const [method, p] = r.split(' ');
    return !calls.some((c) => c.method === method && matchesPattern(norm(c.raw), p));
  });
out.push('');
out.push(`【参考】后端有 ${uncalled.length} 条路由没有前端直接调用（含保留能力/内部接口，不算失败）`);
out.push('  ' + uncalled.slice(0, 14).join(', ') + (uncalled.length > 14 ? ` … 共 ${uncalled.length}` : ''));

console.log(out.join('\n'));
console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
