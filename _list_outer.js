const fs = require('fs');
const zlib = require('zlib');
const fpkPath = 'd:/pregnancy-journal/pregnancyjournal/pregnancyjournal.fpk';
const buf = fs.readFileSync(fpkPath);
const tarData = zlib.gunzipSync(buf);
let pos = 0;
console.log(`FPK: ${(buf.length/1024).toFixed(0)}KB, tar size: ${(tarData.length/1024).toFixed(0)}KB`);
while (pos < tarData.length - 512) {
    const nb = tarData.subarray(pos, pos + 100); const ni = nb.indexOf(0);
    const name = ni >= 0 ? nb.subarray(0, ni).toString('utf8') : '';
    if (!name) { pos += 512; continue; }
    const pfxBuf = tarData.subarray(pos + 345, pos + 500); const pi = pfxBuf.indexOf(0);
    const pfx = pi >= 0 ? pfxBuf.subarray(0, pi).toString('utf8') : '';
    const fullName = pfx ? `${pfx}/${name}` : name;
    const ss = tarData.subarray(pos + 124, pos + 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(ss, 8) || 0;
    console.log(`  ${fullName} (${size}b) @ offset ${pos}`);
    pos += 512 + Math.ceil(size / 512) * 512;
}
