/**
 * 「胎动 / 宫缩 · 快捷记一笔」的取值计算 —— **纯函数、零依赖**。
 *
 * 【为什么要单独抽一个文件】
 * 小弹窗（components/record/QuickLogDialog.vue）原来直接在 save() 里拼 payload：
 *
 *   胎动：fetal_movement_count = 本次填的次数
 *   宫缩：contraction_count    = 填了持续时间 ? 1 : 0
 *
 * 这两行都会**静默丢数据**：
 *   ① 用户上午用计数器数了 20 次（后端 daily-rollup 已把 20 写回当天记录），
 *      下午在首页「记一笔」里填 5 ⇒ 汇总值被**直接改成 5**，上午那 20 次凭空消失；
 *   ② 宫缩那行更狠：只填了间隔/疼痛、没填持续时间 ⇒ 写 **0**，
 *      把当天已经记下的 N 次宫缩**清零**。
 *
 * 而且这两行藏在组件里，**没法单测**（只能靠肉眼 review）⇒ 抽成纯函数，
 * 由 tools/verify/probe_quicklog_semantics.js 用 esbuild 转译后直接跑断言。
 * 因为要能被 esbuild 单独转译，**本文件刻意不 import 任何东西**（连 `@/utils/format` 也不引）。
 *
 * 【两种模式的语义】
 *   append（默认·追加）：本次记的是「又数了一阵」，次数在当天已有值上**累加**；
 *   replace（改为）    ：本次记的是「修正这一天」，直接用本次值覆盖。
 *
 * ⚠️ 默认给 append 而不是 replace：孕妇一天里分几次数胎动是常态（早中晚各一次），
 *    默认覆盖的话，第二次记一笔就会把第一次抹掉 —— 而这是**静默**的，
 *    用户要等到看统计曲线才发现数字不对。反过来，想修正的人可以显式切「改为」。
 *
 * 【各字段在 append 下的行为（不是一律相加）】
 *   胎动次数  = 已有 + 本次      （一天累计数，相加才对）
 *   胎动用时  = 已有 + 本次      （同上，是总用时）
 *   宫缩次数  = 已有 + 1         （本次填了一阵 ⇒ 就是 1 条宫缩）
 *   宫缩持续  = 本次值（覆盖）   （这是**单次平均值**，相加没有意义）
 *   宫缩间隔  = 本次值（覆盖）   （同上；与 daily-rollup 的"按条数加权平均"口径同源）
 *   疼痛程度  = 本次值（覆盖）   （只有手填才有，会话表里没有这一列）
 *
 * 【一条硬规则】本次**没填**的字段一律返回 undefined（= 不提交）。
 *    后端 daily-record 的 UPDATE 按 `!== undefined` 判「写不写」这一列（铁律 #43），
 *    不提交 = 保持原值。绝不允许用 0 去"清空"用户已有的数据。
 */

export type QuickLogType = 'fetal_movement' | 'contraction'

/** append=追加到今天已有值上；replace=用本次值覆盖这一天 */
export type QuickLogMode = 'append' | 'replace'

export interface QuickLogForm {
  /** 胎动：本次数了几次 */
  count?: number | null
  /** 胎动=本次用时(分钟)；宫缩=本次持续(秒) */
  duration?: number | null
  /** 宫缩：间隔(分钟) */
  interval?: number | null
  /** 宫缩：疼痛程度 */
  pain?: string
}

/** 当天 daily_record 里已经记下的汇总值（弹窗顶部要显示「今天已记…」） */
export interface QuickLogExisting {
  count?: number | null
  duration?: number | null
  interval?: number | null
  pain?: string
}

export interface QuickLogFields {
  fetal_movement_count?: number
  fetal_movement_duration?: number
  contraction_count?: number
  contraction_duration?: number
  contraction_interval?: number
  contraction_pain?: string
}

/** 一个数：不是有限数字就当 0（已有值可能是 null / '' / 脏字符串） */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 本次到底填了没有 —— 与 format.ts 的 filled() 同口径：0 算填了 */
function filled(v: unknown): boolean {
  return v != null && v !== ''
}

