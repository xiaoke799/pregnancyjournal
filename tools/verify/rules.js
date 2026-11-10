/**
 * tools/verify/rules.js —— 「改了什么 → 要跑什么 / 能不能自动合」的**单一真源**
 *
 * 为什么单独抽出来（2026-11-10）：
 *   同一张表被三处要用：本地闸门（gate.js）、PR 自动审查（tools/ci/pr-review.js）、
 *   自动合并判定（tools/ci/auto-merge.js）。复制三份必然漂移 —— 这个仓库已经因为
 *   「两个平行实现」吃过多次亏（LESSONS L-004）。
 *
 * 三种规格别混：
 *   · RULES      —— 改了什么 ⇒ 该跑哪些套件（**建议**，不是门禁）
 *   · HIGH_RISK  —— 改了什么 ⇒ **必须人审 / 禁止自动合并**（硬红线）
 *   · SELF_PATH  —— 验证脚本自身，不反向触发业务套件
 */

// ---------------------------------------------------------------------------
// 一、改动 → 必跑套件
//   · suites 里的名字必须与 run_all_suites.js 的 SUITES **精确一致**（文件名去 .js）
//     拼错会被 runner 的 fail-closed 拦下（exit 2），不会静默跳过。
//   · scripts 是本目录里能直接 node 跑的单脚本（不是 SUITES 成员）。
//   · manual 是「本机才能跑、只能手工」的检查，只提示不执行。
//   · 新增规则时问一句：这条规则能不能说出「哪一类事故会因为它漏掉」。
// ---------------------------------------------------------------------------
const RULES = [
  {
    id: 'db-persist',
    match: /^app\/server\/node\/(db\.js|config\.js|services\/(db|persist|storage|crash)[^/]*\.js)$/i,
    suites: ['verify_db_persist', 'verify_write_persist', 'probe_write_durability', 'probe_async_save_race', 't9_verify_db_fixes', 't15_crash_flush'],
    why: '内存 SQLite 落盘：saveDb / reloadFromFile / lockDb 时序（一次踩错就是整段数据丢）',
  },
  {
    id: 'backup-restore',
    match: /^app\/server\/node\/(export\.js|routes\/(export|backup|restore)[^/]*\.js|services\/(export|backup|restore)[^/]*\.js)$/i,
    suites: ['verify_backup_schema_coverage', 'e2e_backup_field_coverage', 'e2e_backup_all_fields'],
    why: '备份/恢复白名单：新字段漏登记 ⇒ 恢复后永久变 null（极难发现）',
  },
  {
    id: 'routes',
    match: /^app\/server\/node\/routes\/[^/]+\.js$/i,
    suites: ['verify_api_contracts'],
    why: '前后端路径契约：`/lab_results` vs `/lab-results` 这类全 404',
  },
  {
    id: 'upload-path',
    match: /(^app\/server\/node\/routes\/(upload|photo|checkup)[^/]*\.js$)|multer/i,
    suites: ['verify_upload_field_names', 'verify_path_traversal'],
    why: '上传字段名契约 + 路径穿越（前端传 file / 后端收 image ⇒ 100% 不可用但返 200）',
  },
  {
    id: 'push',
    match: /(^app\/server\/node\/(services\/push|routes\/push)[^/]*\.js$)|wecom|feishu|dingtalk|bark/i,
    suites: ['test_wecom_push', 'test_wecom_scheduler', 'test_feishu_push', 'test_dingtalk_push', 'test_bark_push'],
    why: '四个渠道的加签/成功判据各不相同（钉钉加签 ≠ 飞书加签；Bark 要 2xx 且 code===200）',
  },
  {
    id: 'push-schedule-source',
    // 只认后端侧 + 排期 json。原先写 `schedule` 会命中前端的 `CheckupScheduleView.vue`
    // ⇒ 改个产检页的样式也会拉去跑"推送数据源影响面"，纯噪音。
    match: /^app\/server\/node\/.*(schedule|reminder).*\.js$|schedule.*\.json$/i,
    suites: ['probe_push_schedule_impact'],
    why: '推送排期四表（pregnancy / schedule_dates / custom_checkup / reminder）的影响面',
  },
  {
    id: 'dose',
    match: /dose/i,
    suites: ['verify_dose_rules', 'verify_dose_plan', 'verify_dose_push'],
    why: '医嘱计划 / 打卡幂等 / 到点只推该推的',
  },
  {
    id: 'contraction',
    match: /(contraction|fetal|session)/i,
    suites: ['e2e_session_rollup', 'probe_contraction_manual_time', 'probe_session_resume', 'probe_contraction_active_stale'],
    why: '胎动/宫缩：分 vs 秒差 60 倍、空会话不许清零手填值、中途退出要能接回',
  },
  {
    id: 'checkup',
    match: /checkup/i,
    suites: ['e2e_checkup_migration', 'verify_checkup_sorting'],
    why: '产检排期、老用户迁移、排序',
  },
  {
    id: 'datetime',
    // 起因（2026-11-10）：外部 PR#5 改的正是 logger 时间戳与 format.ts 日期格式化，
    // 而规则表里**一条都没有覆盖到** —— 而 L-019 明确记着「UTC 与本地日期混用会差一天」。
    // verify_dose_rules 自带 TZ=Asia/Shanghai，是全项目唯一能抓时区错的那套。
    match: /(^frontend\/src\/utils\/(format|date|time|day)[^/]*\.(ts|js)$)|(^app\/server\/node\/(logger|config)\.js$)|(^app\/server\/node\/utils\/(date|time)[^/]*\.js$)/i,
    suites: ['verify_dose_rules', 'verify_frontend_types'],
    why: '时间/日期口径：SQLite 的 CURRENT_TIMESTAMP 是 UTC，与本地日期混用会差一天（LESSONS L-019）',
  },
  {
    id: 'record-domain',
    match: /(record|quicklog|clinical-standards)/i,
    suites: ['verify_record_entrypoints', 'verify_record_page_functions', 'verify_naive_vmodel'],
    why: '记录类入口/取值域唯一真源/字段往返；naive-ui 绑定名（裸 v-model 会静默失效）',
  },
  {
    id: 'frontend-types',
    match: /^frontend\/src\/.*\.(ts|tsx|js|vue)$/i,
    suites: ['verify_frontend_types', 'verify_template_vars'],
    why: '类型 0 错误（常驻噪音会让真错误淹没）+ 模板变量防 Undefined',
  },
  {
    id: 'frontend-view',
    match: /^frontend\/src\/(views|components|layouts)\/.*\.vue$/i,
    suites: ['verify_render'],
    why: '15 页渲染：改模板必跑',
  },
  {
    id: 'theme',
    match: /(variables\.css|global\.css|App\.vue|theme|token)/i,
    suites: ['probe_theme_tokens', 'verify_dark_mode'],
    why: '幽灵令牌 / 硬写亮色 / 深色接线（退化后构建不报错、测试不红）',
  },
  {
    id: 'version',
    match: /^(manifest|CHANGELOG\.md|build\.ps1)$|(^|\/)(package|package-lock)\.json$/i,
    suites: ['verify_pkg_versions'],
    why: '版本号 8 处同步（manifest 是唯一真源）',
  },
  {
    id: 'ui-artifact',
    match: /^app\/ui\//i,
    suites: ['verify_ui_orphans'],
    why: '产物孤儿 + 多余 html（调试产物会废掉这项检查）',
  },
  {
    id: 'cmd-hook',
    match: /^cmd\//i,
    suites: [],
    manual: ['bash tools/verify/test_upgrade_init.sh'],
    why: '升级抢救钩子的本机仿真（不在汇总运行器里）',
  },
  {
    id: 'rule-docs',
    match: /^(LESSONS\.md|AGENTS\.md|CLAUDE\.md|docs\/(code-standards|review-protocol|workflow|workflow-automation|known-issues)\.md)$/i,
    suites: ['selftest'],
    // scripts 与 suites 的区别：这些是**本目录里能直接 node 跑**的单脚本（不是 SUITES 成员）。
    // 有它才不至于"改了一堆规范，闸门什么都没检查"。
    scripts: ['tools/verify/lessons.js'],
    why: '错题本与规范自身的一致性（Seen 阈值、PROMOTED 锚点）；known-issues 的结构由 selftest 校验',
  },
  {
    id: 'bot-self',
    match: /^tools\/ci\//i,
    suites: ['selftest'],
    why: '审查/合并/回复机器人自身 —— 判定写反不会报错只会安静放行，必须每次自证',
  },
  {
    id: 'ci-config',
    match: /^\.github\//i,
    suites: [],
    manual: [
      'python -c "import yaml;yaml.safe_load(open(\'.github/workflows/verify.yml\'))"  # 语法',
      '人工确认：触发条件 / concurrency 表达式 / 是否又把全量塞进 CI',
    ],
    why: 'CI 配置在本机跑不了 —— 只能静态校验；一旦取消 main 的「禁止并发取消」，等于拆掉物理急刹',
  },
  {
    id: 'verify-self',
    match: /^tools\/verify\//i,
    suites: [],
    manual: ['node tools/verify/gate.js --self'],
    why: '验证脚本自身改动：语法检查 + 两套快检（改了套件逻辑另跑全量）',
  },
];

