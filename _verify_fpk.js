const fs = require('fs');
const zlib = require('zlib');
const fpkPath = 'd:/pregnancy-journal/pregnancyjournal/pregnancyjournal.fpk';
const buf = fs.readFileSync(fpkPath);
const out = [];
out.push(`FPK: ${(buf.length/1024/1024).toFixed(1)} MB`);

function parseTar(tarBuf) {
    const entries = [];
    let pos = 0;
    while (pos < tarBuf.length - 512) {
        const nameRaw = tarBuf.subarray(pos, pos + 100);
        const ni = nameRaw.indexOf(0);
        const name = ni >= 0 ? nameRaw.subarray(0, ni).toString('utf8') : '';
        if (!name) { pos += 512; continue; }
        const pfxRaw = tarBuf.subarray(pos + 345, pos + 500);
        const pi = pfxRaw.indexOf(0);
        const pfx = pi >= 0 ? pfxRaw.subarray(0, pi).toString('utf8') : '';
        const fullName = (pfx && name) ? `${pfx}/${name}` : (name || pfx);
        const ss = tarBuf.subarray(pos + 124, pos + 136).toString('ascii').replace(/\0.*$/, '').trim();
        const size = parseInt(ss, 8) || 0;
        entries.push(fullName);
        pos += 512 + Math.ceil(size / 512) * 512;
    }
    return entries;
}

// Outer
const outerTar = zlib.gunzipSync(buf);
const outerEntries = parseTar(outerTar);
out.push(`\nOuter: ${outerEntries.length} entries`);
const tgzName = outerEntries.find(e => e.endsWith('.tgz') || e === 'app.tgz');
if (!tgzName) { out.push('ERROR: no app.tgz'); fs.writeFileSync('d:/pregnancy-journal/_verify_output.txt', out.join('\n')); process.exit(1); }
out.push(`app.tgz found: ${tgzName}`);

// Inner
const tgzIdx = outerEntries.indexOf(tgzName);
// Find data start for app.tgz by re-parsing with sizes
let opos = 0;
let tgzDataStart = 0, tgzDataSize = 0;
while (opos < outerTar.length - 512) {
    const nr = outerTar.subarray(opos, opos + 100); const nri = nr.indexOf(0);
    const ename = nri >= 0 ? nr.subarray(0, nri).toString('utf8') : '';
    if (!ename) { opos += 512; continue; }
    const pr = outerTar.subarray(opos + 345, opos + 500); const pri = pr.indexOf(0);
    const epfx = pri >= 0 ? pr.subarray(0, pri).toString('utf8') : '';
    const efull = (epfx && ename) ? `${epfx}/${ename}` : ename;
    const ss2 = outerTar.subarray(opos + 124, opos + 136).toString('ascii').replace(/\0.*$/, '').trim();
    const esz = parseInt(ss2, 8) || 0;
    if (efull === tgzName) { tgzDataStart = opos + 512; tgzDataSize = esz; }
    opos += 512 + Math.ceil(esz / 512) * 512;
}
const innerTar = zlib.gunzipSync(outerTar.subarray(tgzDataStart, tgzDataStart + tgzDataSize));
out.push(`app.tgz decompressed: ${(innerTar.length/1024/1024).toFixed(1)} MB`);

const appEntries = parseTar(innerTar);
out.push(`\ntotal entries: ${appEntries.length}`);

// Count by top-level dir
const prefixes = {};
appEntries.forEach(n => {
    const p = n.split('/')[0];
    prefixes[p] = (prefixes[p] || 0) + 1;
});
out.push('\nBy top-level dir:');
Object.entries(prefixes).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => out.push(`  ${k}/: ${v} files`));

// Critical checks
const has = (p) => appEntries.some(e => e === p || e.endsWith('/' + p));
out.push('\nCritical checks:');
[
    'server/node/server.js',
    'server/node/db.js',
    'server/node/package.json',
    'server/node/routes/daily-record.js',
    'server/node/node_modules/express',
    'ui/index.cgi',
    'ui/index.html',
    'ui/config'
].forEach(p => {
    const found = appEntries.find(e => e === p);
    out.push(`  ${p}: ${found ? 'YES' : 'NO'}`);
});

// Show sample server and ui entries
const srv = appEntries.filter(e => e.startsWith('server/node/') && !e.startsWith('server/node/node_modules/'));
const uie = appEntries.filter(e => e.startsWith('ui/'));
const nm = appEntries.filter(e => e.includes('node_modules/express'));
out.push(`\nServer code (non-nm): ${srv.length} files`);
srv.slice(0, 10).forEach(n => out.push(`  ${n}`));
if (srv.length > 10) out.push(`  ... +${srv.length-10} more`);
out.push(`\nUI: ${uie.length} files`);
uie.slice(0, 10).forEach(n => out.push(`  ${n}`));
if (uie.length > 10) out.push(`  ... +${uie.length-10} more`);
out.push(`\nnode_modules/express samples: ${nm.length}`);
nm.slice(0, 5).forEach(n => out.push(`  ${n}`));

fs.writeFileSync('d:/pregnancy-journal/_verify_output.txt', out.join('\n'));
console.log('Done!');
