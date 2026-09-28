/**
 * 修 fpk 里脚本的执行权限（Windows 版 fnpack 不会写 POSIX 权限位）
 *
 * 【为什么要这个脚本】
 * fnpack 在 Windows 上打包时，tar 里所有条目的 mode 都是 0666 —— 没有执行位。
 * 飞牛官方要求 `cmd/` 下的生命周期脚本是 755（官方 index-cgi.md 也写了
 * "打包工具会在打包过程中处理可执行权限"，那是 Linux 版 fnpack 的行为）。
 * 实测设备上装得上运行得起来，说明飞牛那边会补权限，但那属于依赖对方兜底：
 * 一旦对方不补，"脚本执行失败"会表现为安装/启动毫无征兆地失败，很难查。
 *
 * 【做法】
 * 解开 fpk（tar.gz），把下面这些条目的 mode 改成 0755，再原样压回去：
 *   - 外层 `cmd/*`（安装后是 /var/apps/{appname}/cmd/，飞牛真正执行的那份）
 *   - app.tgz 内层 `cmd/*`、`ui/index.cgi`
 * 只改权限头字节，不动任何文件内容。改完自己再解一遍做校验。
 *
 * 用法：node fix_fpk_modes.js <xxx.fpk>
 * 退出码：0 成功 / 1 失败（失败时**不写回**原文件，原包保持不动）
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TARGET_MODE = 0o755;

function readString(buf, start, end) {
  return buf.subarray(start, end).toString('utf8').replace(/\0[\s\S]*$/, '');
}

function writeOctal(header, offset, length, value) {
  const s = value.toString(8).padStart(length - 1, '0') + '\0';
  header.write(s, offset, length, 'ascii');
}

/** 改写 mode 后必须重算校验和，否则 tar 会认为头坏了 */
function refreshChecksum(header) {
  header.fill(0x20, 148, 156); // 标准做法：校验位先填 8 个空格
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i];
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
}

function setMode(header, mode) {
  writeOctal(header, 100, 8, mode);
  refreshChecksum(header);
}

function parseTar(buf) {
  const members = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const raw = buf.subarray(off, off + 512);
    if (raw.every((b) => b === 0)) break; // 结束块
    const name = readString(raw, 0, 100);
    if (!name) { off += 512; continue; }
    const header = Buffer.from(raw); // 拷贝一份，后面要改
    const size = parseInt(readString(raw, 124, 136).trim() || '0', 8);
    const typeflag = String.fromCharCode(header[156]);
    const prefix = readString(header, 345, 500);
    const dataStart = off + 512;
    const data = Buffer.from(buf.subarray(dataStart, dataStart + size));
    members.push({ name: prefix ? `${prefix}/${name}` : name, header, data, typeflag });
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return members;
}

function buildTar(members) {
  const parts = [];
  for (const m of members) {
    // header 里的 size 字段必须与实际数据一致（app.tgz 重新压缩后长度会变）
    writeOctal(m.header, 124, 12, m.data.length);
    refreshChecksum(m.header);
    parts.push(m.header);
    if (m.data.length) {
      parts.push(m.data);
      const pad = (512 - (m.data.length % 512)) % 512;
      if (pad) parts.push(Buffer.alloc(pad));
    }
  }
  parts.push(Buffer.alloc(1024)); // 结束标记
  return Buffer.concat(parts);
}

function isRegularFile(typeflag) {
  return typeflag === '0' || typeflag === '\0' || typeflag === '7';
}

/** 给一层 tar 里的目标条目改权限，返回改动数 */
function fixLayer(members, isInner) {
  let n = 0;
  for (const m of members) {
    if (!isRegularFile(m.typeflag)) continue;
    const hit = m.name.startsWith('cmd/') || (isInner && m.name === 'ui/index.cgi');
    if (!hit) continue;
    setMode(m.header, TARGET_MODE);
    n++;
  }
  return n;
}

/** 读回校验：目标条目的 mode 必须真的是 755，且包结构没被改坏 */
function verify(fpkPath) {
  const outer = parseTar(zlib.gunzipSync(fs.readFileSync(fpkPath)));
  const problems = [];
  const check = (members, isInner, label) => {
    for (const m of members) {
      if (!isRegularFile(m.typeflag)) continue;
      const hit = m.name.startsWith('cmd/') || (isInner && m.name === 'ui/index.cgi');
      if (!hit) continue;
      const mode = parseInt(readString(m.header, 100, 108).trim() || '0', 8);
      if (mode !== TARGET_MODE) problems.push(`${label} ${m.name} 权限仍是 ${mode.toString(8)}`);
    }
  };
  check(outer, false, '外层');
  const appTgz = outer.find((m) => m.name === 'app.tgz');
  if (!appTgz) { problems.push('外层缺少 app.tgz'); return problems; }
  const inner = parseTar(zlib.gunzipSync(appTgz.data));
  check(inner, true, '内层');
  if (!inner.some((m) => m.name === 'server/node/server.js')) problems.push('内层缺少 server/node/server.js');
  if (!inner.some((m) => m.name === 'ui/index.html')) problems.push('内层缺少 ui/index.html');
  return problems;
}

function main() {
  const fpkPath = process.argv[2];
  if (!fpkPath) { console.error('用法: node fix_fpk_modes.js <xxx.fpk>'); process.exit(1); }
  if (!fs.existsSync(fpkPath)) { console.error(`文件不存在: ${fpkPath}`); process.exit(1); }

  let changed = 0;
  try {
    const outer = parseTar(zlib.gunzipSync(fs.readFileSync(fpkPath)));
    if (!outer.length) throw new Error('解出的 tar 为空，可能不是 fpk');
    changed += fixLayer(outer, false);
    const appTgz = outer.find((m) => m.name === 'app.tgz');
    if (!appTgz) throw new Error('外层找不到 app.tgz');
    const inner = parseTar(zlib.gunzipSync(appTgz.data));
    changed += fixLayer(inner, true);
    appTgz.data = zlib.gzipSync(buildTar(inner), { level: 6 });
    // 先在内存里验证一遍，确认无误才落盘
    const rebuilt = zlib.gzipSync(buildTar(outer), { level: 6 });
    const tmpOut = `${fpkPath}.modecheck`;
    fs.writeFileSync(tmpOut, rebuilt);
    const problems = verify(tmpOut);
    if (problems.length) {
      fs.unlinkSync(tmpOut);
      throw new Error(`重建后校验未通过: ${problems.join('; ')}`);
    }
    fs.writeFileSync(fpkPath, rebuilt);
    fs.unlinkSync(tmpOut);
  } catch (e) {
    console.error(`[fpk 权限] 未改动原包（${path.basename(fpkPath)}）：${e.message}`);
    process.exit(1);
  }
  console.log(`[fpk 权限] 已修正 ${changed} 个条目为 0755，校验通过：${path.basename(fpkPath)}`);
}

main();