// ---------------------------------------------------------------------------
// 二、高危路径：**禁止自动合并**，必须人看一眼
//   判定理由不是"代码难不难"，而是"错了以后能不能救回来"：
//   能靠 git revert 救的（普通业务代码）可以自动合；救不回来的（数据、闸门、发版链）不行。
// ---------------------------------------------------------------------------
const HIGH_RISK = [
  { match: /^\.github\//i, reason: 'CI / 审查配置 —— 改了它等于改闸门本身（自己给自己发通行证）' },
  { match: /^cmd\//i, reason: 'fnOS 生命周期钩子（升级抢救），写错一次会丢用户数据' },
  { match: /^manifest$|^build\.ps1$/i, reason: '版本真源与打包流程' },
  { match: /^app\/server\/node\/(db\.js|config\.js)$/i, reason: '落盘与路径配置（内存库快照语义）' },
  { match: /^tools\/verify\//i, reason: '验证能力本体 —— 允许外部改它，等于允许改考卷' },
  { match: /^tools\/ci\//i, reason: '审查/合并机器人自身' },
  { match: /^data\//i, reason: '运行时数据不该出现在版本库' },
  { match: /(^|\/)package-lock\.json$/i, reason: '依赖锁定：手工改 lock 是供应链风险' },
  { match: /^(scripts|hooks)\//i, reason: '自动化脚本' },
];

/** 验证脚本自身：不反向触发它要验的业务套件 */
const SELF_PATH = /^tools\/verify\//;

/**
 * 按改动文件挑出该跑的检查。
 * @param {string[]} files 仓库相对路径（正斜杠）
 */
function pick(files) {
  const hits = [];
  const suites = [];
  const scripts = [];
  const manual = [];

  for (const rule of RULES) {
    const scope = rule.id === 'verify-self' ? files : files.filter(f => !SELF_PATH.test(f));
    const matched = scope.filter(f => rule.match.test(f));
    if (!matched.length) continue;
    hits.push({ rule, matched });
    for (const s of rule.suites || []) if (!suites.includes(s)) suites.push(s);
    for (const s of rule.scripts || []) if (!scripts.includes(s)) scripts.push(s);
    for (const m of rule.manual || []) if (!manual.includes(m)) manual.push(m);
  }
  return { hits, suites, scripts, manual };
}

/** 命中高危路径的文件（去重，带理由） */
function findHighRisk(files) {
  const out = [];
  for (const f of files) {
    for (const h of HIGH_RISK) {
      if (h.match.test(f)) {
        if (!out.some(x => x.path === f)) out.push({ path: f, reason: h.reason });
        break;
      }
    }
  }
  return out;
}

/**
 * Git 对非 ASCII / 含空格路径的写法：加双引号 + 八进制转义（`"a/docs/\346\226\207.md"`）。
 * 不还原的话，中文文件名的改动会**整个从列表里消失** —— 高危路径漏检就是这么来的。
 */
function unquoteGitPath(s) {
  const raw = String(s || '').trim();
  if (!raw.startsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const bytes = [];
  const SIMPLE = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      const oct = body.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(oct)) { bytes.push(parseInt(oct, 8)); i += 3; continue; }
      const nxt = body[i + 1];
      if (nxt in SIMPLE) { bytes.push(SIMPLE[nxt]); i += 1; continue; }
      bytes.push(92);
      continue;
    }
    for (const b of Buffer.from(ch, 'utf8')) bytes.push(b);
  }
  return Buffer.from(bytes).toString('utf8');
}

/** 去掉 `a/` `b/` 前缀 */
function stripPrefix(p) {
  const s = String(p || '');
  return /^[ab]\//.test(s) ? s.slice(2) : s;
}

/**
 * 把 diff 文本拆成「每个文件的增删行」。
 *
 * ⚠️ 三个踩过的坑（2026-11-10 第二轮对抗验证实测）：
 *   ① **CRLF**：Windows 保存的 diff 每行以 `\r` 结尾，`(.+)` 会把 `\r` 吃进路径 ⇒
 *      文件列表里是 `.github/workflows/x.yml\r`，规则匹配全部失效、高危路径直接漏检。
 *   ② **带引号的转义路径**：Git 对中文文件名写 `"a/docs/\346..."`，裸正则抓不到 ⇒ 整个文件消失。
 *   ③ **只看 `diff --git` 行**：纯重命名（rename from/to）、模式变更没有 `+++` 行，
 *      路径得从 `rename to` 或头部行兜底取。
 *
 * 现在的口径：以 `diff --git` 建记录，用 `+++ b/` / `rename to` 覆盖路径，头部行兜底。
 */
function parseDiffStats(diffText) {
  const files = [];
  let cur = null;
  const flush = () => { if (cur && cur.path) files.push(cur); };

  const headerPath = line => {
    const rest = line.slice('diff --git '.length).trim();
    const quoted = /^("(?:[^"\\]|\\.)*")\s+("(?:[^"\\]|\\.)*")$/.exec(rest);
    if (quoted) return stripPrefix(unquoteGitPath(quoted[2]));
    const i = rest.lastIndexOf(' b/');
    if (i > 0) return rest.slice(i + 3);
    return '';
  };

  for (const raw of String(diffText || '').split('\n')) {
    const line = raw.replace(/\r$/, '');   // ① CRLF

    if (line.startsWith('diff --git ')) {
      flush();
      cur = { path: headerPath(line), added: 0, removed: 0, binary: false };
      continue;
    }
    if (!cur) continue;

    if (line.startsWith('Binary files ')) { cur.binary = true; continue; }
    // ② ③ 先处理带前缀的元信息行，再统计 +/-（否则 `+++` 会被当成新增行）
    if (line.startsWith('rename to ')) {
      cur.path = stripPrefix(unquoteGitPath(line.slice(10)));
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      if (p !== '/dev/null') {
        const np = stripPrefix(unquoteGitPath(p));
        if (np) cur.path = np;
      }
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('index ') || line.startsWith('new file ')
      || line.startsWith('deleted file ') || line.startsWith('similarity index ')
      || line.startsWith('old mode ') || line.startsWith('new mode ')) {
      continue;
    }

    if (line.startsWith('+')) cur.added++;
    else if (line.startsWith('-')) cur.removed++;
  }
  flush();
  return files;
}

module.exports = { RULES, HIGH_RISK, SELF_PATH, pick, findHighRisk, parseDiffStats, unquoteGitPath };
