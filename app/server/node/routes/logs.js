const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

router.get('/logs', (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 200;
    const logFile = process.env.TRIM_PKGVAR
      ? path.join(process.env.TRIM_PKGVAR, 'info.log')
      : null;

    let logs = '';

    if (logFile && fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf-8');
      const allLines = content.split('\n').filter(Boolean);
      logs = allLines.slice(-lines).join('\n');
    }

    const stdout = console._stdout
      ? console._stdout.toString().slice(-3000)
      : '';

    res.json({
      code: 0,
      data: {
        logs: logs,
        stdout: stdout,
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
