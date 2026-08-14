const fs = require('fs');

// Check both FPK files
const files = [
  { path: 'd:\\pregnancy-journal\\pregnancyjournal\\app\\pregnancyjournal.fpk', label: 'NEW (0.89MB)' },
  { path: 'd:\\pregnancy-journal\\pregnancyjournal\\pregnancyjournal.fpk', label: 'OLD (52MB)' }
];

for (const f of files) {
  try {
    const b = fs.readFileSync(f.path);
    console.log(`\n=== ${f.label} ===`);
    console.log('Size:', (b.length / 1024 / 1024).toFixed(2), 'MB');
    console.log('First 20 bytes hex:', Array.from(b.slice(0, 20)).map(x => x.toString(16).padStart(2,'0')).join(' '));
    console.log('First 20 bytes ascii:', b.slice(0, 20).toString('utf8').replace(/[^\x20-\x7e]/g, '.'));
    
    // Check if gzip
    const isGzip = b[0] === 0x1f && b[1] === 0x8b;
    console.log('Is GZIP:', isGzip);
    
    // Try to find "server" string in the file
    const content = b.toString('latin1');
    const serverIdx = content.indexOf('server');
    if (serverIdx >= 0) {
      console.log('Found "server" at offset', serverIdx, ':', JSON.stringify(content.slice(serverIdx, serverIdx + 50)));
    } else {
      console.log('"server" string NOT found in file');
    }
    
    // Find all top-level tar entries
    let o = 0;
    console.log('\nTop-level entries:');
    while (o < Math.min(b.length, 100000)) {
      const n = b.toString('utf8', o, o + 100).replace(/\0.*$/, '');
      if (!n || n.length === 0) { o += 512; continue; }
      const s = parseInt(b.toString('utf8', o + 124, o + 136).trim(), 8) || 0;
      console.log(`  ${n} (${s} bytes)`);
      o += 512 + Math.ceil(s / 512) * 512;
      if (o > 50000) { console.log('  ... (truncated)'); break; }
    }
  } catch(e) {
    console.log(`\n=== ${f.label} === ERROR:`, e.message);
  }
}
