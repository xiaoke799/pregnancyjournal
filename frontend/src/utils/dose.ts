/** 用药/补充：前端展示文案唯一出处（铁律 #34：同一字面量只留一处）。
 * 后端接口已返回 kind_label，这里只做兜底，避免两处抄出第三份。 */
export const FREQ_LABEL: Record<string, string> = {
  daily: '每天',
  interval2: '隔天',
  weekdays: '每周指定',
}

export function kindLabel(kind: string): string {
  return kind === 'medication' ? '药品' : '营养补充'
}

export function frequencyLabel(freq: string): string {
  return FREQ_LABEL[freq] || '每天'
}
