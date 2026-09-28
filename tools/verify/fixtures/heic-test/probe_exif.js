// 探针：确认 jpeg-js 的 exifBuffer 布局与解码参数
const jpeg = require(require('../../_env').NODE_MODULES + '/jpeg-js');
const fs = require('fs');

const buf = fs.readFileSync(require('path').join(__dirname, 'rot.jpg'));
const out = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
console.log('解码尺寸:', out.width + 'x' + out.height);
console.log('data 字节数:', out.data.length, '（= w*h*4 ?', out.data.length === out.width * out.height * 4, '）');
const eb = out.exifBuffer;
console.log('exifBuffer 长度:', eb ? eb.length : null);
if (eb) {
  console.log('前 12 字节:', Array.from(eb.slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')).join(' '));
  console.log('前 12 字节(可见字符):', JSON.stringify(Buffer.from(eb.slice(0, 12)).toString('latin1')));
}
