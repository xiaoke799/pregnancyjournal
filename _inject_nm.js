// Inject node_modules into existing FPK's app.tgz
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const fpkPath = 'd:/pregnancy-journal/pregnancyjournal/pregnancyjournal.fpk';
const nmPath = 'd:/pregnancy-journal/pregnancyjournal/app/server/node/node_modules';
const outPath = 'd:/pregnancy-journal/pregnancyjournal/pregnancyjournal.fpk';

function readTarEntries(buf) {
    const entries = [];
    let pos = 0;
    while (pos < buf.length - 512) {
        const nameBuf = buf.subarray(pos, pos + 100);
        const ni = nameBuf.indexOf(0);
        const name = ni >= 0 ? nameBuf.subarray(0, ni).toString('utf8') : '';
        if (!name) { pos += 512; continue; }
        const sizeStr = buf.subarray(pos + 124, pos + 136).toString('ascii').replace(/\0.*$/, '').trim();
        const size = parseInt(sizeStr, 8) || 0;
        const prefixBuf = buf.subarray(pos + 345, pos + 500);
        const pi = prefixBuf.indexOf(0);
        const prefix = pi >= 0 ? prefixBuf.subarray(0, pi).toString('utf8') : '';
        const fullName = prefix ? `${prefix}/${name}` : name;
        const typeflag = String.fromCharCode(buf[pos + 156] || 0);
        entries.push({ fullName, size, dataStart: pos + 512, typeflag, headerStart: pos });
        pos += 512 + Math.ceil(size / 512) * 512;
    }
    return entries;
}

function makeHeader(name, size, typeflag = '0') {
    const header = Buffer.alloc(512, 0);
    // name (100)
    const parts = name.split('/');
    const fname = parts.pop() || '';
    const pfx = parts.join('/');
    header.write(fname, 0);
    // mode (8)
    header.write('0000644', 100);
    // uid (8)
    header.write('0000000', 108);
    // gid (8)
    header.write('0000000', 116);
    // size (12 octal)
    header.write(size.toString(8).padStart(11, '0'), 124);
    // mtime (12)
    header.write('00000000000', 136);
    // checksum placeholder (8) - fill with spaces first
    header.write('        ', 148);
    // typeflag (1)
    header.write(typeflag, 156);
    // linkname (100)
    // magic (6)
    header.write('ustar ', 257);
    // version (2)
    header.write('00', 263);
    // uname (32)
    header.write('root', 265);
    // gname (32)
    header.write('root', 297);
    // devmajor (8)
    // devminor (8)
    // prefix (155)
    header.write(pfx, 345);
    // Calculate checksum
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return header;
}

function addDirToTar(tarParts, dirPath, tarPrefix) {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of items) {
        if (item.name === '.package-lock.json') continue;
        const fullPath = path.join(dirPath, item.name);
        const tarName = `${tarPrefix}/${item.name}`;
        if (item.isDirectory()) {
            tarParts.push(makeHeader(tarName, 0, '5'));
            addDirToTar(tarParts, fullPath, tarName);
        } else if (item.isFile()) {
            const data = fs.readFileSync(fullPath);
            tarParts.push(makeHeader(tarName, data.length, '0'));
            tarParts.push(data);
            // padding to 512 boundary
            const pad = 512 - (data.length % 512);
            if (pad < 512) tarParts.push(Buffer.alloc(pad, 0));
        } else if (item.isSymbolicLink()) {
            const target = fs.readlinkSync(fullPath);
            const h = makeHeader(tarName, target.length, '2');
            h.write(target, 157); // linkname field
            tarParts.push(h);
        }
    }
}

console.log('Reading FPK...');
const fpkBuf = fs.readFileSync(fpkPath);
console.log(`FPK: ${(fpkBuf.length/1024/1024).toFixed(1)} MB`);

// Parse outer tar
const outerEntries = readTarEntries(zlib.gunzipSync(fpkBuf));
const tgzEntry = outerEntries.find(e => e.fullName === 'app.tgz');
if (!tgzEntry) { console.error('No app.tgz!'); process.exit(1); }

// Decompress inner app.tgz
const outerGz = zlib.gunzipSync(fpkBuf);
const innerTarData = outerGz.subarray(tgzEntry.dataStart, tgzEntry.dataStart + tgzEntry.size);

// Collect all existing tar parts (headers + data)
const existingParts = [];
let pos = 0;
while (pos < innerTarData.length - 512) {
    const nb = innerTarData.subarray(pos, pos + 100);
    const ni = nb.indexOf(0);
    const name = ni >= 0 ? nb.subarray(0, ni).toString('utf8') : '';
    if (!name) { pos += 512; continue; }
    const ss = innerTarData.subarray(pos + 124, pos + 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(ss, 8) || 0;
    const blockSize = 512 + Math.ceil(size / 512) * 512;
    existingParts.push(innerTarData.subarray(pos, pos + blockSize));
    pos += blockSize;
}
console.log(`Existing app.tgz entries: ${existingParts.length} blocks`);

// Add node_modules
console.log('Adding node_modules...');
const nmParts = [];
nmParts.push(makeHeader('server/node/node_modules', 0, '5'));
addDirToTar(nmParts, nmPath, 'server/node/node_modules');

// Combine: existing + node_modules + end blocks
const allParts = [...existingParts, ...nmParts];
// Add two empty 512-byte blocks to end tar
allParts.push(Buffer.alloc(1024, 0));

const newInnerTar = Buffer.concat(allParts);
console.log(`New inner tar: ${(newInnerTar.length/1024/1024).toFixed(1)} MB`);

// Compress inner tar -> new app.tgz
const newAppTgz = zlib.gzipSync(newInnerTar, { level: 9 });
console.log(`New app.tgz: ${(newAppTgz.length/1024/1024).toFixed(1)} MB`);

// Rebuild outer tar with new app.tgz
const outerParts = [];
let opos = 0;
const outerTarRaw = outerGz;
while (opos < outerTarRaw.length - 512) {
    const nb = outerTarRaw.subarray(opos, opos + 100);
    const ni = nb.indexOf(0);
    const name = ni >= 0 ? nb.subarray(0, ni).toString('utf8') : '';
    if (!name) { opos += 512; continue; }
    const ss = outerTarRaw.subarray(opos + 124, opos + 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = parseInt(ss, 8) || 0;
    const bsize = 512 + Math.ceil(size / 512) * 512;

    if (name === 'app.tgz') {
        // Replace with new app.tgz
        const newHeader = makeHeader('app.tgz', newAppTgz.length);
        outerParts.push(newHeader);
        outerParts.push(newAppTgz);
        const pad = 512 - (newAppTgz.length % 512);
        if (pad < 512) outerParts.push(Buffer.alloc(pad, 0));
    } else {
        outerParts.push(outerTarRaw.subarray(opos, opos + bsize));
    }
    opos += bsize;
}
outerParts.push(Buffer.alloc(1024, 0));

const newOuterTar = Buffer.concat(outerParts);
const newFpk = zlib.gzipSync(newOuterTar, { level: 9 });

fs.writeFileSync(outPath, newFpk);
console.log(`\nDone! New FPK: ${(newFpk.length/1024/1024).toFixed(1)} MB`);
console.log(`Saved to: ${outPath}`);
