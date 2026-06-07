<template>
  <div class="diet-view">
    <n-tabs v-model:value="activeTab" type="line" animated>
      <n-tab-pane name="spin" tab="🎲 今日吃什么">
        <div class="spin-section">
          <div class="random-area">
            <div class="random-icon">🍳</div>
            <div class="random-title">不知道吃啥？</div>
            <n-button type="primary" size="large" round @click="doPick">
              🎲 推荐今日三餐
            </n-button>
          </div>

          <div v-if="recipesLoading" class="loading-hint">
            <n-spin size="small" />
            <span>食谱数据加载中...</span>
          </div>
          <div v-else-if="!hasMeals" class="no-meals-hint">
            点击按钮推荐今日三餐
          </div>
          <div v-else class="meals-result">
            <div v-for="m in mealList" :key="m.key" class="meal-card">
              <div class="meal-label">{{ m.label }}</div>
              <div class="meal-combo">
                <template v-for="slot in m.slots" :key="slot.type">
                  <div v-if="slot.recipe" class="combo-item">
                    <span class="combo-tag">{{ slot.icon }}{{ slot.type }}</span>
                    <span class="combo-name">{{ slot.recipe.name }}</span>
                    <span class="combo-desc">{{ slot.recipe.description }}</span>
                  </div>
                </template>
              </div>
            </div>
            <n-button block tertiary round @click="doPick" class="refresh-btn">
              🔄 换一组推荐
            </n-button>
          </div>
        </div>
      </n-tab-pane>

      <n-tab-pane name="safety" tab="🔍 能不能吃">
        <div class="safety-section">
          <div v-if="safetyLoading" class="loading-hint-center">
            <n-spin size="large" />
            <p>食物安全数据加载中...</p>
          </div>
          <template v-else>
          <n-input
            v-model:value="searchKeyword"
            placeholder="搜索 1000+ 种食物（如：螃蟹、咖啡、山楂）"
            clearable
            @keyup.enter="doSearch"
            @clear="clearSearch"
          >
            <template #prefix>🔍</template>
            <template #suffix>
              <span v-if="searchKeyword" class="search-hint" @click="doSearch">搜索</span>
            </template>
          </n-input>

          <div class="category-tabs">
            <div
              v-for="cat in categoryList"
              :key="cat.name"
              class="category-tab"
              :class="{ active: activeCategory === cat.name }"
              @click="selectCategory(cat.name)"
            >
              {{ cat.icon }} {{ cat.name }}
            </div>
          </div>

          <div v-if="searchResults.length > 0" class="food-list">
            <div class="food-list-title">搜索结果</div>
            <FoodSafetyCard
              v-for="item in searchResults"
              :key="item.name"
              :item="item"
              :current-stage="currentStage"
            />
          </div>

          <div v-else-if="activeCategoryData" class="food-list">
            <div class="food-list-title">{{ activeCategoryData.icon }} {{ activeCategoryData.name }}</div>
            <FoodSafetyCard
              v-for="item in activeCategoryData.items"
              :key="item.name"
              :item="item"
              :current-stage="currentStage"
            />
          </div>

          <div v-else class="empty-state">
            <div class="empty-text">请选择分类或搜索食物</div>
          </div>
          </template>
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NTabs, NTabPane, NButton, NInput, NTag, NSpin, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { getAllRecipes, getFoodSafety, searchFood } from '@/api/diet'
import FoodSafetyCard from '@/components/FoodSafetyCard.vue'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

const activeTab = ref('spin')

interface Recipe {
  id: string
  name: string
  category: string
  suitable_weeks: number[]
  suitable_stage: string[]
  ingredients: string[]
  nutrition: string
  image: string | null
  description: string
}

interface ComboSlot {
  type: string
  icon: string
  recipe: Recipe | null
}

interface MealCombo {
  staple: Recipe | null
  meat: Recipe | null
  veggie: Recipe | null
  soup: Recipe | null
  drink: Recipe | null
  dessert: Recipe | null
}

const allRecipes = ref<Recipe[]>([])
const recipesLoading = ref(false)
const meals = ref<{ breakfast: MealCombo; lunch: MealCombo; dinner: MealCombo }>({
  breakfast: { staple: null, meat: null, veggie: null, soup: null, drink: null, dessert: null },
  lunch:     { staple: null, meat: null, veggie: null, soup: null, drink: null, dessert: null },
  dinner:    { staple: null, meat: null, veggie: null, soup: null, drink: null, dessert: null },
})

