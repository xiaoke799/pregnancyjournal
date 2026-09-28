/**
 * 相册「视频」备份/恢复落点 e2e（2026-09-26 新增）
 *
 * 防的是什么（旧缺陷）：
 *   备份 POST /backup 把**所有** pregnancy_photo（含视频）都塞进 files/album/；
 *   恢复时 files/album/ → PHOTOS_DIR，但数据库里视频路径又被改写到 MEDIA_DIR。
 *   结果：恢复后文件在 photos/、记录指向 media/ —— 只能靠 media-backfill 的文件名自愈兜底。
 *   修复后：备份按 media_type 分流（图片→files/album、视频→files/media），恢复各归各位。
 *
 * 覆盖点：
 *   1. 视频上传落在 MEDIA_DIR、图片落在 PHOTOS_DIR（前置事实基线）
 *   2. 备份目录结构：视频进 files/media/、图片进 files/album/；data.json._file_map 对应分流
 *   3. 删掉文件 + 记录后恢复 → 视频真的回到 MEDIA_DIR 且记录路径指向它（不再依赖自愈）
 *   4. 向后兼容：**旧布局**备份（视频在 files/album/、_file_map.album）仍能恢复、不丢文件
 *
 * 用法：node e2e_video_backup.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
const T = path.join(os.tmpdir(), 'pj-video-e2e');
const PORT = Number(process.env.PJ_TCP_PORT || 38491);
const AUTH_DIR = path.join(T, 'authorized');
const PHOTOS_DIR = path.join(T, 'photos');
const MEDIA_DIR = path.join(T, 'media');

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(AUTH_DIR, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T,
  DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR,
  MEDIA_DIR,
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: path.join(ROOT, 'app/ui'),
  TRIM_DATA_ACCESSIBLE_PATHS: AUTH_DIR,
};

function req(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, json: null, raw: data }); } });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

/** 手工拼 multipart/form-data（不引第三方依赖） */
function uploadMulti(fileName, mime, buf, fields) {
  const boundary = '----pjvid' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`));
  parts.push(buf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: PORT, path: '/api/v1/photos', method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, (res) => {
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, json: null, raw: d }); } });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  [OK]   ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${extra ? '  ← ' + extra : ''}`); }
}
const under = (p, dir) => !!p && path.resolve(p).startsWith(path.resolve(dir) + path.sep);

