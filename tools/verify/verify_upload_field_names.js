/**
 * 上传接口「字段名」契约核查
 *
 * 背景（2026-09-26 用户拿日志来问的问题）：
 *   日志里反复出现 `[daily-record] 日记插图上传失败: Unexpected field`，HTTP 却是 200 ——
 *   根因是 multer 写 `upload.single('image')`，而前端传的字段名是 `file`
 *   （本项目所有上传接口都是 `file`）。字段名对不上时 multer 直接抛 `Unexpected field`，
 *   **功能 100% 不可用**，但接口返回 200 只带业务码 1001，前端还只弹一句模糊提示，极难发现。
 *
 * 三层断言：
 *   ① **后端不变量（最强）**：所有上传接口的 multer 字段名必须完全一致且为 `file`。
 *      这一条就足以拦住当年的 bug（那个接口自成一派用了 `image`）。
 *   ② **前端不变量**：前端 FormData 的 append 里不能出现 image/photo/img 之类的同义字段名。
 *   ③ **逐接口比对（尽力而为）**：当前端把上传路径与 append 写在同一个文件里时，直接比对；
 *      append 在别处（如 api 层只接一个 FormData 参数）的接口标注为"无法静态判定"。
 *
 * ⚠️ 局限（写清楚，避免误以为它全包了）：③ 只覆盖"同文件"的情况；
 *    真正的兜底是端到端测试 `e2e_diary_image_upload.js`（真的传一次文件）。
 *
 * 用法：node verify_upload_field_names.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = require('./_env').REPO;
const BACKEND_ROUTES = path.join(ROOT, 'app/server/node/routes');
const FRONTEND_SRC = path.join(ROOT, 'frontend/src');

let pass = 0, fail = 0;
const out = [];
function check(name, cond, extra) {
  if (cond) { pass++; out.push(`  ✔ ${name}`); }
  else { fail++; out.push(`  ✘ ${name}${extra ? '  ← ' + extra : ''}`); }
}

const backendFiles = fs.readdirSync(BACKEND_ROUTES).filter((f) => f.endsWith('.js'));
const endpoints = [];      // { file, routePath, field, note }
const allSingleFields = []; // 后端所有 multer 字段名（含包装函数体内的）

for (const f of backendFiles) {
  const src = fs.readFileSync(path.join(BACKEND_ROUTES, f), 'utf-8');

  // ① 先建「包装函数名 → 该函数内部 upload.single('x') 的字段名」
  const wrapperField = {};
  for (const m of src.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/g)) {
    const inner = m[2].match(/upload\.single\(\s*'([^']+)'\s*\)/);
    if (inner) { wrapperField[m[1]] = inner[1]; allSingleFields.push(inner[1]); }
  }

  // ② 再扫路由定义：router.post('<路径>', <中间件...>) —— 中间件可能是
  //    uploadSingle('file')（带参数）或 uploadDiaryImage（包装函数，无参数）
  for (const m of src.matchAll(/router\.(?:post|put)\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)\s*(\(\s*'([^']*)'\s*\))?/g)) {
    const [, routePath, mwName, parenPart, argField] = m;
    let field = null;
    let note = '';
    if (parenPart) {
      // uploadSingle('file') —— 字段名在调用处
      field = argField;
      if (field) allSingleFields.push(field);
    } else if (wrapperField[mwName]) {
      // uploadDiaryImage —— 字段名在包装函数体内
      field = wrapperField[mwName];
      note = `（字段名在包装函数 ${mwName} 内）`;
    }
    if (field) endpoints.push({ file: f, routePath, field, note });
  }
}

check(`解析出 ${endpoints.length} 个上传接口（期望 ≥ 4）`, endpoints.length >= 4,
  endpoints.map((e) => `${e.routePath}→${e.field}`).join(', '));

// ---------- 前端源码 ----------
const feFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(vue|ts)$/.test(e.name)) feFiles.push(p);
  }
})(FRONTEND_SRC);
const feSources = feFiles.map((p) => ({ p, src: fs.readFileSync(p, 'utf-8') }));

/** 收集某文件里 FormData 的 append 字段名（只取 formData/formPayload 这类变量，排除数组 append） */
function appendedFields(src) {
  const names = new Set();
  for (const m of src.matchAll(/[A-Za-z_]*[Ff]orm[A-Za-z_]*\.append\(\s*'([^']+)'/g)) names.add(m[1]);
  return [...names];
}

/** 找到"发往该路径"的前端文件：带 :param 的路径退化成匹配静态前缀 */
function frontendFilesFor(routePath) {
  const staticPrefix = routePath.split('/:')[0];   // '/checkups/:id/photos' → '/checkups'
  return feSources.filter(({ src }) => {
    if (src.includes(`'${routePath}'`) || src.includes(`"${routePath}"`)) return true;
    if (routePath.includes('/:')) {
      // 前端一般写成模板串：`/checkups/${id}/photos`
      const tpl = routePath.replace(/:[A-Za-z_]+/g, '${').split('${')[0];
      return tpl.length > 2 && src.includes(tpl);
    }
    return src.includes(`'${staticPrefix}'`) || src.includes(`"${staticPrefix}"`);
  });
}

// ---------- ① 后端不变量 ----------
out.push('');
out.push('【后端不变量：所有上传接口的字段名一致】');
const uniq = [...new Set(allSingleFields)];
check(`后端 multer 字段名全项目统一为「file」（当前：${uniq.join('/')}）`,
  uniq.length === 1 && uniq[0] === 'file',
  uniq.length ? `发现多种: ${uniq.join(', ')}` : '没解析到任何 upload.single');

// ---------- ② 前端不变量 ----------
out.push('');
out.push('【前端不变量：不用同义字段名】');
const allAppended = new Set();
for (const { src } of feSources) for (const n of appendedFields(src)) allAppended.add(n);
const suspicious = [...allAppended].filter((n) => ['image', 'photo', 'img', 'upload', 'files', 'attachment'].includes(n));
check('前端 FormData 里没有 image/photo/img 之类的同义上传字段名（容易和后端对不上）',
  suspicious.length === 0, suspicious.join(', '));
check('前端确实在使用「file」作为上传字段名', allAppended.has('file'),
  `前端 append 用到的字段名: ${[...allAppended].join(', ')}`);

// ---------- ③ 逐接口比对（尽力而为） ----------
out.push('');
out.push('【逐接口比对（同文件可判定的）】');
let compared = 0, skipped = 0;
for (const ep of endpoints) {
  const files = frontendFilesFor(ep.routePath);
  if (files.length === 0) {
    out.push(`  · ${ep.routePath}：前端没有直接调用点，跳过`);
    skipped++;
    continue;
  }
  // 合并这些文件里 append 的字段名
  const names = new Set();
  for (const { src } of files) for (const n of appendedFields(src)) names.add(n);
  if (names.size === 0) {
    out.push(`  · ${ep.routePath}：调用点在同目录外（api 层只接 FormData 参数），无法静态判定，跳过`);
    skipped++;
    continue;
  }
  compared++;
  const ok = names.has(ep.field);
  check(`${ep.routePath} → 后端「${ep.field}」 vs 前端「${[...names].join('/')}」${ep.note}`,
    ok, ok ? '' : `前端没有传「${ep.field}」`);
}
out.push(`  · 可静态判定 ${compared} 个，跳过 ${skipped} 个（跳过的由端到端测试兜底）`);
check('可静态判定的接口里，字段名全部对得上', fail === 0 || compared > 0,
  compared === 0 ? '一个都没判定成（解析可能失效，需检查脚本）' : '');

console.log(out.join('\n'));
console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
