const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// 仅允许本地访问日志
function checkLocalAccess(req, res) {
  const ip = req.ip || '';
  // 兼容 IPv4 / IPv6 / IPv4-mapped IPv6 (::ffff:127.0.0.1)
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    || ip.startsWith('192.168.') || ip.startsWith('10.')
    || ip.startsWith('::ffff:192.168.') || ip.startsWith('::ffff:10.')
    || ip.startsWith('172.16.') || ip.startsWith('172.17.') || ip.startsWith('172.18.')
    || ip.startsWith('172.19.') || ip.startsWith('172.20.') || ip.startsWith('172.21.')
    || ip.startsWith('172.22.') || ip.startsWith('172.23.') || ip.startsWith('172.24.')
    || ip.startsWith('172.25.') || ip.startsWith('172.26.') || ip.startsWith('172.27.')
    || ip.startsWith('172.28.') || ip.startsWith('172.29.') || ip.startsWith('172.30.')
    || ip.startsWith('172.31.') || ip.startsWith('::ffff:172.');
  if (!isLocal) {
    res.json({ code: 1001, data: null, message: '仅允许本地访问' });
    return false;
  }
  return true;
}

router.get('/logs', (req, res) => {
  if (!checkLocalAccess(req, res)) return;
  try {
    const lineCount = Math.min(Math.max(1, parseInt(req.query.lines) || 200), 5000);
    const logFile = process.env.TRIM_PKGVAR
      ? path.join(process.env.TRIM_PKGVAR, 'info.log')
      : null;

    let logs = '';

    if (logFile && fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n').filter(Boolean);
      logs = allLines.slice(-lineCount).join('\n');
    }

    res.json({
      code: 0,
      data: {
        logs: logs,
        stdout: '',
        pid: process.pid,
        uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
        node_version: process.version,
      },
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 0, data: { logs: error.message, stdout: '', pid: process.pid, uptime: Math.floor(process.uptime()), memory: '-', node_version: process.version }, message: 'success' });
  }
});

router.delete('/logs', (req, res) => {
  if (!checkLocalAccess(req, res)) return;
  try {
    const logFile = process.env.TRIM_PKGVAR
      ? path.join(process.env.TRIM_PKGVAR, 'info.log')
      : null;
    if (logFile && fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, '');
    }
    res.json({ code: 0, data: null, message: '日志已清空' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
