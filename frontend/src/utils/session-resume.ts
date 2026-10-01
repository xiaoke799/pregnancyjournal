/**
 * 「今天有没有还没结束的会话，进来该接哪一条」—— 纯函数、零依赖。
 *
 * 【为什么需要】
 * 计数器 / 计时器页都是「进页面建会话、退出页面只做本地 reset、**不结束服务端会话**」，
 * 而此前进来**无条件新建** ⇒ 用户记到一半退出，那条会话的 `end_time` 永远是 NULL：
 *   · 首页卡片一直显示「计时中…」；
 *   · 再进页面又新建一条 ⇒ 未结束的会话越积越多；
 *   · 之前记的那些明细在页面上再也接不上（只能去记录页明细弹窗里看）。
 * 修法是进页面时先把今天那条接回来。两个页面都要这段判断 ⇒ 收在这里，别各写一遍
 * （两处各写一遍的结果就是日后只修一处，另一处继续攒空壳会话）。
 *
 * 【边界】只认**今天**的会话：隔天的会话不可能还在计时（本应用没有后台恢复入口，
 * 也没人会让一次计数跨夜挂着）。宁可不恢复，也不要跨天把昨天那条接上来继续写。
 */

/** 一条会话（只列本函数用到的字段） */
export interface SessionRow {
  id?: string | null
  session_date?: string | null
  start_time?: string | null
  end_time?: string | null
  [k: string]: unknown
}

export interface ResumablePick {
  /** 该接着用的那一条（没有则为 null） */
  keep: SessionRow | null
  /** 今天还挂着的更早的会话：调用方顺手收尾（补上 end_time），别让它们永远挂着 */
  stale: SessionRow[]
}

/**
 * 从会话列表里挑出「今天还没结束」的那一条。
 *
 * 多条未结束时取**开始时间最晚**的那条继续用（用户最可能是在接着最近那次）。
 * ⚠️ 排序用字符串比较：`start_time` 是 'HH:MM:SS' 定长格式，字典序 === 时间序，
 *    不依赖 Date 解析（'HH:MM:SS' 单独喂给 Date 在不同运行时会得到不同的基准日）。
 */
export function pickResumableSession(sessions: unknown, today: string): ResumablePick {
  const list: SessionRow[] = Array.isArray(sessions) ? (sessions as SessionRow[]) : []
  // today 必须有值：拿不到今天就不恢复，避免把昨天的会话接到今天继续写
  if (!today) return { keep: null, stale: [] }
  const open = list.filter(
    (s) => !!(s && s.id && !s.end_time && s.session_date === today)
  )
  if (!open.length) return { keep: null, stale: [] }
  open.sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || '')))
  return { keep: open[open.length - 1], stale: open.slice(0, -1) }
}