// 最近使用的菜谱ID（避免连续重复）
const recentUsedIds = ref<Set<string>>(new Set())
const MAX_RECENT = 12

// 清空最近使用记录
function clearRecentUsed() {
  recentUsedIds.value.clear()
}

const hasMeals = computed(() => {
  const b = meals.value.breakfast
  const l = meals.value.lunch
  const d = meals.value.dinner
  return !!(b.staple || b.drink || l.staple || l.meat || d.staple || d.soup)
})

function buildSlots(combo: MealCombo): ComboSlot[] {
  const slots: ComboSlot[] = []
  if (combo.staple)  slots.push({ type: '主食', icon: '🍚', recipe: combo.staple })
  if (combo.meat)    slots.push({ type: '荤菜', icon: '🥩', recipe: combo.meat })
  if (combo.veggie)  slots.push({ type: '素菜', icon: '🥬', recipe: combo.veggie })
  if (combo.soup)    slots.push({ type: '汤品', icon: '🍲', recipe: combo.soup })
  if (combo.drink)   slots.push({ type: '饮品', icon: '🥤', recipe: combo.drink })
  if (combo.dessert) slots.push({ type: '甜品', icon: '🍮', recipe: combo.dessert })
  return slots
}

const mealList = computed(() => [
  { key: 'breakfast', label: '🌅 早餐', combo: meals.value.breakfast, slots: buildSlots(meals.value.breakfast) },
  { key: 'lunch',     label: '☀️ 午餐', combo: meals.value.lunch,     slots: buildSlots(meals.value.lunch) },
  { key: 'dinner',    label: '🌙 晚餐', combo: meals.value.dinner,    slots: buildSlots(meals.value.dinner) },
].filter(m => m.slots.length > 0))

const currentWeek = computed(() => pregnancyStore.gestationalAge?.weeks ?? 20)

const currentStage = computed(() => {
  const week = currentWeek.value
  if (week <= 0) return 'preparing'
  if (week <= 13) return 'early'
  if (week <= 27) return 'mid'
  if (week <= 42) return 'late'
  return 'nursing'
})

function filterByStage(recipes: Recipe[], stage: string): Recipe[] {
  return recipes.filter(r => (r.suitable_stage || []).includes(stage))
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}

function pickUnique(pool: Recipe[], usedIds: Set<string>, count: number): Recipe[] {
  const available = pool.filter(r => !usedIds.has(r.id))
  return shuffle(available).slice(0, count)
}

function pickOneFromPool(pool: Recipe[], usedIds: Set<string>): Recipe | null {
  const available = pool.filter(r => !usedIds.has(r.id))
  if (available.length === 0) return null
  return available[Math.floor(Math.random() * available.length)]
}

