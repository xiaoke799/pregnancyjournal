/**
 * 胎动 / 宫缩的**临床参考口径** —— 纯函数、零依赖、唯一真源。
 *
 * 【依据】（数字逐条对齐，改动前先回到出处核对）
 *   胎动：《妊娠晚期孕妇自我胎动监测指南》/ 专家共识（中华医学会围产医学分会，
 *         中华妇产科杂志 2020）+《妇产科学》（第 9 版，人民卫生出版社 2018）：
 *         · 妊娠 **28 周**起建议规律自数胎动；
 *         · 正常：**每小时 ≥3 次**，或 **12 小时累计 ≥30 次**；
 *         · 警戒：12 小时 <20 次需提高警惕并复测；**<10 次应立即就医**；
 *         · 安静状态下 **2 小时 <10 次**视为胎动减少。
 *   宫缩：《妇产科学》（第 9 版）+ 先兆早产 / 临产判定：
 *         · **临产** = 规律且逐渐增强的宫缩，**持续 ≥30 秒、间歇 5~6 分钟**，
 *           并伴宫颈管消失、宫口扩张、胎先露下降（后三项只能由产科检查判断）；
 *         · **假宫缩**（Braxton Hicks）：不规律、时强时弱、持续短、间歇长，
 *           **休息后可缓解**，不伴宫颈变化；
 *         · 妊娠 **<37 周**出现规律宫缩 ⇒ 先兆早产，需尽快就诊。
 *
 * 【合规红线】本文件**不做诊断**，只做「对照参考值后的提醒」。
 *    - 任何一句提示都不得写成"你缺氧了 / 你要生了"这类结论；
 *    - `alert` 级别的文案一律以「建议」「请及时就医 / 联系医院」收尾；
 *    - 判据里凡是**数据不全、没法折算**的一律返回 `unknown`，
 *      宁可不给结论，也不拿不完整的数据套公式（误报一次就医的代价远高于少提示一次）。
 *
 * 【为什么零依赖】与 utils/quick-log.ts 同理：要能被 esbuild 单独转译后
 *   在 tools/verify/probe_quicklog_semantics.js 里直接跑断言。
 */

/** 级别：normal=在正常范围 / watch=留意 / alert=建议就医 / unknown=数据不足，不判 */
export type ClinicalLevel = 'normal' | 'watch' | 'alert' | 'unknown'

export interface ClinicalJudge {
  level: ClinicalLevel
  /** 一句话结论（给卡片 / 条目用，控制在 20 字左右） */
  text: string
  /** 展开说明（给计数器页 / 明细弹窗用，写清依据与下一步） */
  detail: string
}

/* ============================ 胎动 ============================ */

export const FM_STANDARD = {
  /** 从这一孕周起建议规律自数胎动 */
  startWeek: 28,
  /** 每小时正常下限（次） */
  perHourNormal: 3,
  /** 12 小时累计正常下限（次） */
  per12hNormal: 30,
  /** 12 小时累计警戒线（次）：低于此值需复测警惕 */
  per12hWatch: 20,
  /** 2 小时安静状态下限（次）：低于此值为胎动减少 */
  per2hMin: 10,
} as const

export interface FmJudgeInput {
  /** 当天胎动次数 */
  count?: number | null
  /** 计数用时（分钟） */
  durationMin?: number | null
  /** 当前孕周（用于「28 周起才需要数」的提示） */
  weeks?: number | null
}

function n(v: unknown): number | null {
  if (v == null || v === '') return null
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : null
}

/**
 * 胎动判读。
 *
 * ⚠️ **用时缺失时一律返回 unknown**：不知道数了多久，就没法折算每小时次数，
 *    也不知道这一串数字是"1 小时数的"还是"一整天累计的"—— 拿 1 小时的 8 次
 *    去套"12 小时 ≥30 次"会得出"胎动偏少、建议就医"的**错误**结论。
 *    所以这种情况下只给参考值，请用户补记用时。
 */
export function judgeFetalMovement(input: FmJudgeInput): ClinicalJudge {
  const count = n(input.count)
  const dur = n(input.durationMin)
  const weeks = n(input.weeks)

  if (count == null) {
    return {
      level: 'unknown',
      text: '还没记次数',
      detail: `孕 ${FM_STANDARD.startWeek} 周起建议每天早、中、晚各数 1 小时，正常每小时 ≥3 次。`,
    }
  }

  // 孕周太早：胎儿活动尚未规律，套标准没有意义，只鼓励开始留意
  if (weeks != null && weeks < FM_STANDARD.startWeek) {
    return {
      level: 'unknown',
      text: '已记 ' + count + ' 次',
      detail: `一般从孕 ${FM_STANDARD.startWeek} 周起才规律计数，现在可以先熟悉宝宝的活動规律。`,
    }
  }

  // 有次数、没用时 ⇒ 折算不了，不判
  if (dur == null || dur <= 0) {
    return {
      level: 'unknown',
      text: '已记 ' + count + ' 次',
      detail:
        `已记 ${count} 次；补上「用时」才能折算每小时次数。` +
        `参考：每小时 ≥3 次，或 12 小时累计 ≥${FM_STANDARD.per12hNormal} 次。`,
    }
  }

  const perHour = count / (dur / 60)
  const shown = Math.round(perHour * 10) / 10

  if (perHour >= FM_STANDARD.perHourNormal) {
    return {
      level: 'normal',
      text: `约 ${shown} 次/小时 · 正常`,
      detail: `折算约 ${shown} 次/小时，达到每小时 ≥${FM_STANDARD.perHourNormal} 次的正常范围。继续保持每天固定时段记录。`,
    }
  }
  // 1.5~3 次/小时：不到正常线，但离得近 —— 先复测，不直接让去医院
  if (perHour >= FM_STANDARD.perHourNormal / 2) {
    return {
      level: 'watch',
      text: `约 ${shown} 次/小时 · 偏少`,
      detail:
        `折算约 ${shown} 次/小时，低于每小时 ${FM_STANDARD.perHourNormal} 次。` +
        `建议左侧卧位、安静环境下再数 1 小时；若仍偏少或比平时少一半以上，请及时就医。`,
    }
  }
  return {
    level: 'alert',
    text: `约 ${shown} 次/小时 · 明显偏少`,
    detail:
      `折算约 ${shown} 次/小时，明显低于每小时 ${FM_STANDARD.perHourNormal} 次。` +
      `（2 小时不足 ${FM_STANDARD.per2hMin} 次即视为胎动减少）建议尽快到医院做胎心监护。`,
  }
}

