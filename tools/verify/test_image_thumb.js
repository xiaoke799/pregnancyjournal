// 缩略图服务单测：尺寸、EXIF 方向、格式支持边界
const path = require('path');
const fs = require('fs');
const NODE_DIR = require('./_env').SERVER_DIR;
const thumb = require(path.join(NODE_DIR, 'services/image-thumb'));
const jpeg = require(path.join(NODE_DIR, 'node_modules/jpeg-js'));
const PNG = require(path.join(NODE_DIR, 'node_modules/pngjs')).PNG;

const T = path.join(require('os').tmpdir(), 'pj-thumb-test');
fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' —— ' + detail : ''}`); }
}
const px = (buf, w, x, y) => { const i = (y * w + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };

// 1) 带 EXIF 方向 6 的 JPEG（400x200，左上角红色块，其余蓝色）
const src = path.join(require('./_env').FIXTURES, 'heic-test/rot.jpg');
const t1 = thumb.makeThumbnail(src);
check('生成缩略图', !!t1 && fs.existsSync(t1), String(t1));
if (t1) {
  const d = jpeg.decode(fs.readFileSync(t1), { useTArray: true });
  check('方向 6 → 尺寸翻转为 200x400', d.width === 200 && d.height === 400, `${d.width}x${d.height}`);
  const tr = px(d.data, d.width, 150, 50);
  const tl = px(d.data, d.width, 50, 50);
  check('红色块被转到右上角（源左上 → 顺时针 90° 后到右上）', tr[0] > 150 && tr[2] < 100 && tl[2] > 150, `右上=${tr} 左上=${tl}`);
  check('缩略图小于 200KB（网格用）', fs.statSync(t1).size < 200 * 1024, String(fs.statSync(t1).size));
}

// 2) 无色偏的 PNG：尺寸只缩不放
const p = new PNG({ width: 1200, height: 600 });
for (let i = 0; i < p.data.length; i += 4) { p.data[i] = 30; p.data[i + 1] = 200; p.data[i + 2] = 90; p.data[i + 3] = 255; }
const pngPath = path.join(T, 'big.png');
fs.writeFileSync(pngPath, PNG.sync.write(p));
const t2 = thumb.makeThumbnail(pngPath);
check('PNG 生成缩略图', !!t2 && fs.existsSync(t2), String(t2));
if (t2) {
  const d = jpeg.decode(fs.readFileSync(t2), { useTArray: true });
  check('长边被缩到 640', Math.max(d.width, d.height) === 640 && d.width === 640 && d.height === 320, `${d.width}x${d.height}`);
  const c = px(d.data, d.width, 100, 100);
  check('颜色基本保持', Math.abs(c[0] - 30) < 12 && Math.abs(c[1] - 200) < 12, String(c));
}

// 3) 小图不放大
const small = new PNG({ width: 100, height: 80 });
small.data.fill(120);
const sp = path.join(T, 'small.png');
fs.writeFileSync(sp, PNG.sync.write(small));
const t3 = thumb.makeThumbnail(sp);
if (t3) {
  const d = jpeg.decode(fs.readFileSync(t3), { useTArray: true });
  check('小图保持原尺寸（不放大）', d.width === 100 && d.height === 80, `${d.width}x${d.height}`);
} else { check('小图生成缩略图', false); }

// 4) 不支持的格式直接返回 null（保持旧行为）
const unsupported = path.join(T, 'whatever.webp');
fs.writeFileSync(unsupported, Buffer.from('RIFF....WEBP'));
check('WebP/HEIC 等不支持格式返回 null', thumb.makeThumbnail(unsupported) === null);
check('canGenerate 只认 JPEG/PNG', thumb.canGenerate('a.jpg') && thumb.canGenerate('a.PNG') && !thumb.canGenerate('a.webp'));

// 5) 坏 JPEG 不抛异常
const broken = path.join(T, 'broken.jpg');
fs.writeFileSync(broken, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
check('坏文件不抛异常、返回 null', thumb.makeThumbnail(broken) === null);
check('不存在的文件返回 null', thumb.makeThumbnail(path.join(T, 'nope.jpg')) === null);

console.log(`\n=== 结果: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail === 0 ? 0 : 1);
