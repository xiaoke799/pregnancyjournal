<template>
  <!-- ===== 今日用药 / 营养补充打卡 =====
       数据来自 GET /dose-today，「今天该不该吃」完全由后端按医嘱方案算，
       前端不做第二套规则（否则会出现「页面说要吃、提醒却没推」的漂移）。 -->
  <div class="dose-card" v-if="loaded">
    <div class="dose-head">
      <h3><span class="dose-head-icon">💊</span>今日用药 / 补充</h3>
      <div class="dose-head-right">
        <span class="dose-count" v-if="items.length">{{ taken }}/{{ items.length }}</span>
        <!-- 在 /dose-plan 页里自己就不用再链自己了 -->
        <router-link v-if="showManage" to="/dose-plan" class="dose-manage">管理 ›</router-link>
      </div>
    </div>

    <div class="dose-bar" v-if="items.length">
      <div class="dose-bar-fill" :style="{ width: percent + '%' }"></div>
    </div>

    <div v-if="!items.length" class="dose-empty">
      <template v-if="loadError">今日用药加载失败，请检查网络后刷新重试</template>
      <template v-else>
        今天没有按医嘱要服的药品 / 补充剂
        <router-link to="/dose-plan" class="dose-empty-link">按医嘱添加计划 ›</router-link>
      </template>
    </div>

    <button
      v-for="it in items"
      :key="it.id"
      type="button"
      class="dose-item"
      :class="[it.kind, { taken: it.taken }]"
      @click="toggle(it)"
    >
      <span class="dose-box" aria-hidden="true"><span v-if="it.taken">✓</span></span>
      <span class="dose-main">
        <span class="dose-line">
          <span class="dose-kind" :class="it.kind">{{ it.kind_label }}</span>
          <span class="dose-name">{{ it.name }}</span>
          <span class="dose-dosage" v-if="it.dosage">{{ it.dosage }}</span>
        </span>
        <span class="dose-sub">
          {{ it.reminder_times.join(' · ') }}<template v-if="it.frequency !== 'daily'"> · {{ frequencyLabel(it.frequency) }}</template>
          <template v-if="it.note"> · {{ it.note }}</template>
        </span>
      </span>
      <span class="dose-state">{{ it.taken ? '已打卡' : '待服' }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/** 今日用药 / 补充打卡卡。
 *
 * 交互：点一下 = 打卡，再点一下 = 撤销（按「种类」一天一条，不是按次）。
 * 打卡后当天推送就不再提醒这一项（后端 doseReminderTick 会跳过已打卡方案）。
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { dosePlanApi } from '@/api/dose-plan'
import { usePregnancyStore } from '@/stores/pregnancy'
import { frequencyLabel } from '@/utils/dose'

interface DoseItem {
  id: string
  kind: string
  kind_label: string
  name: string
  dosage: string
  note: string
  reminder_times: string[]
  frequency: string
  taken: boolean
}

const props = withDefaults(defineProps<{ showManage?: boolean }>(), { showManage: true })

const message = useMessage()
const pregnancyStore = usePregnancyStore()

const items = ref<DoseItem[]>([])
const loaded = ref(false)
const loadError = ref(false)
const busy = ref<Record<string, boolean>>({})

const taken = computed(() => items.value.filter((i) => i.taken).length)
const percent = computed(() =>
  items.value.length ? Math.round((taken.value / items.value.length) * 100) : 0
)

async function load() {
  const p = pregnancyStore.currentPregnancy as any
  if (!p || !p.id) {
    items.value = []
    loaded.value = false
    return
  }
  try {
    const res: any = await dosePlanApi.today(p.id)
    const raw = res?.data?.items || []
    items.value = raw.map((it: any) => ({
      ...it,
      reminder_times: Array.isArray(it.reminder_times) ? it.reminder_times : [],
      taken: !!it.taken,
    }))
    loaded.value = true
    loadError.value = false
  } catch (e) {
    // ⚠️ 失败不能伪装成「今天没有要服的」：保留卡片显示加载失败，
    //    否则接口挂了和真的没有计划长得一模一样，用户无从察觉。
    items.value = []
    loaded.value = true
    loadError.value = true
  }
}

/** 乐观更新：先改界面，失败再回滚（点了要有反应，不能等网络） */
async function toggle(it: DoseItem) {
  const p = pregnancyStore.currentPregnancy as any
  if (!p || !p.id || busy.value[it.id]) return
  busy.value[it.id] = true
  const next = !it.taken
  it.taken = next
  try {
    if (next) await dosePlanApi.checkin(p.id, it.id)
    else await dosePlanApi.uncheck(it.id)
  } catch (e) {
    it.taken = !next
    message.error(next ? '打卡失败，请重试' : '撤销失败，请重试')
  } finally {
    busy.value[it.id] = false
  }
}

onMounted(load)
watch(() => (pregnancyStore.currentPregnancy as any)?.id, () => load())

defineExpose({ refresh: load })
</script>

<style scoped>
.dose-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color-soft);
  border-radius: var(--radius-lg, 16px);
  padding: 16px 18px;
  margin-bottom: 16px;
  box-shadow: var(--shadow-sm);
}