function doPick() {
  if (!pregnancyStore.currentPregnancy) {
    message.warning('请先在设置中完善孕期信息')
    return
  }
  if (allRecipes.value.length === 0) {
    message.error('食谱数据加载中，请稍后重试')
    return
  }

  // 阶段过滤，如果过滤后太少则扩大范围
  let pool = filterByStage(allRecipes.value, currentStage.value)
  if (pool.length < 15) {
    // 扩大：包含相邻阶段
    const stages = ['preparing', 'early', 'mid', 'late', 'nursing']
    const idx = stages.indexOf(currentStage.value)
    const extraStages: string[] = []
    if (idx > 0) extraStages.push(stages[idx - 1])
    if (idx < stages.length - 1) extraStages.push(stages[idx + 1])
    const expanded = allRecipes.value.filter(r =>
      (r.suitable_stage || []).includes(currentStage.value) ||
      (r.suitable_stage || []).includes(extraStages[0]) ||
      (r.suitable_stage || []).includes(extraStages[1])
    )
    if (expanded.length > pool.length) pool = expanded
  }
  // 如果还是太少就用全部
  if (pool.length < 10) pool = [...allRecipes.value]

  // 排除最近使用过的
  const availablePool = pool.filter(r => !recentUsedIds.value.has(r.id))
  const finalPool = availablePool.length >= 10 ? availablePool : pool

  // 打乱池子
  const shuffled = shuffle(finalPool)

  const usedIds = new Set<string>()
  const byCat = (cat: string) => shuffled.filter(r => r.category === cat)

  const pickFrom = (...candidatesLists: Recipe[][]) => {
    // 也打乱候选列表
    for (const list of candidatesLists) {
      const avail = list.filter(r => r && !usedIds.has(r.id))
      if (avail.length > 0) {
        const r = avail[Math.floor(Math.random() * avail.length)]
        usedIds.add(r.id)
        return r
      }
    }
    return null
  }

  const stapleCat = byCat('主食')
  const breakfastCat = byCat('早餐')
  const meatCat = byCat('荤菜')
  const veggieCat = byCat('素菜')
  const soupCat = byCat('汤品')
  const drinkCat = byCat('饮品')
  const dessertCat = byCat('甜品')

  const breakfastStaple = pickFrom(
    breakfastCat,
    stapleCat.filter(r => /粥|面|糊|饭|饺|饼|玉米|红薯|包|麦/.test(r.name)),
    stapleCat
  )
  const breakfastDrink = pickFrom(
    drinkCat,
    breakfastCat.filter(r => /豆浆|奶|汁|茶|水/.test(r.name))
  )
  const breakfastDessert = pickFrom(
    dessertCat.filter(r => /羹|汤圆|奶|糕|沙/.test(r.name)),
    dessertCat,
    stapleCat.filter(r => /糊|粥/.test(r.name))
  )

  const lunchStaple = pickFrom(
    stapleCat.filter(r => /饭|面|饺|饼|馒|包/.test(r.name)),
    stapleCat,
    breakfastCat
  )
  const lunchMeat = pickFrom(meatCat)
  const lunchVeggie = pickFrom(veggieCat)
  const lunchSoup = pickFrom(soupCat)

  const dinnerStaple = pickFrom(
    stapleCat.filter(r => /粥|面|饭|糊/.test(r.name)),
    stapleCat,
    breakfastCat
  )
  const dinnerMeat = pickFrom(meatCat.filter(r => r.id !== lunchMeat?.id), meatCat)
  const dinnerVeggie = pickFrom(veggieCat.filter(r => r.id !== lunchVeggie?.id), veggieCat, meatCat)
  const dinnerSoup = pickFrom(soupCat.filter(r => r.id !== lunchSoup?.id), soupCat)

  // 记录本次使用的ID
  const newMeals = [breakfastStaple, breakfastDrink, breakfastDessert, lunchStaple, lunchMeat, lunchVeggie, lunchSoup, dinnerStaple, dinnerMeat, dinnerVeggie, dinnerSoup].filter(Boolean)
  newMeals.forEach(r => {
    recentUsedIds.value.add(r!.id)
  })
  // 限制历史大小
  if (recentUsedIds.value.size > MAX_RECENT) {
    const arr = Array.from(recentUsedIds.value)
    recentUsedIds.value = new Set(arr.slice(arr.length - MAX_RECENT))
  }

  meals.value = {
    breakfast: { staple: breakfastStaple, meat: null, veggie: null, soup: null, drink: breakfastDrink, dessert: breakfastDessert },
    lunch:     { staple: lunchStaple,     meat: lunchMeat, veggie: lunchVeggie, soup: lunchSoup, drink: null, dessert: null },
    dinner:    { staple: dinnerStaple,    meat: dinnerMeat, veggie: dinnerVeggie, soup: dinnerSoup, drink: null, dessert: null },
  }
}

interface FoodSafetyItem {
  name: string
  safety_by_stage: Record<string, string>
  note: string
  image: string | null
}

interface FoodSafetyCategory {
  name: string
  icon: string
  items: FoodSafetyItem[]
}

const categoryList = ref<FoodSafetyCategory[]>([])
const safetyLoading = ref(false)
const activeCategory = ref('')
const searchKeyword = ref('')
const searchResults = ref<FoodSafetyItem[]>([])

const activeCategoryData = computed(() => {
  if (!activeCategory.value) return null
  return categoryList.value.find(c => c.name === activeCategory.value) || null
})

function selectCategory(name: string) {
  activeCategory.value = name
  searchResults.value = []
  searchKeyword.value = ''
}

