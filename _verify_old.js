const fs = require('fs');
const zlib = require('zlib');
// Check OLD 52MB FPK
const fpk = fs.readFileSync('d:\\pregnancy-journal\\pregnancyjournal\\pregnancyjournal.fpk');
console.log('=== OLD FPK size:', (fpk.length / 1024 / 1024).toFixed(2), 'MB ===');
let o = 0;
while (o < fpk.length - 512) {
  const n = fpk.toString('utf8', o, o + 100).replace(/\0.*$/, '');
  if (!n) { o += 512; continue; }
  const s = parseInt(fpk.toString('utf8', o + 124, o + 136).trim(), 8) || 0;
  console.log(`ENTRY: ${n} (${s} bytes)`);
  if (s > 10000 && (n.includes('.tgz') || n.includes('app'))) {
    const tgzData = fpk.slice(o + 512, o + 512 + s);
    try {
      const tar = zlib.gunzipSync(tgzData);
      let t = 0, ic = 0;
      // Only show top-level and server entries
      while (t < tar.length - 512) {
        const en = tar.toString('utf8', t, t + 100).replace(/\0.*$/, '');
        if (!en) { t += 512; continue; }
        const es = parseInt(tar.toString('utf8', t + 124, t + 136).trim(), 8) || 0;
        // Only show top-level dirs or server files
        const depth = en.split('/').length;
        if (depth <= 2 || en.startsWith('server/') || en.startsWith('cmd/')) {
          console.log(`  ${en} (${es})`);
        }
        t += 512 + Math.ceil(es / 512) * 512;
        ic++;
      }
      console.log(`  Total in inner archive: ${ic} entries`);
    } catch(e) { console.log('Error:', e.message); }
  }
  o += 512 + Math.ceil(s / 512) * 512;
}
