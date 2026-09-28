// 探针：为什么方向没读出来
const jpeg = require(require('../../_env').NODE_MODULES + '/jpeg-js');
const fs = require('fs');

const buf = fs.readFileSync(require('path').join(__dirname, 'rot.jpg'));
const d = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
const eb = d.exifBuffer;
console.log('typeof:', typeof eb, '| constructor:', eb && eb.constructor && eb.constructor.name);
console.log('有 readUInt16LE 吗:', typeof (eb && eb.readUInt16LE));
console.log('全部字节:', Array.from(eb).map((b) => b.toString(16).padStart(2, '0')).join(' '));

// 用 DataView 复刻解析逻辑
const dv = new DataView(eb.buffer, eb.byteOffset, eb.byteLength);
const off = eb[0] === 0 ? 1 : 0;
const be = eb[off] === 0x4d;
const u16 = (o) => dv.getUint16(o, !be);
const u32 = (o) => dv.getUint32(o, !be);
console.log('off =', off, '| 字节序 =', be ? 'MM' : 'II');
console.log('magic =', u16(off + 2).toString(16), '(应为 2a)');
const ifd0 = off + u32(off + 4);
console.log('ifd0 =', ifd0, '| 条目数 =', u16(ifd0));
for (let i = 0; i < u16(ifd0); i++) {
  const e = ifd0 + 2 + i * 12;
  console.log(`  条目${i}: tag=0x${u16(e).toString(16)} value=${u16(e + 8)}`);
}
