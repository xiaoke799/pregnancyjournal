/** 孕程记 - 饮食 API（食谱推荐 + 食物安全）。 */

import client from './client'

/** 根据孕周获取推荐食谱 */
export function getRecipes(week: number) {
  return client.get('/diet/recipes', { params: { week } })
}

/** 获取全量食谱（不过滤孕周） */
export function getAllRecipes() {
  return client.get('/diet/recipes', { params: { all: 'true' } })
}

/** 随机推荐一道食谱（转盘功能） */
export function spinRecipe(week: number) {
  return client.post('/diet/spin', undefined, { params: { week } })
}

/** 获取食物安全数据 */
export function getFoodSafety(category?: string) {
  return client.get('/diet/food-safety', { params: { category } })
}

/** 搜索食物安全信息 */
export function searchFood(keyword: string) {
  return client.get('/diet/food-safety/search', { params: { keyword } })
}