async function doSearch() {
  if (!searchKeyword.value.trim()) return
  try {
    const res: any = await searchFood(searchKeyword.value.trim())
    searchResults.value = res?.data || []
    activeCategory.value = ''
  } catch {
    message.error('搜索失败')
  }
}

function clearSearch() {
  searchResults.value = []
  searchKeyword.value = ''
}

async function loadAllRecipes() {
  recipesLoading.value = true
  try {
    const res: any = await getAllRecipes()
    allRecipes.value = res?.data || []
  } catch (e) {
    console.error('Failed to load recipes:', e)
  } finally {
    recipesLoading.value = false
  }
}

async function loadFoodSafety() {
  safetyLoading.value = true
  try {
    const res: any = await getFoodSafety()
    categoryList.value = res?.data || []
    if (categoryList.value.length > 0) {
      activeCategory.value = categoryList.value[0].name
    }
  } catch (e) {
    console.error('Failed to load food safety:', e)
    message.error('食物安全数据加载失败')
  } finally {
    safetyLoading.value = false
  }
}

onMounted(() => {
  loadAllRecipes()
  loadFoodSafety()
})
</script>

<style scoped>
.diet-view { max-width: 800px; margin: 0 auto; padding: 16px; }

.spin-section { display: flex; flex-direction: column; align-items: center; padding: 20px 0; }

.random-area {
  text-align: center;
  padding: 48px 20px;
  background: linear-gradient(135deg, #fef3c7, #fce7f3);
  border-radius: 16px;
  margin-bottom: 24px;
  width: 100%;
  max-width: 400px;
}
.random-icon { font-size: 64px; margin-bottom: 12px; }
.random-title { font-size: 18px; font-weight: 600; color: #64748b; margin-bottom: 20px; }

.meals-result { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 12px; }

.meal-card {
  background: white;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,.05);
  border-left: 4px solid var(--primary-color, #c44680);
}
.meal-label {
  font-size: 15px;
  font-weight: 700;
  color: var(--primary-color, #c44680);
  margin-bottom: 10px;
  padding-bottom: 6px;
  border-bottom: 1px dashed #f3e8f0;
}

.meal-combo { display: flex; flex-direction: column; gap: 8px; }

.combo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;  /* 关键：允许子元素收缩 */
}
.combo-tag {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: white;
  background: #f8a4c8;
  padding: 2px 8px;
  border-radius: 10px;
  min-width: 52px;
  text-align: center;
}
.combo-name {
  font-size: 15px;
  font-weight: 700;
  color: #1e293b;
}
.combo-desc {
  font-size: 11px;
  color: #94a3b8;
  margin-left: 8px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 180px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refresh-btn { margin-top: 12px; }

.safety-section { padding-top: 8px; }
.category-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
.category-tab {
  padding: 6px 14px; border-radius: 20px; font-size: 13px; cursor: pointer;
  background: var(--bg-color, #f8fafc); border: 1px solid var(--border-color, #e2e8f0);
  color: var(--text-secondary, #64748b); transition: background-color 0.2s, border-color 0.2s, color 0.2s; white-space: nowrap;
}
.category-tab:hover { border-color: var(--stage-mid-color, #4FC3F7); color: var(--stage-mid-color, #4FC3F7); }
.category-tab.active { background: var(--stage-mid-color, #4FC3F7); border-color: var(--stage-mid-color, #4FC3F7); color: white; }
.food-list { margin-top: 8px; }
.food-list-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; color: var(--text-color, #1e293b); }
.empty-state { padding: 40px 20px; text-align: center; }
.empty-text { font-size: 14px; color: var(--text-hint, #94a3b8); }
.loading-hint { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 20px; color: var(--text-hint, #94a3b8); font-size: 14px; }
.loading-hint-center { padding: 60px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-hint, #94a3b8); }
.loading-hint-center p { margin: 0; font-size: 14px; }
.no-meals-hint { text-align: center; padding: 24px; color: var(--text-hint, #94a3b8); font-size: 14px; background: white; border-radius: 12px; margin-top: 16px; }

@media (max-width: 600px) {
  .diet-view { padding: 12px; }
  .random-area { padding: 32px 16px; }
  .random-icon { font-size: 48px; }
  .category-tabs { gap: 6px; }
  .category-tab { padding: 4px 10px; font-size: 12px; }
  .combo-desc { display: none; }
}
</style>