/* ============================ 宫缩 ============================ */

export const CT_STANDARD = {
  /** 临产宫缩的持续下限（秒） */
  laborDurationSec: 30,
  /** 临产宫缩的间隔上限（分钟）：间歇 5~6 分钟 */
  laborIntervalMin: 6,
  /** 未足月线（周）：早于此周出现规律宫缩 ⇒ 先兆早产 */
  termWeek: 37,
} as const

export interface CtJudgeInput {
  /** 单次持续（秒） */
  durationSec?: number | null
  /** 间隔（分钟） */
  intervalMin?: number | null
  /** 当前孕周 */
  weeks?: number | null
}

/**
 * 宫缩判读。
 *
 * ⚠️ 只能判「像不像规律宫缩」，**不能判是不是临产**：临产还要求宫颈管消失、
 *    宫口扩张、胎先露下降，这三项必须由产科医生检查。所以 alert 文案里
 *    必须写清"建议联系医院/就诊"，并说明最终以产科检查为准。
 */
export function judgeContraction(input: CtJudgeInput): ClinicalJudge {
  const dur = n(input.durationSec)
  const itv = n(input.intervalMin)
  const weeks = n(input.weeks)

  if (dur == null && itv == null) {
    return {
      level: 'unknown',
      text: '还没记时长/间隔',
      detail: '记下每次持续多久、隔多久一次，才能对照临产宫缩的参考值（持续 ≥30 秒、间隔 5~6 分钟）。',
    }
  }

  const longEnough = dur != null && dur >= CT_STANDARD.laborDurationSec
  const closeEnough = itv != null && itv > 0 && itv <= CT_STANDARD.laborIntervalMin
  const preterm = weeks != null && weeks < CT_STANDARD.termWeek

  if (longEnough && closeEnough) {
    if (preterm) {
      return {
        level: 'alert',
        text: '规律宫缩 · 未足月',
        detail:
          `持续 ${dur} 秒、间隔 ${itv} 分钟，已符合规律宫缩特征，但还没到 ${CT_STANDARD.termWeek} 周，` +
          `需警惕先兆早产，请立即就医。`,
      }
    }
    return {
      level: 'alert',
      text: '规律宫缩 · 建议联系医院',
      detail:
        `持续 ${dur} 秒、间隔 ${itv} 分钟，符合临产宫缩的参考特征（持续 ≥${CT_STANDARD.laborDurationSec} 秒、` +
        `间隔 ${CT_STANDARD.laborIntervalMin} 分钟内）。建议联系医院或前往产科；是否临产以产科检查为准。`,
    }
  }

  if (longEnough && !closeEnough) {
    return {
      level: 'watch',
      text: itv == null ? '持续已达 30 秒' : `间隔 ${itv} 分钟 · 还偏长`,
      detail:
        `持续时间已达 ${CT_STANDARD.laborDurationSec} 秒，但间隔还长（临产参考为 ${CT_STANDARD.laborIntervalMin} 分钟内）。` +
        `先休息观察，若间隔逐渐缩短、强度逐渐增强，再联系医院。`,
    }
  }

  if (!longEnough && closeEnough) {
    return {
      level: 'watch',
      text: `间隔 ${itv} 分钟 · 持续偏短`,
      detail:
        `间隔已缩短到 ${itv} 分钟，但单次持续不足 ${CT_STANDARD.laborDurationSec} 秒。` +
        `若持续时间逐渐延长到 30 秒以上，建议联系医院。`,
    }
  }

  return {
    level: 'normal',
    text: '未达规律宫缩标准',
    detail:
      `未达到规律宫缩参考值（持续 ≥${CT_STANDARD.laborDurationSec} 秒、间隔 ≤${CT_STANDARD.laborIntervalMin} 分钟）。` +
      `若不规律、时强时弱且休息后缓解，多为假宫缩，属常见现象。`,
  }
}

/** 级别 → 展示色（走主题令牌，深色模式下自动翻转） */
export const LEVEL_TOKEN: Record<ClinicalLevel, string> = {
  normal: 'var(--success-ink, #2f7a54)',
  watch: 'var(--warning-ink, #b45309)',
  alert: 'var(--error-ink, #c62828)',
  unknown: 'var(--text-hint, #94a3b8)',
}
