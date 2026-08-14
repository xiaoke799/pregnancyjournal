const fs = require('fs');
const zlib = require('zlib');

const old = fs.readFileSync('d:\\pregnancy-journal\\pregnancyjournal\\pregnancyjournal.fpk');
console.log('=== OLD FPK ===', (old.length/1024/1024).toFixed(2), 'MB');

let o = 0;
while (o < old.length - 512) {
  const n = old.toString('utf8', o, o + 100).replace(/\0.*$/, '');
  if (!n) { o += 512; continue; }
  const s = parseInt(old.toString('utf8', o + 124, o + 136).trim(), 8) || 0;
  console.log(`ENTRY: ${n} (${(s/1024/1024).toFixed(2)} MB)`);
  
  // If this looks like a tgz, try to list its contents
  if (s > 100000 && (n.endsWith('.tgz') || n.includes('app'))) {
    console.log('  -> Large entry, trying to parse as tgz...');
    const data = old.slice(o + 512, o + 512 + s);
    try {
      const tar = zlib.gunzipSync(data);
      let t = 0, ic = 0;
      while (t < tar.length - 512 && ic < 60) {
        const en = tar.toString('utf8', t, t + 100).replace(/\0.*$/, '');
        if (!en) { t += 512; continue; }
        const es = parseInt(tar.toString('utf8', t + 124, t + 136).trim(), 8) || 0;
        // Show top-level dirs and anything with 'server' or 'www'
        const depth = en.split('/').filter(x=>x).length;
        if (depth <= 2 || en.includes('server') || en.includes('www') || en.includes('node_modules')) {
          console.log(`     [${ic}] ${en} (${es})`);
        }
        t += 512 + Math.ceil(es / 512) * 512;
        ic++;
      }
      console.log(`  -> Total inner entries checked: ${ic}`);
      console.log(`  -> Inner size: ${(tar.length/1024/1024).toFixed(2)} MB`);
    } catch(e) {
      console.log(`  -> Not gzip: ${e.message}`);
      // Maybe it's a plain tar?
      let t = 0, ic = 0;
      while (t < Math.min(data.length, 500000) - 512 && ic < 30) {
        const en = data.toString('utf8', t, t + 100).replace(/\0.*$/, '');
        if (!en) { t += 512; continue; }
        const es = parseInt(data.toString('utf8', t + 124, t + 136).trim(), 8) || 0;
        console.log(`     [${ic}] ${en} (${es})`);
        t += 512 + Math.ceil(es / 512) * 512;
        ic++;
      }
    }
  }
  o += 512 + Math.ceil(s / 512) * 512;
}