(async () => {
  const srvLog = [];
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], { cwd: NODE_DIR, env });
  child.stdout.on('data', (d) => srvLog.push(String(d)));
  child.stderr.on('data', (d) => srvLog.push(String(d)));

  for (let i = 0; i < 40; i++) {
    try { const h = await req('GET', '/api/health'); if (h.json && h.json.status === 'ok') break; } catch {}
    await sleep(500);
  }

  try {
    const p = await req('POST', '/api/v1/pregnancies', { last_period_date: '2026-01-01', baby_name: '视频备份测试' });
    const pid = p.json && p.json.data && p.json.data.id;
    if (!pid) throw new Error('建孕期失败: ' + JSON.stringify(p.json));

    console.log('\n########## 1. 上传一个「视频」和一个「图片」 ##########');
    // 内容是否为真 mp4/jpg 不重要：路由按 Content-Type 判定媒体类型，不校验magic bytes
    const vUp = await uploadMulti('movie.mp4', 'video/mp4', Buffer.from('FAKE_MP4_' + Date.now()), {
      pregnancy_id: pid, photo_type: 'milestone', photo_date: '2026-09-20', note: '视频',
    });
    const iUp = await uploadMulti('shot.jpg', 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
      pregnancy_id: pid, photo_type: 'milestone', photo_date: '2026-09-20', note: '图片',
    });
    const vRow = vUp.json && vUp.json.data;
    const iRow = iUp.json && iUp.json.data;
    check('视频上传成功且落在 MEDIA_DIR', !!vRow && vRow.media_type === 'video' && under(vRow.file_path, MEDIA_DIR),
      vRow ? vRow.file_path : JSON.stringify(vUp.json));
    check('图片上传成功且落在 PHOTOS_DIR', !!iRow && iRow.media_type !== 'video' && under(iRow.file_path, PHOTOS_DIR),
      iRow ? iRow.file_path : JSON.stringify(iUp.json));
    if (!vRow || !iRow) throw new Error('上传未返回记录');

    console.log('\n########## 2. 备份：检查视频/图片是否分流到不同子目录 ##########');
    const bk = await req('POST', '/api/v1/backup', { dir: AUTH_DIR });
    check('备份成功', bk.json && bk.json.code === 0, JSON.stringify(bk.json && bk.json.message));
    const bkDir = bk.json && bk.json.data && bk.json.data.dir;
    const vName = path.basename(vRow.file_path);
    const iName = path.basename(iRow.file_path);
    check('视频进了 files/media/', bkDir ? fs.existsSync(path.join(bkDir, 'files', 'media', vName)) : false,
      bkDir ? path.join(bkDir, 'files', 'media', vName) : 'no bkDir');
    check('图片进了 files/album/', bkDir ? fs.existsSync(path.join(bkDir, 'files', 'album', iName)) : false,
      bkDir ? path.join(bkDir, 'files', 'album', iName) : 'no bkDir');
    const dataJson = path.join(bkDir || '', 'data.json');
    const raw = fs.existsSync(dataJson) ? JSON.parse(fs.readFileSync(dataJson, 'utf-8')) : null;
    check('data.json 的 _file_map.media 记录了视频', !!(raw && raw._file_map && raw._file_map.media && raw._file_map.media[vRow.file_path]));
    check('data.json 的 _file_map.album 记录了图片', !!(raw && raw._file_map && raw._file_map.album && raw._file_map.album[iRow.file_path]));

    console.log('\n########## 3. 删掉记录与文件 → 恢复 → 视频必须回到 MEDIA_DIR ##########');
    await req('DELETE', `/api/v1/photos/${vRow.id}`);
    await req('DELETE', `/api/v1/photos/${iRow.id}`);
    check('删除后视频文件已不在磁盘', !fs.existsSync(vRow.file_path));
    check('删除后图片文件已不在磁盘', !fs.existsSync(iRow.file_path));

    const rl = await req('POST', '/api/v1/restore', { dir: bkDir });
    check('恢复成功', rl.json && rl.json.code === 0, JSON.stringify(rl.json && rl.json.message));

    const list = await req('GET', `/api/v1/photos?pregnancy_id=${pid}`);
    const arr = (list.json && list.json.data && (list.json.data.items || list.json.data.list)) || (Array.isArray(list.json && list.json.data) ? list.json.data : []);
    const rv = arr.find((x) => x.media_type === 'video');
    const ri = arr.find((x) => x.media_type !== 'video');
    check('视频记录回来了', !!rv, JSON.stringify(arr.map((x) => x.media_type)));
    check('视频文件真的恢复到 MEDIA_DIR（不再靠自愈）', !!rv && under(rv.file_path, MEDIA_DIR) && fs.existsSync(rv.file_path),
      rv ? rv.file_path : 'no row');
    check('图片文件恢复到 PHOTOS_DIR', !!ri && under(ri.file_path, PHOTOS_DIR) && fs.existsSync(ri.file_path),
      ri ? ri.file_path : 'no row');

    console.log('\n########## 4. 向后兼容：旧布局备份（视频放在 files/album/）仍可恢复 ##########');
    const oldDir = path.join(AUTH_DIR, 'backup_OLD_LAYOUT');
    fs.mkdirSync(path.join(oldDir, 'files', 'album'), { recursive: true });
    const oldVName = 'old_video_' + Date.now() + '.mp4';
    fs.writeFileSync(path.join(oldDir, 'files', 'album', oldVName), Buffer.from('OLD_MP4'));
    // 造一条只有 pregnancy_photo 的备份（其余表不动，避免误清其它数据）
    const oldPid = pid;
    const oldVidId = 'oldvid_' + Date.now();
    const oldPath = path.join(MEDIA_DIR, '2026', '09', oldVName);
    const oldBackup = {
      version: '2.1.0', exported_at: new Date().toISOString(), app_name: 'pregnancyjournal',
      tables: { pregnancy_photo: [{ id: oldVidId, pregnancy_id: oldPid, photo_type: 'milestone', file_path: oldPath, thumbnail_path: oldPath, media_type: 'video', created_at: '2026-09-20', updated_at: '2026-09-20' }] },
      file_manifest: { total: 1, by_type: { album: 1 } },
      _file_map: { album: { [oldPath]: oldVName }, checkup_photos: {}, checkup_reports: {}, config: {} },
    };
    fs.writeFileSync(path.join(oldDir, 'data.json'), JSON.stringify(oldBackup, null, 2));

    const rl2 = await req('POST', '/api/v1/restore', { dir: oldDir });
    check('旧布局备份恢复不报错', rl2.json && rl2.json.code === 0, JSON.stringify(rl2.json && rl2.json.message));
    const oldLanded = fs.existsSync(path.join(PHOTOS_DIR, oldVName)) || fs.existsSync(oldPath);
    check('旧布局的视频文件没有丢（落在 PHOTOS_DIR，可由自愈找回）', oldLanded,
      'photos=' + fs.existsSync(path.join(PHOTOS_DIR, oldVName)) + ' media=' + fs.existsSync(oldPath));
  } catch (e) {
    fail++;
    console.log('\n[FATAL] ' + e.message);
    console.log(srvLog.join('').slice(-1500));
  }

  console.log(`\n================ 结果 ================\n总计 ${pass} 通过 / ${fail} 失败`);
  child.kill('SIGKILL');
  process.exit(fail === 0 ? 0 : 1);
})();