/**
 * 拼出要提交给 `daily_record` 的字段。
 *
 * 返回值里**未填的键保留为 undefined**（不用 delete 掉）：
 * axios 序列化时值为 undefined 的键会被整个丢掉 ⇒ 后端收到 `undefined`
 * ⇒ 按铁律 #43 不更新这一列 ⇒ 保持用户原值。保留键也让单测能直接断言「这一列被跳过」。
 */
export function buildQuickLogFields(
  type: QuickLogType,
  mode: QuickLogMode,
  form: QuickLogForm,
  existing?: QuickLogExisting | null
): QuickLogFields {
  const ex = existing || {}
  const append = mode === 'append'

  if (type === 'fetal_movement') {
    const out: QuickLogFields = {}
    if (filled(form.count)) {
      out.fetal_movement_count = append
        ? num(ex.count) + num(form.count)
        : num(form.count)
    }
    if (filled(form.duration)) {
      out.fetal_movement_duration = append
        ? num(ex.duration) + num(form.duration)
        : num(form.duration)
    }
    return out
  }

  // ===== 宫缩 =====
  const out2: QuickLogFields = {}
  // 🔴 只按「有没有填持续时间」判定本次算不算一次宫缩。
  //    没填 ⇒ 连 contraction_count 这个键都不返回 ⇒ 后端保持原值。
  //    旧实现写 `duration ? 1 : 0`，那个 0 会把当天已有的 N 次清零。
  if (filled(form.duration)) {
    out2.contraction_count = append ? num(ex.count) + 1 : 1
    out2.contraction_duration = num(form.duration)
  }
  if (filled(form.interval)) out2.contraction_interval = num(form.interval)
  if (filled(form.pain)) out2.contraction_pain = String(form.pain)
  return out2
}

/**
 * 弹窗顶部那行「今天已记 …」。
 *
 * ⚠️ 返回空串表示「这一天还没记过」—— 此时弹窗不显示这行、也不显示模式开关
 *    （没有可累加/可覆盖的对象，显示出来只会让人困惑）。
 */
export function describeExisting(type: QuickLogType, existing?: QuickLogExisting | null): string {
  const ex = existing || {}
  const parts: string[] = []
  if (type === 'fetal_movement') {
    if (filled(ex.count)) parts.push(`${num(ex.count)} 次`)
    if (filled(ex.duration)) parts.push(`用时 ${num(ex.duration)} 分钟`)
  } else {
    if (filled(ex.count)) parts.push(`${num(ex.count)} 次`)
    if (filled(ex.duration)) parts.push(`持续 ${num(ex.duration)} 秒`)
    if (filled(ex.interval)) parts.push(`间隔 ${num(ex.interval)} 分钟`)
    if (filled(ex.pain)) parts.push(`疼痛 ${ex.pain}`)
  }
  return parts.length ? parts.join(' · ') : ''
}

/** 弹窗里「保存后会变成什么」的一行预览 */
export function previewQuickLog(
  type: QuickLogType,
  mode: QuickLogMode,
  form: QuickLogForm,
  existing?: QuickLogExisting | null
): string {
  const ex = existing || {}
  const fields = buildQuickLogFields(type, mode, form, ex)
  const unit = type === 'fetal_movement' ? '次胎动' : '次宫缩'
  if (type === 'fetal_movement' && !filled(form.count)) {
    // 只填了用时：次数不动，说清楚次数保持原样，别让用户以为会变
    return filled(ex.count) ? `胎动次数保持 ${num(ex.count)} 次` : ''
  }
  const next = fields.fetal_movement_count ?? fields.contraction_count
  if (next == null) return ''
  const base = num(ex.count)
  if (mode === 'append' && base > 0 && filled(form.count || form.duration)) {
    return `${base} + ${next - base} = ${next} ${unit}`
  }
  return `${next} ${unit}`
}
