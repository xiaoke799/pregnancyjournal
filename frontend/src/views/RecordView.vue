<template>
  <div class="record-view" :class="{ 'is-mobile': isMobile }">
    <template v-if="!isMobile">
      <div class="record-layout">
        <!-- 左侧日历 -->
        <div class="calendar-panel">
          <MiniCalendar @select="onDateSelect" />
        </div>
        <!-- 右侧记录列表（独立滚动） -->
        <div class="record-panel">
          <div class="record-header">
            <h3>{{ selectedDate }} 的记录</h3>
            <n-button size="small" type="primary" @click="openAddDialog">
              + 添加记录
            </n-button>
          </div>
          <RecordList
            :date="selectedDate"
            @edit="onEditRecord"
          />
        </div>
      </div>
    </template>

    <template v-else>
      <!-- 手机端：日历置顶不跟随滚动 -->
      <div class="mobile-calendar-wrap">
        <MiniCalendar @select="onDateSelect" />
      </div>
      <div class="mobile-record-panel">
        <div class="record-header">
          <h3>{{ selectedDate }} 的记录</h3>
          <n-button size="small" type="primary" @click="openAddDialog">
            + 添加
          </n-button>
        </div>
        <RecordList
          :date="selectedDate"
          @edit="onEditRecord"
        />
      </div>
    </template>

    <!-- 添加/编辑记录弹窗 -->
    <AddRecordDialog
      :show="showAddDialog"
      :date="selectedDate"
      :pregnancy-id="pregnancyStore.currentPregnancy?.id"
      :default-type="addDialogType"
      :edit-record="addDialogRecord"
      @update:show="showAddDialog = $event"
      @saved="onRecordSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { NButton } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useResize } from '@/composables/useResize'
import dayjs from 'dayjs'
import MiniCalendar from '@/components/record/MiniCalendar.vue'
import RecordList from '@/components/record/RecordList.vue'
import AddRecordDialog from '@/components/record/AddRecordDialog.vue'

const pregnancyStore = usePregnancyStore()
const { isMobile } = useResize()

const selectedDate = ref(dayjs().format('YYYY-MM-DD'))

function onDateSelect(date: string) {
  selectedDate.value = date
}

function onRecordSaved() {
  window.dispatchEvent(new CustomEvent('record-added'))
}

const showAddDialog = ref(false)
const addDialogType = ref<string | undefined>(undefined)
const addDialogRecord = ref<any>(null)

function openAddDialog() {
  addDialogType.value = undefined
  addDialogRecord.value = null
  showAddDialog.value = true
}

function onEditRecord(payload: { type: string; record: any }) {
  addDialogType.value = payload.type
  addDialogRecord.value = payload.record
  showAddDialog.value = true
}
</script>

<style scoped>
.record-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* ====== 桌面端布局 ====== */
.record-layout {
  display: flex;
  gap: 20px;
  height: 100%;
  min-height: 0;
}

.calendar-panel {
  flex: 0 0 40%;
  max-width: 40%;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.record-panel {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 4px;
}

.record-panel .record-list-wrap {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.record-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.record-header h3 {
  font-size: 16px;
  color: var(--text-color, #1e293b);
  margin: 0;
}

/* ====== 手机端布局 ====== */
.mobile-calendar-wrap {
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg-color, #fff);
  padding-bottom: 8px;
}

.mobile-record-panel {
  flex-shrink: 0;
}

.mobile-record-panel .record-header {
  position: sticky;
  top: 0;
  background: var(--bg-color, #fff);
  z-index: 5;
  padding: 8px 0;
}

.mobile-record-panel .record-header h3 {
  font-size: 15px;
}

/* ====== 共用 ====== */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-hint, #94a3b8);
}
.loading-state p { margin-top: 12px; font-size: 14px; }

@media (max-width: 768px) {
  .record-view {
    height: auto;
    min-height: 100%;
    overflow: visible;
  }
}
</style>
