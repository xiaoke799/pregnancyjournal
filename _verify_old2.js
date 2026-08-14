const fs = require('fs');
const zlib = require('zlib');

// Try to find app.tgz inside old FPK and list ALL entries
const fpk = fs.readFileSync('d:\\pregnancy-journal\\pregnancyjournal\\pregnancyjournal.fpk');
console.log('OLD FPK:', (fpk.length / 1024 / 1024).toFixed(2), 'MB');

let o = 0;
while (o < fpk.length - 512) {
  const n = fpk.toString('utf8', o, o + 100).replace(/\0.*$/, '');
  if (!n) { o += 512; continue; }
  const s = parseInt(fpk.toString('utf8', o + 124, o + 136).trim(), 8) || 0;
  
  // Look for large entries that could be archives
  if (s > 50000) {
    console.log(`\nLarge entry: "${n}" (${s} bytes)`);
    // Try as gzip
    const data = fpk.slice(o + 512, o + 512 + s);
    try {
      const decompressed = zlib.gunzipSync(data);
      console.log(`  -> Is gzip! Decompressed: ${(decompressed.length/1024/1024).toFixed(2)} MB`);
      
      // Check if inner data looks like tar
      const firstEntry = decompressed.toString('utf8', 0, 100).replace(/\0.*$/, '');
      console.log(`  -> First inner entry: "${firstEntry}"`);
      
      // List first 20 inner entries
      let t = 0, ic = 0;
      while (t < decompressed.length - 512 && ic < 30) {
        const en = decompressed.toString('utf8', t, t + 100).replace(/\0.*$/, '');
        if (!en) { t += 512; continue; }
        const es = parseInt(decompressed.toString('utf8', t + 124, t + 136).trim(), 8) || 0;
        console.log(`     [${ic}] ${en} (${es})`);
        t += 512 + Math.ceil(es / 512) * 512;
        ic++;
      }
    } catch(e) {
      // Not gzip, check if tar directly
      const firstEntry = data.toString('utf8', 0, 100).replace(/\0.*$/, '');
      console.log(`  -> Not gzip. First bytes: ${data.slice(0,4).toString('hex')}`);
      console.log(`  -> First entry name: "${firstEntry}"`);
    }
  }
  o += 512 + Math.ceil(s / 512) * 512;
}