.dose-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2, 8px);
}
.dose-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text-color);
  display: flex;
  align-items: center;
  gap: 6px;
}
.dose-head-icon { font-size: 15px; }
.dose-head-right {
  display: flex;
  align-items: center;
  gap: var(--space-3, 12px);
}
.dose-count {
  font-size: 13px;
  font-weight: 700;
  color: var(--primary-color);
}
.dose-manage {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--primary-color);
  text-decoration: none;
}

.dose-bar {
  height: 6px;
  border-radius: var(--radius-full, 9999px);
  background: var(--border-color-soft);
  overflow: hidden;
  margin: 10px 0 12px;
}
.dose-bar-fill {
  height: 100%;
  border-radius: var(--radius-full, 9999px);
  background: var(--gradient-primary);
  transition: width var(--transition-base, 0.25s);
}

.dose-empty {
  font-size: 13px;
  color: var(--text-hint);
  padding: 4px 0 2px;
}
.dose-empty-link {
  display: inline-block;
  margin-left: 6px;
  color: var(--primary-color);
  font-weight: 600;
  text-decoration: none;
}

.dose-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  margin-bottom: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 12px);
  background: var(--bg-card);
  cursor: pointer;
  font-family: inherit;
  transition: background var(--transition-fast, 0.15s), border-color var(--transition-fast, 0.15s);
}
.dose-item:last-child { margin-bottom: 0; }
.dose-item.medication { border-left: 3px solid var(--info-color); }
.dose-item.supplement { border-left: 3px solid var(--success-color); }
.dose-item.taken { background: var(--bg-tint-mint); }

.dose-box {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 1px;
  border: 2px solid var(--border-color-strong);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-inverse);
  transition: background var(--transition-fast, 0.15s), border-color var(--transition-fast, 0.15s);
}
.dose-item.taken .dose-box {
  background: var(--success-color);
  border-color: var(--success-color);
}

.dose-main { flex: 1; min-width: 0; }
.dose-line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px;
}
.dose-kind {
  display: inline-block;
  padding: 1px 6px;
  border-radius: var(--radius-xs, 4px);
  font-size: 11.5px;
  font-weight: 600;
}
/* ⚠️ 徽章文字用 ink（≥4.5:1），不用 --info-color / --success-color（那是填充色，只够 3:1） */
.dose-kind.medication { background: var(--bg-tint-blue); color: var(--info-ink); }
.dose-kind.supplement { background: var(--bg-tint-mint); color: var(--success-ink); }

.dose-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--text-color);
}
.dose-dosage {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}
.dose-sub {
  display: block;
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--text-hint);
  line-height: 1.5;
}

.dose-state {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--warning-ink);
}
.dose-item.taken .dose-state { color: var(--success-ink); }
</style>
