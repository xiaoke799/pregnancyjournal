/**
 * 端到端验证：产检排期「国标校正 + 合并」之后的【老用户数据兼容性】
 *
 * 验证点（都在真 server + 真库 + 真 HTTP 上跑）：
 *   T1 未设置孕期时 GET /checkup-schedule 仍返回完整排期（不再 1001），修复"产检页空白"回归
 *   T2 子项【同条目内改名】：老名字的报告读回时被归一到现名，且带 sub_item_original
 *   T3 归一【不改写数据库】：第二次读取 sub_item_original 依然是旧名（说明库里存的一直是旧名）
 *   T4 子项【已下架】：读回时原样保留旧名（绝不乱改用户数据），前端会归入「其他报告」
 *   T5 完成状态【按条目 id 命中】：模拟老记录 week=5 + notes 含 [cs_001] → cs_001 显示已完成
 *   T6 反例【不误判】：week=5 但 notes 不含"从产检时间表标记完成" → cs_001 仍为未完成
 *
 * 用法：node e2e_checkup_migration.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = require('./_env').REPO;
const NODE_DIR = path.join(ROOT, 'app/server/node');
const T = path.join(os.tmpdir(), 'pj-e2e-migrate');
const PORT = Number(process.env.PJ_TCP_PORT || 38483);

fs.rmSync(T, { recursive: true, force: true });
fs.mkdirSync(T, { recursive: true });

const env = {
  ...process.env,
  APP_MODE: 'dev',
  FNOS_SOCKET_PATH: path.join(T, 'a.sock'),
  PJ_TCP_PORT: String(PORT),
  STORAGE_DIR: T,
  DATABASE_PATH: path.join(T, 'pj.db'),
  PHOTOS_DIR: path.join(T, 'photos'),
  MEDIA_DIR: path.join(T, 'media'),
  BACKUPS_DIR: path.join(T, 'backups'),
  DATA_DIR: T,
  LOG_DIR: path.join(T, 'logs'),
  STATIC_DIR: path.join(ROOT, 'app/ui'),
  // 刻意不设 ASSETS_DIR：让服务读它自带的 app/server/node/data（含排期表与别名表）
};

function req(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, raw: data.slice(0, 300) });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function multipart(fields, fileField, filename, contentType, fileBuf) {
  const B = '----pjmig' + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${B}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  ));
  parts.push(fileBuf);
  parts.push(Buffer.from(`\r\n--${B}--\r\n`));
  return { body: Buffer.concat(parts), ct: `multipart/form-data; boundary=${B}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OLD_CS009_GBS = 'GBS筛查(如24-28周未做则补做)(阴道拭子)';
const NEW_CS009_GBS = 'GBS筛查(35-37周)(阴道拭子)';
const RETIRED_CS005_GBS = 'GBS(B族链球菌)筛查(新指南推荐提前至24-28周)';

(async () => {
  const SHIM = path.join(require('./_env').VERIFY_DIR, 'tcp_shim.js');
  const child = spawn(process.execPath, ['-r', SHIM, path.join(NODE_DIR, 'server.js')], {
    cwd: NODE_DIR, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  child.stdout.on('data', (d) => (srvLog += d));
  child.stderr.on('data', (d) => (srvLog += d));
  const cleanup = () => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } };
  process.on('exit', cleanup);

  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { const r = await req('GET', '/api/v1/health'); if (r.status === 200) { ready = true; break; } } catch (e) { /* not up */ }
  }
  if (!ready) {
    console.log('服务未就绪。server 输出末尾：\n' + srvLog.slice(-1500));
    cleanup(); process.exit(2);
  }

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass, detail }); };

  // ---------- T1 未设置孕期也要有排期 ----------
  const noPid = await req('GET', '/api/v1/checkup-schedule');
  const noPidData = noPid.json && noPid.json.data;
  check('T1 无 pregnancy_id 时返回排期本体', noPid.json && noPid.json.code === 0 && Array.isArray(noPidData) && noPidData.length === 15,
    `code=${noPid.json && noPid.json.code} 条数=${Array.isArray(noPidData) ? noPidData.length : 'N/A'}`);
  check('T1 无孕期时完成状态全为 false', Array.isArray(noPidData) && noPidData.every(i => i.is_completed === false),
    Array.isArray(noPidData) ? `含 true 的条数=${noPidData.filter(i => i.is_completed).length}` : 'N/A');

  // 建孕期档案
  const p1 = await req('POST', '/api/v1/pregnancies', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_period_date: '2026-01-01', due_date: '2026-10-08' }),
  });
  let pid = p1.json && p1.json.data && p1.json.data.id;
  if (!pid) { const pa = await req('GET', '/api/v1/pregnancies/active'); pid = pa.json && pa.json.data && pa.json.data.id; }
  check('建孕期档案', !!pid, pid || JSON.stringify(p1.json).slice(0, 160));
  if (!pid) { console.log('无法建孕期档案，终止'); cleanup(); process.exit(2); }

  // ---------- T2/T3 同条目内改名：旧名读回归一 + 不写库 ----------
  const mpA = multipart({ checkup_type: 'standard', report_category: '其他', sub_item: OLD_CS009_GBS },
    'file', 'gbs.png', 'image/png', PNG);
  const upA = await req('POST', '/api/v1/checkups/cs_009/reports', {
    headers: { 'Content-Type': mpA.ct, 'Content-Length': mpA.body.length }, body: mpA.body,
  });
  check('T2 上传旧名 GBS 报告到 cs_009 成功', upA.json && upA.json.code === 0,
    `code=${upA.json && upA.json.code} message=${upA.json && upA.json.message}`);

  const readA1 = await req('GET', '/api/v1/checkups/cs_009/reports?checkup_type=standard');
  const rowA1 = readA1.json && Array.isArray(readA1.json.data) ? readA1.json.data[0] : null;
  check('T2 读回时 sub_item 已归一到现名', !!rowA1 && rowA1.sub_item === NEW_CS009_GBS,
    rowA1 ? `sub_item=${rowA1.sub_item}` : 'N/A');
  check('T2 同时保留 sub_item_original=旧名', !!rowA1 && rowA1.sub_item_original === OLD_CS009_GBS,
    rowA1 ? `sub_item_original=${rowA1.sub_item_original}` : 'N/A');

  const readA2 = await req('GET', '/api/v1/checkups/cs_009/reports?checkup_type=standard');
  const rowA2 = readA2.json && Array.isArray(readA2.json.data) ? readA2.json.data[0] : null;
  check('T3 第二次读取 sub_item_original 仍为旧名（库中未被改写）',
    !!rowA2 && rowA2.sub_item_original === OLD_CS009_GBS && rowA2.sub_item === NEW_CS009_GBS,
    rowA2 ? `sub_item=${rowA2.sub_item} / original=${rowA2.sub_item_original}` : 'N/A');

  // ---------- T4 已下架子项：原样保留，不猜映射 ----------
  const mpB = multipart({ checkup_type: 'standard', report_category: '其他', sub_item: RETIRED_CS005_GBS },
    'file', 'gbs_old.png', 'image/png', PNG);
  await req('POST', '/api/v1/checkups/cs_005/reports', {
    headers: { 'Content-Type': mpB.ct, 'Content-Length': mpB.body.length }, body: mpB.body,
  });
  const readB = await req('GET', '/api/v1/checkups/cs_005/reports?checkup_type=standard');
  const rowB = readB.json && Array.isArray(readB.json.data) ? readB.json.data[0] : null;
  check('T4 已下架子项的报告 sub_item 原样保留（不被乱改）',
    !!rowB && rowB.sub_item === RETIRED_CS005_GBS && rowB.sub_item_original === undefined,
    rowB ? `sub_item=${rowB.sub_item} / original=${rowB.sub_item_original}` : 'N/A');
  // 该名字确认已不在现排期的任何子项里 → 前端兜底会收进「其他报告」
  const schedNow = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid));
  const cs005 = (schedNow.json && Array.isArray(schedNow.json.data)) ? schedNow.json.data.find(i => i.id === 'cs_005') : null;
  const namesInCs005 = cs005 ? (cs005.items || []).map(x => (typeof x === 'string' ? x : x.name)) : [];
  check('T4 该旧名确实已不在 cs_005 现子项清单中（故走前端兜底）',
    namesInCs005.length > 0 && !namesInCs005.includes(RETIRED_CS005_GBS),
    `cs_005 现子项数=${namesInCs005.length}`);

  // ---------- T5 完成状态：模拟老用户 week=5 的记录 ----------
  const mk = await req('POST', '/api/v1/checkups', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pregnancy_id: pid, checkup_date: '2026-02-05', gestational_week: 5, checkup_type: 'standard',
      notes: '从产检时间表标记完成: 建档/建母子健康手册 [cs_001]',
      is_completed: 1, is_recommended: 1,
    }),
  });
  check('T5 造一条 week=5 的老式完成记录成功', mk.json && mk.json.code === 0,
    `code=${mk.json && mk.json.code} message=${mk.json && mk.json.message}`);

  const sched1 = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid));
  const cs001a = (sched1.json && Array.isArray(sched1.json.data)) ? sched1.json.data.find(i => i.id === 'cs_001') : null;
  check('T5 cs_001 现区间为 6-8 周（已按国标校正）', !!cs001a && cs001a.week_start === 6,
    cs001a ? `week_start=${cs001a.week_start} week_end=${cs001a.week_end}` : 'N/A');
  check('T5 老记录 week=5 已不在区间内，但仍显示已完成（按 id 兜底命中）',
    !!cs001a && cs001a.is_completed === true,
    cs001a ? `is_completed=${cs001a.is_completed}` : 'N/A');
  check('T5b 老记录的实际完成日期被纯读取推导出来（completed_at = 当初那条记录的日期）',
    !!cs001a && cs001a.completed_at === '2026-02-05',
    cs001a ? `completed_at=${cs001a.completed_at}` : 'N/A');

  // ---------- T7 真实「标记完成」流程：必须带回本地当天日期（不是 UTC 差一天） ----------
  const localToday = (() => {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  })();
  const doneRes = await req('PUT', '/api/v1/checkup-schedule/cs_010/complete?pregnancy_id=' + encodeURIComponent(pid));
  check('T7 调用「标记完成」成功', doneRes.json && doneRes.json.code === 0,
    `code=${doneRes.json && doneRes.json.code} message=${doneRes.json && doneRes.json.message}`);
  const sched3 = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid));
  const cs010 = (sched3.json && Array.isArray(sched3.json.data)) ? sched3.json.data.find(i => i.id === 'cs_010') : null;
  check('T7b 完成后 cs_010 的 completed_at = 本地当天（无 UTC 差一天）',
    !!cs010 && cs010.is_completed === true && cs010.completed_at === localToday,
    cs010 ? `is_completed=${cs010.is_completed} completed_at=${cs010.completed_at} 本地今天=${localToday}` : 'N/A');
  check('T7c 未完成条目 completed_at 为 null', (() => {
    const other = (sched3.json && Array.isArray(sched3.json.data)) ? sched3.json.data.find(i => i.id === 'cs_015') : null;
    return !!other && other.completed_at === null;
  })(), 'cs_015');

  // ---------- T6 反例：不带"标记完成"字样的 week=5 记录不得误判 ----------
  const pid2res = await req('POST', '/api/v1/pregnancies', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ last_period_date: '2026-02-01', due_date: '2026-11-08' }),
  });
  let pid2 = pid2res.json && pid2res.json.data && pid2res.json.data.id;
  if (!pid2) { const pa = await req('GET', '/api/v1/pregnancies/active'); pid2 = pa.json && pa.json.data && pa.json.data.id; }
  await req('POST', '/api/v1/checkups', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pregnancy_id: pid2, checkup_date: '2026-03-05', gestational_week: 5, checkup_type: 'standard',
      notes: '自己随便记的：聊到 [cs_001] 这事', is_completed: 1, is_recommended: 0,
    }),
  });
  const sched2 = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(pid2));
  const cs001b = (sched2.json && Array.isArray(sched2.json.data)) ? sched2.json.data.find(i => i.id === 'cs_001') : null;
  check('T6 非"标记完成"备注不被误判为完成', !!cs001b && cs001b.is_completed === false,
    cs001b ? `is_completed=${cs001b.is_completed}` : 'N/A');

  // ---------- T8 取消完成（撤销「标记完成」，误按兜底） ----------
  const del = (id, p) => req('DELETE', `/api/v1/checkup-schedule/${id}/complete?pregnancy_id=${encodeURIComponent(p)}`);
  const datesOf = async (p) => {
    const r = await req('GET', '/api/v1/checkup-schedule/dates?pregnancy_id=' + encodeURIComponent(p));
    return (r.json && r.json.data) || {};
  };
  const statusOf = async (p, id) => {
    const r = await req('GET', '/api/v1/checkup-schedule?pregnancy_id=' + encodeURIComponent(p));
    return (r.json && Array.isArray(r.json.data)) ? r.json.data.find(i => i.id === id) : null;
  };

  // T8：标记完成 → 取消完成 → 状态回退，且「标记完成」自动写的今天日期被清掉
  // ⚠️ 「今天」这笔完成日期是【前端 markComplete 补写的】（后端 PUT /complete 只建完成记录），
  //    所以这里要照着前端的真实顺序发两个请求，否则测的不是真实链路。
  await req('PUT', '/api/v1/checkup-schedule/cs_011/complete?pregnancy_id=' + encodeURIComponent(pid));
  await req('POST', '/api/v1/checkup-schedule/schedule-date', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pregnancy_id: pid, schedule_id: 'cs_011', date: localToday }),
  });
  const afterMark = await statusOf(pid, 'cs_011');
  const datesAfterMark = await datesOf(pid);
  check('T8 标记完成后 cs_011 完成且自动写入今天',
    !!afterMark && afterMark.is_completed === true && datesAfterMark.cs_011 === localToday,
    afterMark ? `is_completed=${afterMark.is_completed} date=${datesAfterMark.cs_011}` : 'N/A');

  const undoRes = await del('cs_011', pid);
  const afterUndo = await statusOf(pid, 'cs_011');
  const datesAfterUndo = await datesOf(pid);
  check('T8b 取消完成后 cs_011 回到未完成',
    undoRes.json && undoRes.json.code === 0 && !!afterUndo && afterUndo.is_completed === false && afterUndo.completed_at === null,
    afterUndo ? `code=${undoRes.json && undoRes.json.code} is_completed=${afterUndo.is_completed} completed_at=${afterUndo.completed_at}` : 'N/A');
  check('T8c 自动写入的完成日期被一并清掉（不会留下"未完成却有日期"的怪状态）',
    undoRes.json && undoRes.json.data && undoRes.json.data.date_cleared === localToday && datesAfterUndo.cs_011 === undefined,
    `date_cleared=${undoRes.json && undoRes.json.data && undoRes.json.data.date_cleared} 剩留=${datesAfterUndo.cs_011}`);

  // T8d【安全】用户手填的完成日期不能因为取消完成被删
  await req('POST', '/api/v1/checkup-schedule/schedule-date', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pregnancy_id: pid, schedule_id: 'cs_012', date: '2026-08-01' }),
  });
  await req('PUT', '/api/v1/checkup-schedule/cs_012/complete?pregnancy_id=' + encodeURIComponent(pid));
  const undo12 = await del('cs_012', pid);
  const afterUndo12 = await statusOf(pid, 'cs_012');
  const dates12 = await datesOf(pid);
  check('T8d 取消完成不删用户手填的完成日期（只有自动写的才清）',
    !!afterUndo12 && afterUndo12.is_completed === false &&
    undo12.json && undo12.json.data && undo12.json.data.date_cleared === null && dates12.cs_012 === '2026-08-01',
    `is_completed=${afterUndo12 && afterUndo12.is_completed} date_cleared=${undo12.json && undo12.json.data && undo12.json.data.date_cleared} 手填日期=${dates12.cs_012}`);

  // T8e 幂等：重复取消不报错
  const undo12b = await del('cs_012', pid);
  check('T8e 重复取消不报错（幂等）',
    undo12b.json && undo12b.json.code === 0 && undo12b.json.data && undo12b.json.data.changed === 0,
    `code=${undo12b.json && undo12b.json.code} changed=${undo12b.json && undo12b.json.data && undo12b.json.data.changed}`);

  // T8f【安全】用户自己添加的产检记录绝不能被「取消完成」改写
  const undoPid2 = await del('cs_001', pid2);
  const rowPid2 = await req('GET', '/api/v1/checkups?pregnancy_id=' + encodeURIComponent(pid2));
  // ⚠️ GET /checkups 返回的是 { list | items, total, ... } 分页对象，不是数组
  const pid2List = (rowPid2.json && rowPid2.json.data && (rowPid2.json.data.list || rowPid2.json.data.items)) || [];
  const selfRow = pid2List.filter(r => String(r.notes || '').indexOf('[cs_001]') !== -1)[0] || null;
  check('T8f 用户自填的产检记录不被取消完成波及（changed=0 且 is_completed 仍为 1）',
    undoPid2.json && undoPid2.json.code === 0 && undoPid2.json.data && undoPid2.json.data.changed === 0 &&
    !!selfRow && selfRow.is_completed === 1,
    `changed=${undoPid2.json && undoPid2.json.data && undoPid2.json.data.changed} is_completed=${selfRow && selfRow.is_completed}`);

  // T8g 自定义产检的标记/取消完成
  const mkCustom = await req('POST', '/api/v1/checkups/custom', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pregnancy_id: pid, name: '额外B超', checkup_date: '2026-08-20', notes: '' }),
  });
  const cid = mkCustom.json && mkCustom.json.data && mkCustom.json.data.id;
  await req('PUT', '/api/v1/checkups/custom/' + cid + '/complete');
  const cDone = await req('GET', '/api/v1/checkups/custom?pregnancy_id=' + encodeURIComponent(pid));
  const cRow1 = (cDone.json && Array.isArray(cDone.json.data)) ? cDone.json.data.find(c => c.id === cid) : null;
  const cUndo = await req('PUT', '/api/v1/checkups/custom/' + cid + '/uncomplete');
  const cDone2 = await req('GET', '/api/v1/checkups/custom?pregnancy_id=' + encodeURIComponent(pid));
  const cRow2 = (cDone2.json && Array.isArray(cDone2.json.data)) ? cDone2.json.data.find(c => c.id === cid) : null;
  check('T8g 自定义产检可标记完成、也可取消完成',
    !!cRow1 && cRow1.is_completed === 1 && cUndo.json && cUndo.json.code === 0 && !!cRow2 && cRow2.is_completed === 0,
    `标记后=${cRow1 && cRow1.is_completed} 取消后=${cRow2 && cRow2.is_completed} code=${cUndo.json && cUndo.json.code}`);

  // ---------- 收尾 ----------
  const pass = results.filter(r => r.pass).length;
  const fail = results.length - pass;
  console.log('\n================ 结果 ================');
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  || ${r.detail}`);
  console.log(`\n通过 ${pass} / ${results.length}，失败 ${fail}`);
  cleanup();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('脚本异常:', e); process.exit(3); });
