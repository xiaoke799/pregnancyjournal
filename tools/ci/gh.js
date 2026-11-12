/**
 * tools/ci/gh.js —— GitHub API 最小客户端（只用内置 fetch，无第三方依赖）
 *
 * 抽出来的理由和 rules.js 一样：审查器、合并器、issue 回复都要调 API，
 * 各写一份的话，超时/错误处理/头信息迟早不一致（LESSONS L-004 的同类问题）。
 */
const DEFAULT_API = 'https://api.github.com';

/**
 * request 第三参数只允许这些配置键。
 * 🔴 这个断言是 2026-11-12 加的：当时 8 处写调用把「请求体」直接当第三参数传
 *    （`{ state: 'closed' }`、`{ body: comment }`），结果 POST/PATCH **发出空 body**，
 *    GitHub 要么 422、要么 200 但什么都没改 —— 而脚本从没真跑过，一直没暴露。
 *    有了这道防呆，写错会当场抛异常，而不是"看起来成功了"。
 */
const CONFIG_KEYS = new Set(['body', 'accept', 'raw', 'timeoutMs']);

/**
 * @param {object} o
 * @param {string} o.token   GITHUB_TOKEN 或 PAT
 * @param {string} o.repo    owner/repo
 * @param {string} [o.api]   覆盖 base url
 *
 * ⚠️ 默认值读 `GITHUB_API_URL` —— 这是 GitHub Actions 自己就会注入的标准变量
 *    （企业版指向自己的 API 域名）。好处有两个：
 *    ① 企业版不用改任何脚本就能用；
 *    ② 本地可以把整条链路指向一个假 API 做端到端验证（见 tools/ci/e2e-command.js）。
 *    在此之前只有 pr-review.js 自己读了它，其余脚本写死 api.github.com ——
 *    于是"离线跑一遍"对它们根本不可能，只能等真触发。
 */
function makeClient({ token, repo, api = process.env.GITHUB_API_URL || DEFAULT_API }) {
  if (!token) throw new Error('缺少 token');
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) throw new Error(`repo 格式应为 owner/repo，收到：${repo}`);

  async function request(method, p, opts = {}) {
    // 防呆 ①：第三参数是配置对象，不是请求体
    const stray = Object.keys(opts).filter(k => !CONFIG_KEYS.has(k));
    if (stray.length) {
      throw new TypeError(
        `gh.request 第三参数是配置对象，不支持字段 [${stray.join(', ')}]；` +
        `请求体请写成 { body: { ... } }（${method} ${p}）`
      );
    }
    // 防呆 ②：body 必须是对象，不能是裸字符串（会被 JSON.stringify 成一个 JSON 字符串）
    if (opts.body !== undefined && (typeof opts.body !== 'object' || opts.body === null)) {
      throw new TypeError(
        `gh.request 的 body 必须是对象，收到 ${typeof opts.body}；` +
        `发评论要写 { body: { body: text } }，不是 { body: text }（${method} ${p}）`
      );
    }
    const { body, accept = 'application/vnd.github+json', raw = false, timeoutMs = 30_000 } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${api}${p}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'pregnancyjournal-automation',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (raw) {
        if (!res.ok) throw new Error(`GitHub ${method} ${p} → ${res.status} ${text.slice(0, 200)}`);
        return text;
      }
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
      if (!res.ok) {
        const msg = (data && (data.message || data.error)) || text.slice(0, 200);
        const err = new Error(`GitHub ${method} ${p} → ${res.status} ${msg}`);
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 分页拉全量（issues/comments/files 都可能超过一页） */
  async function paginate(p, { perPage = 100, maxPages = 10 } = {}) {
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const sep = p.includes('?') ? '&' : '?';
      const batch = await request('GET', `${p}${sep}per_page=${perPage}&page=${page}`);
      if (!Array.isArray(batch) || !batch.length) break;
      out.push(...batch);
      if (batch.length < perPage) break;
    }
    return out;
  }

  return { request, paginate, token, repo, api };
}

module.exports = { makeClient };
