const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');

router.get('/app-config/setup_status', async (req, res) => {
  try {
    const setupConfig = await db.queryOne(
      "SELECT * FROM app_config WHERE key = 'setup_completed'"
    );
    const storageDirConfig = await db.queryOne(
      "SELECT * FROM app_config WHERE key = 'storage_dir'"
    );
    const stageConfig = await db.queryOne(
      "SELECT * FROM app_config WHERE key = 'stage'"
    );

    const isSetupComplete = setupConfig && setupConfig.value === 'true';

    res.json({
      code: 0,
      data: {
        is_setup_complete: isSetupComplete,
        stage: stageConfig ? stageConfig.value : null,
        storage_dir: storageDirConfig ? storageDirConfig.value : null
      },
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/app-config/paths', (req, res) => {
  try {
    const pathsStr = config.TRIM_DATA_SHARE_PATHS || '[]';
    let paths = [];
    try {
      paths = JSON.parse(pathsStr);
    } catch (e) {
      paths = [];
    }

    const availablePaths = paths.map(p => ({
      path: p.path || p,
      label: p.label || path.basename(p.path || p),
      is_writable: fs.existsSync(p.path || p)
    }));

    res.json({ code: 0, data: { paths: availablePaths }, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/app-config/storage_dir', async (req, res) => {
  try {
    const row = await db.queryOne(
      "SELECT * FROM app_config WHERE key = 'storage_dir'"
    );
    res.json({
      code: 0,
      data: { storage_dir: row ? row.value : config.DATA_DIR },
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/app-config', async (req, res) => {
  try {
    const configs = await db.queryAll('SELECT * FROM app_config ORDER BY key ASC');
    const configObj = {};
    configs.forEach(c => {
      configObj[c.key] = c.value;
    });
    res.json({ code: 0, data: configObj, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/app-config/:key', async (req, res) => {
  try {
    const key = req.params.key;
    const row = await db.queryOne(
      'SELECT * FROM app_config WHERE key = ?', [key]
    );
    if (!row) {
      return res.json({ code: 1001, data: null, message: `配置项${key}不存在` });
    }
    res.json({ code: 0, data: { key: row.key, value: row.value }, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/app-config', async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.json({ code: 1001, data: null, message: '缺少key参数' });
    }

    const existing = await db.queryOne(
      'SELECT id FROM app_config WHERE key = ?', [key]
    );

    if (existing) {
      await db.run(
        'UPDATE app_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [value, existing.id]
      );
    } else {
      const id = db.generateId();
      await db.run(
        'INSERT INTO app_config (id, key, value, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        [id, key, value]
      );
    }

    res.json({ code: 0, data: { key, value }, message: '保存成功' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/app-config/setup', async (req, res) => {
  try {
    const { storage_dir, stage, baby_name, last_period_date, due_date } = req.body;

    if (storage_dir) {
      const existingDir = await db.queryOne(
        "SELECT id FROM app_config WHERE key = 'storage_dir'"
      );
      if (existingDir) {
        await db.run("UPDATE app_config SET value = ? WHERE id = ?", [storage_dir, existingDir.id]);
      } else {
        const id = db.generateId();
        await db.run(
          "INSERT INTO app_config (id, key, value, created_at) VALUES (?, 'storage_dir', ?, CURRENT_TIMESTAMP)",
          [id, storage_dir]
        );
      }
    }

    if (stage) {
      const existingStage = await db.queryOne(
        "SELECT id FROM app_config WHERE key = 'stage'"
      );
      if (existingStage) {
        await db.run("UPDATE app_config SET value = ? WHERE id = ?", [stage, existingStage.id]);
      } else {
        const id = db.generateId();
        await db.run(
          "INSERT INTO app_config (id, key, value, created_at) VALUES (?, 'stage', ?, CURRENT_TIMESTAMP)",
          [id, stage]
        );
      }
    }

    if (baby_name || last_period_date || due_date) {
      const pregnancyId = db.generateId();
      const existingPregnancy = await db.queryOne(
        'SELECT id FROM pregnancy LIMIT 1'
      );

      if (existingPregnancy) {
        const updates = [];
        const params = [];
        if (baby_name) { updates.push('baby_name = ?'); params.push(baby_name); }
        if (last_period_date) { updates.push('last_period_date = ?'); params.push(last_period_date); }
        if (due_date) { updates.push('due_date = ?'); params.push(due_date); }
        params.push(existingPregnancy.id);
        if (updates.length > 0) {
          await db.run(`UPDATE pregnancy SET ${updates.join(', ')} WHERE id = ?`, params);
        }
      } else {
        await db.run(
          'INSERT INTO pregnancy (id, baby_name, last_period_date, due_date, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [pregnancyId, baby_name || null, last_period_date || null, due_date || null]
        );
      }
    }

    const existingSetup = await db.queryOne(
      "SELECT id FROM app_config WHERE key = 'setup_completed'"
    );
    if (existingSetup) {
      await db.run("UPDATE app_config SET value = 'true' WHERE id = ?", [existingSetup.id]);
    } else {
      const id = db.generateId();
      await db.run(
        "INSERT INTO app_config (id, key, value, created_at) VALUES (?, 'setup_completed', 'true', CURRENT_TIMESTAMP)",
        [id]
      );
    }

    res.json({ code: 0, data: { is_setup_complete: true }, message: '设置完成' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.post('/app-config/check-path', (req, res) => {
  try {
    const { path: checkPath } = req.body;
    if (!checkPath) {
      return res.json({ code: 1001, data: null, message: '缺少path参数' });
    }

    const resolvedPath = path.resolve(checkPath);
    // 兼容两种 TRIM_DATA_SHARE_PATHS 格式：冒号分隔字符串（fnOS标准）和 JSON 数组
    const allowedRoots = [];
    const rawPaths = process.env.TRIM_DATA_SHARE_PATHS || '';
    if (rawPaths) {
      // 尝试 JSON 解析（app-config/paths 接口使用此格式）
      try {
        const parsed = JSON.parse(rawPaths);
        if (Array.isArray(parsed)) {
          for (const p of parsed) {
            allowedRoots.push(typeof p === 'string' ? p : (p.path || ''));
          }
        }
      } catch {
        // JSON 解析失败，按冒号分隔处理（export.js 使用此格式）
        for (const p of rawPaths.split(':')) {
          if (p.trim()) allowedRoots.push(p.trim());
        }
      }
    }
    // 也允许应用数据目录
    allowedRoots.push(path.join(process.cwd(), 'data'));
    const isAllowed = allowedRoots.some(root => {
      if (!root) return false;
      const resolvedRoot = path.resolve(root);
      return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + path.sep);
    });
    if (!isAllowed) {
      return res.json({ code: 1001, data: null, message: '不允许访问该路径，超出授权范围' });
    }

    const exists = fs.existsSync(checkPath);
    let isWritable = false;
    let errorMsg = null;

    if (exists) {
      try {
        const testFile = path.join(checkPath, '.write_test_' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        isWritable = true;
      } catch (e) {
        isWritable = false;
        errorMsg = e.message;
      }
    } else {
      try {
        fs.mkdirSync(checkPath, { recursive: true });
        const testFile = path.join(checkPath, '.write_test_' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        isWritable = true;
      } catch (e) {
        isWritable = false;
        errorMsg = e.message;
      }
    }

    res.json({
      code: 0,
      data: {
        path: checkPath,
        exists,
        is_writable: isWritable,
        error: errorMsg
      },
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
