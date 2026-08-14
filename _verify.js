const fs = require('fs');
const zlib = require('zlib');
const path = 'd:\\pregnancy-journal\\pregnancyjournal\\app\\pregnancyjournal.fpk';
const b = fs.readFileSync(path);
console.log('=== FPK size:', (b.length / 1024).toFixed(1), 'KB ===');
const d = zlib.gunzipSync(b);
console.log('=== Decompressed:', (d.length / 1024).toFixed(1), 'KB ===');
let o = 0, c = 0;
while (o < d.length - 512) {
  const n = d.toString('utf8', o, o + 100).replace(/\0.*$/, '');
  if (!n) { o += 512; continue; }
  const s = parseInt(d.toString('utf8', o + 124, o + 136).trim(), 8) || 0;
  console.log(`[${c}] ${n} (${s} bytes)`);
  // If this is app.tgz, list inner contents
  if (s > 10000 && n.includes('.tgz')) {
    console.log('  >>> Listing app.tgz contents:');
    const tgzData = d.slice(o + 512, o + 512 + s);
    try {
      const tar = zlib.gunzipSync(tgzData);
      let t = 0, ic = 0;
      while (t < tar.length - 512) {
        const en = tar.toString('utf8', t, t + 100).replace(/\0.*$/, '');
        if (!en) { t += 512; continue; }
        const es = parseInt(tar.toString('utf8', t + 124, t + 136).trim(), 8) || 0;
        console.log(`      [${ic}] ${en} (${es})`);
        t += 512 + Math.ceil(es / 512) * 512;
        ic++;
      }
      console.log(`  >>> Total in app.tgz: ${ic} entries`);
    } catch(e) { console.log('  >>> Error parsing app.tgz:', e.message); }
  }
  o += 512 + Math.ceil(s / 512) * 512;
  c++;
}
console.log('\nTotal FPK entries:', c);
