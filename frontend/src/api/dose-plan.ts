/** 孕程记 - 用药 / 营养补充「医嘱计划」+ 每日打卡 API。
 *
 * ⚠️ 这里的每个路径都必须在后端 routes/dose-plan.js 里真实存在
 *    （铁律 #27：client.<method>() 的路径写错不会报错，只会运行时 404；
 *      改动后请跑 tools/verify/verify_api_contracts.js）。
 *
 * 概念区分：
 *  · dose-plans   = 医嘱方案（一次配置，长期有效：名称/剂量/提醒时间/频率/起止范围）
 *  · dose-today   = 今天「按医嘱该服」的清单（后端按方案算，前端不做第二套规则）
 *  · dose-checkins= 打卡，一天一种一条（打完卡当天就不再提醒）
 */
import client from './client'

export const dosePlanApi = {
  /** 方案列表 */
  list: (pregnancyId: string) =>
    client.get('/dose-plans', { params: { pregnancy_id: pregnancyId } }),

  create: (data: any) => client.post('/dose-plans', data),
  update: (id: string, data: any) => client.put(`/dose-plans/${id}`, data),
  remove: (id: string) => client.delete(`/dose-plans/${id}`),

  /** 今日待办（date 不传＝今天） */
  today: (pregnancyId: string, date?: string) =>
    client.get('/dose-today', {
      params: date ? { pregnancy_id: pregnancyId, date } : { pregnancy_id: pregnancyId },
    }),

  /** 打卡（幂等：重复打卡后端返回 duplicated） */
  checkin: (pregnancyId: string, planId: string, date?: string) =>
    client.post('/dose-checkins', { pregnancy_id: pregnancyId, plan_id: planId, date }),

  /** 撤销打卡 */
  uncheck: (planId: string, date?: string) =>
    client.delete('/dose-checkins', {
      params: date ? { plan_id: planId, date } : { plan_id: planId },
    }),
}
