<template>
  <div class="checkup-schedule-view">
    <!-- 顶部摘要区 -->
    <div class="summary-section" :style="summaryStyle">
      <div class="summary-content">
        <div class="summary-stats">
          <div class="stat-item">
            <div class="stat-value">{{ completedCount }}/{{ totalCount }}</div>
            <div class="stat-label">已完成产检</div>
          </div>
          <div class="stat-progress">
            <div class="progress-bar-wrapper">
              <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="progress-text">{{ progressPercent }}%</div>
          </div>
        </div>
        <div v-if="nextCheckup" class="next-checkup">
          <div class="next-label">🕐 下一次产检</div>
          <div class="next-name">{{ nextCheckup.name }}（孕{{ nextCheckup.week_range || '--' }}周）</div>
        </div>
      </div>
    </div>

    <!-- 当前推荐高亮 -->
    <div v-if="currentCheckup" class="current-recommend" @click="scrollToCurrent">
      ⭐ 本次推荐: {{ currentCheckup.name }}（孕{{ currentCheckup.week_range }}周）→
    </div>

    <!-- 操作栏 -->
    <div class="action-bar">
      <span class="action-bar-title">产检列表</span>
      <n-button type="primary" size="small" @click="showAddDialog = true">+ 添加自定义</n-button>
    </div>

    <!-- 产检列表 -->
    <div class="checkup-list">
      <div
        v-for="item in mergedList"
        :key="item._key"
        :ref="(el) => { if (item.id === currentCheckupId) currentEl = el as HTMLElement }"
        class="checkup-card"
        :class="{
          'is-completed': item.is_completed,
          'is-current': item.id === currentCheckupId && item._type === 'standard',
          'is-mandatory': item.is_mandatory,
          'is-custom': item._type === 'custom',
        }"
      >
        <div class="card-header">
          <div class="card-left">
            <span v-if="item._type === 'standard' && item.week_range" class="week-badge">{{ item.week_range }}</span>
            <span v-else-if="item._type === 'custom' && item.week_start" class="week-badge">孕{{ item.week_start }}周</span>
            <span v-else class="week-badge">自定义</span>
            <span class="checkup-name">{{ item.name }}</span>
            <!-- 预计检查日期 + 倒计时 -->
            <span v-if="item.expected_date" class="expected-date-tag" :class="{ 'is-urgent': daysUntilExpected(item.expected_date) <= 7 && daysUntilExpected(item.expected_date) >= 0 }">
              预计 {{ dayjs(item.expected_date).format('MM-DD') }}
              <template v-if="daysUntilExpected(item.expected_date) === 0"> · 📍今天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) === 1"> · ⏰明天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) > 1 && daysUntilExpected(item.expected_date) <= 7"> · 还有{{ daysUntilExpected(item.expected_date) }}天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) > 7"> · 还有{{ daysUntilExpected(item.expected_date) }}天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) < 0"> · 已过{{ Math.abs(daysUntilExpected(item.expected_date)) }}天</template>
            </span>
            <n-tag v-if="item._type === 'standard' && item.is_recommended !== false" size="tiny" type="warning" :bordered="false">⭐ 推荐</n-tag>
            <n-tag v-if="item._type === 'custom'" size="tiny" type="info" :bordered="false">自定义</n-tag>
          </div>
          <div class="card-right">
            <!-- 预计日期倒计时（只读） -->
            <span v-if="item.expected_date" class="expected-date-tag" :class="{ 'is-urgent': daysUntilExpected(item.expected_date) <= 7 && daysUntilExpected(item.expected_date) >= 0 }">
              {{ dayjs(item.expected_date).format('MM/DD') }}
              <template v-if="daysUntilExpected(item.expected_date) === 0"> · 今天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) > 0"> · 还有{{ daysUntilExpected(item.expected_date) }}天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) < 0"> · 已过{{ Math.abs(daysUntilExpected(item.expected_date)) }}天</template>
            </span>
            <!-- 完成日期（可输入） -->
            <input
              type="date"
              class="date-input-small"
              :value="scheduleDates[item.id] || ''"
              :placeholder="'完成日期'"
              @change="(e) => onDateChange(item, (e.target as HTMLInputElement).value)"
              @click.stop
            />
            <n-tag v-if="item.is_mandatory" size="small" type="error" :bordered="false">必检</n-tag>
            <n-tag v-else-if="item._type === 'standard'" size="small" type="default" :bordered="false">选检</n-tag>
            <span v-if="item.is_completed" class="completed-mark">✅</span>
            <n-button
              v-if="item._type === 'custom'"
              size="tiny"
              quaternary
              type="error"
              @click="deleteCustom(item.id)"
            >🗑</n-button>
          </div>
        </div>

        <!-- 准备事项（仅标准产检显示） -->
        <div v-if="item._type === 'standard' && item.preparation?.length" class="preparation-section">
          <div class="preparation-toggle" @click="togglePrepCollapse(item.id)">
            <span class="prep-icon">📋</span>
            <span class="prep-title">检查准备</span>
            <span class="prep-count">{{ item.preparation.length }}条提示</span>
            <span class="prep-arrow">{{ prepCollapsed[item.id] ? '▸' : '▾' }}</span>
          </div>
          <div v-if="!prepCollapsed[item.id]" class="preparation-list">
            <div v-for="(tip, ti) in item.preparation" :key="ti" class="prep-item" :class="{ 'is-warning': tip.includes('⚠️') }">
              <span class="prep-bullet">{{ tip.includes('⚠️') ? '!' : '·' }}</span>
              <span class="prep-text">{{ tip }}</span>
            </div>
          </div>
        </div>

        <!-- 有子项的产检（标准或自定义）：子项可折叠 -->
        <div v-if="item.items?.length" class="sub-items-section">
          <!-- 子项折叠头 -->
          <div class="sub-items-toggle" @click="toggleSubItemsCollapse(item)">
            <span class="sub-items-icon">📝</span>
            <span class="sub-items-title">检查内容</span>
            <span class="sub-items-count">{{ item.items.length }}项</span>
            <span class="sub-items-badge-required">
              {{ item.items.filter(si => isSubItemRequired(item, si)).length }}必检
            </span>
            <span class="sub-items-arrow">{{ subItemsCollapsed[item._key] ? '▸ 展开查看' : '▾ 收起' }}</span>
          </div>
          <!-- 子项列表（默认折叠） -->
          <div v-if="!subItemsCollapsed[item._key]" class="sub-items-body">
          <div v-for="(subItem, idx) in item.items" :key="idx" class="sub-item-row" :class="{ collapsed: isSubItemCollapsed(item, subItem) }">
            <div class="sub-item-header" @click="toggleSubItemCollapse(item, subItem)">
              <span class="sub-item-name">{{ subItemName(item, subItem) }}</span>
              <!-- 必检/推荐标签 -->
              <span v-if="isSubItemRequired(item, subItem)" class="sub-item-required-tag">必检</span>
              <span v-else class="sub-item-recommended-tag">推荐</span>
              <span class="sub-item-cat-tag" :class="'cat-' + autoCategory(subItemName(item, subItem))">{{ autoCategoryLabel(subItemName(item, subItem)) }}</span>
              <span v-if="getSubItemReportCount(item, subItemName(item, subItem))" class="sub-item-count">{{ getSubItemReportCount(item, subItemName(item, subItem)) }}份</span>
              <span class="sub-item-fold">{{ isSubItemCollapsed(item, subItem) ? '▸' : '▾' }}</span>
              <label class="sub-item-upload-btn" @click.stop>
                <input type="file" accept="image/*,.pdf" style="display:none" @change="(e) => handleSubItemUpload(e, item, subItemName(item, subItem))" />
                <span>📎 上传</span>
              </label>
              <span class="sub-item-nas-btn" @click.stop="handleSubItemNasSelect(item, subItemName(item, subItem))">🖥</span>
            </div>
            <div v-if="!isSubItemCollapsed(item, subItem) && getSubItemReports(item, subItemName(item, subItem)).length" class="sub-item-reports">
              <div v-for="r in getSubItemReports(item, subItemName(item, subItem))" :key="r.id" class="report-thumb-sm" @click="openReport(r)">
                <template v-if="r.file_type === 'image'">
                  <img :src="getReportUrl(r.id)" class="report-img-sm" />
                </template>
                <template v-else>
                  <div class="report-pdf-sm">📄<span class="pdf-label-sm">{{ r.filename }}</span></div>
                </template>
                <button class="report-del-sm" @click.stop="deleteReport(r, item)">✕</button>
              </div>
            </div>
          </div>
          </div><!-- /sub-items-body -->
          <!-- 未分类报告（旧数据兼容） -->
          <div v-if="getUncategorizedReports(item).length" class="sub-item-row" :class="{ collapsed: isSubItemCollapsed(item, '__uncategorized__') }">
            <div class="sub-item-header" @click="toggleSubItemCollapse(item, '__uncategorized__')">
              <span class="sub-item-name">其他报告</span>
              <span class="sub-item-count">{{ getUncategorizedReports(item).length }}份</span>
              <span class="sub-item-fold">{{ isSubItemCollapsed(item, '__uncategorized__') ? '▸' : '▾' }}</span>
            </div>
            <div v-if="!isSubItemCollapsed(item, '__uncategorized__')" class="sub-item-reports">
              <div v-for="r in getUncategorizedReports(item)" :key="r.id" class="report-thumb-sm" @click="openReport(r)">
                <template v-if="r.file_type === 'image'">
                  <img :src="getReportUrl(r.id)" class="report-img-sm" />
                </template>
                <template v-else>
                  <div class="report-pdf-sm">📄<span class="pdf-label-sm">{{ r.filename }}</span></div>
                </template>
                <button class="report-del-sm" @click.stop="deleteReport(r, item)">✕</button>
              </div>
            </div>
          </div>
          <div v-if="getItemReportCount(item) === 0" class="sub-items-empty">暂无报告，点击子项旁的📎上传</div>
        </div>

        <!-- 自定义产检 / 无子项的标准产检：保持原有上传方式 -->
        <div v-else class="report-section">
          <div class="report-header">
            <span class="report-label">📎 报告 ({{ getItemReportCount(item) }})</span>
          </div>
          <div class="category-tabs">
            <button v-for="cat in allCategories" :key="cat.value" class="cat-tab" :class="{ active: activeCategory[item._key] === cat.value }" @click="activeCategory[item._key] = cat.value">
              {{ cat.label }}
              <span class="cat-count" v-if="getCategoryCount(item, cat.value)">{{ getCategoryCount(item, cat.value) }}</span>
            </button>
          </div>
          <div class="upload-bar">
            <label class="report-upload-btn">
              <input type="file" accept="image/*,.pdf" style="display:none" @change="(e) => handleReportUpload(e, item)" />
              <span>📱 本地上传</span>
            </label>
            <span class="upload-link nas-upload" @click.stop="openNasBrowser(item)">🖥 NAS选择</span>
            <span class="current-cat-hint">当前: {{ getCurrentCatLabel(item) }}</span>
          </div>
          <div class="report-grid" v-if="filteredReports(item).length">
            <div v-for="r in filteredReports(item)" :key="r.id" class="report-thumb" @click="openReport(r)">
              <span class="thumb-cat-tag">{{ r.report_category || '其他' }}</span>
              <template v-if="r.file_type === 'image'">
                <img :src="getReportUrl(r.id)" :alt="r.filename" class="report-img" />
              </template>
              <template v-else>
                <div class="report-pdf-icon"><span class="pdf-icon">📄</span><span class="pdf-name">{{ r.filename }}</span></div>
              </template>
              <button class="report-delete-btn" @click.stop="deleteReport(r, item)">✕</button>
            </div>
          </div>
          <div v-else class="report-empty">暂无报告，点击上方上传</div>
        </div>

        <div class="card-footer">
          <n-button
            v-if="!item.is_completed"
            size="small"
            type="primary"
            ghost
            @click="markComplete(item)"
          >
            标记完成
          </n-button>
          <span v-else class="completed-text">已完成</span>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="mergedList.length === 0 && !loading" class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">暂无产检时间表数据</div>
    </div>

    <!-- 添加自定义产检对话框 -->
    <n-modal v-model:show="showAddDialog" preset="card" title="添加自定义产检" style="max-width: 480px">
      <n-form label-placement="left" label-width="80">
        <n-form-item label="检查名称">
          <n-input v-model:value="customForm.name" placeholder="如：额外B超、专项复查" clearable />
        </n-form-item>
        <n-form-item label="检查子项">
          <div class="custom-items-editor">
            <!-- 已选子项列表 -->
            <div v-if="customForm.items.length" class="custom-items-list">
              <div v-for="(item, idx) in customForm.items" :key="idx" class="custom-item-row">
                <n-input v-model:value="customForm.items[idx]" placeholder="如：B超、血常规" size="small" style="flex:1" />
                <span class="custom-item-del" @click="customForm.items.splice(idx, 1)">✕</span>
              </div>
            </div>
            <div v-else class="no-items-hint">暂未添加子项</div>
            <n-button size="small" dashed type="primary" block style="margin-top:8px" @click="showPresetPicker = true">
              + 从常用项目中选择
            </n-button>
            <n-button size="tiny" quaternary type="primary" style="margin-top:6px" @click="customForm.items.push('')">+ 手动输入子项</n-button>
            <div class="custom-items-hint">添加后每个子项可独立上传分类报告</div>
          </div>
        </n-form-item>
        <n-form-item label="计划日期" :show-feedback="false">
          <input
            type="date"
            class="custom-date-input"
            :value="customForm.checkup_date"
            @input="(e: Event) => customForm.checkup_date = (e.target as HTMLInputElement).value"
            placeholder="请选择或输入日期"
          />
        </n-form-item>
        <n-form-item label="备注">
          <n-input v-model:value="customForm.notes" type="textarea" placeholder="检查备注（选填）" :rows="2" />
        </n-form-item>
      </n-form>
      <template #action>
        <n-button @click="showAddDialog = false">取消</n-button>
        <n-button type="primary" :loading="savingCustom" @click="handleAddCustom">添加</n-button>
      </template>
    </n-modal>

    <!-- 检查项目选择子弹窗 -->
    <n-modal v-model:show="showPresetPicker" preset="card" title="选择检查项目" style="max-width: 560px">
      <div class="preset-picker-body">
        <div class="preset-search">
          <n-input v-model:value="presetSearchText" placeholder="搜索检查项目..." clearable>
            <template #prefix>🔍</template>
          </n-input>
        </div>
        <div class="preset-category-list">
          <div v-for="(items, cat) in filteredPresetCategories" :key="cat" class="preset-category-group">
            <div class="preset-category-title">{{ cat }}</div>
            <div class="preset-items-grid">
              <span
                v-for="pi in items"
                :key="pi"
                class="preset-item-tag"
                :class="{ 'is-added': customForm.items.includes(pi) }"
                @click="togglePresetItem(pi)"
              >{{ pi }}</span>
            </div>
          </div>
        </div>
        <div v-if="Object.keys(filteredPresetCategories).length === 0" class="preset-no-result">未找到匹配项目</div>
      </div>
      <div class="preset-picker-footer">
        <span class="preset-selected-count">已选 {{ customForm.items.length }} 项</span>
        <n-button type="primary" @click="showPresetPicker = false">确定</n-button>
      </div>
    </n-modal>

    <!-- NAS 文件浏览器 -->
    <n-modal v-model:show="showNasBrowser" preset="card" title="从NAS选择文件" style="max-width: 600px; height: 70vh">
      <div class="nas-browser">
        <div class="nas-breadcrumb">
          <n-button size="tiny" quaternary @click="nasGoUp" :disabled="!nasParent">⬆ 上层</n-button>
          <span class="nas-current-path">{{ nasCurrentPath }}</span>
        </div>
        <div v-if="nasLoading" class="nas-loading">加载中...</div>
        <div v-else class="nas-file-list">
          <div
            v-for="entry in nasEntries"
            :key="entry.path"
            class="nas-entry"
            :class="{ 'is-dir': entry.type === 'dir', 'is-file': entry.type === 'file' }"
            @click="entry.type === 'dir' ? navigateNas(entry.path) : nasSelectFile(entry)"
          >
            <span class="nas-entry-icon">{{ entry.type === 'dir' ? '📁' : '📄' }}</span>
            <span class="nas-entry-name">{{ entry.name }}</span>
            <span v-if="entry.type === 'file'" class="nas-entry-size">{{ formatSize(entry.size) }}</span>
          </div>
          <div v-if="nasEntries.length === 0 && !nasLoading" class="nas-empty">此目录为空</div>
        </div>
      </div>
      <template #action>
        <n-button @click="showNasBrowser = false">取消</n-button>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { NTag, NButton, NModal, NForm, NFormItem, NInput, useMessage } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { markCheckupCompleted } from '@/api/checkup-schedule'
import { checkupApi } from '@/api/checkup'
import dayjs from 'dayjs'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

// ========== 产检时间表默认数据（内嵌，不依赖后端） ==========
// 检查子项结构：{ name: 名称, required: true(必检) | false(推荐) }
interface CheckupSubItem { name: string; required: boolean }

const DEFAULT_SCHEDULE = [
  {
    id: "cs_001", week_range: "5-8周(孕2月)", week_start: 5, week_end: 8,
    name: "早孕检查（首次产检·建档）",
    items: [
      { name: "建档/建母子健康手册", required: true },
      { name: "经阴道B超确认宫内妊娠", required: true },
      { name: "血HCG+孕酮", required: true },
      { name: "血常规(五分类)", required: true },
      { name: "尿常规", required: false },
      { name: "甲状腺功能(TSH/FT3/FT4/TPOAb)", required: true },
      { name: "肝功能(全套)", required: true },
      { name: "肾功能(肌酐/尿素氮/尿酸)", required: true },
      { name: "空腹血糖(FPG)", required: true },
      { name: "血型(ABO+Rh)", required: true },
      { name: "乙肝五项+丙肝抗体", required: true },
      { name: "梅毒筛查+HIV抗体", required: true },
      { name: "心电图(ECG)", required: false },
      { name: "基础血压体重测量", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "首次产检，确认宫内妊娠、核实孕周、排除异位妊娠、建立母子健康手册",
    preparation: ["经阴道B超无需憋尿（经腹部需憋尿）", "空腹抽血（肝肾功能/血糖/甲状腺功能等均需空腹）", "带好身份证、医保卡、结婚证等建档资料", "建议早上空腹前往，抽血后可进食"]
  },
  {
    id: "cs_002", week_range: "11-13+6周(孕3月)", week_start: 11, week_end: 13,
    name: "NT检查（早期唐筛）",
    items: [
      { name: "NT超声测量(颈项透明层厚度)", required: true },
      { name: "早期唐氏筛查(血清学PAPP-A+游离β-HCG)", required: true },
      { name: "血常规", required: false },
      { name: "尿常规", required: false },
      { name: "子痫前期联合筛查(可选)", required: false },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "通过NT值和血清学指标评估胎儿染色体异常风险。NT最佳时间窗11w+0~13w+6天，CRL 45~84mm",
    preparation: ["NT超声无需空腹无需憋尿", "早期唐筛血清学部分需空腹抽血", "⚠️ 必须在14周前完成，过期颈项透明层消失无法检测", "建议提前预约，NT有时间窗限制"]
  },
  {
    id: "cs_003", week_range: "15-20周(孕4-5月)", week_start: 15, week_end: 20,
    name: "中期唐筛/无创DNA",
    items: [
      { name: "中期唐氏筛查(二联/三联)", required: true },
      { name: "无创DNA(NIPT)(替代方案)", required: false },
      { name: "无创DNA-PLUS(≥35岁首选)", required: false },
      { name: "羊水穿刺(介入性产前诊断)", required: false },
      { name: "血常规", required: false },
      { name: "尿常规", required: false },
      { name: "血压体重宫高腹围", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "评估21三体、18三体、开放性神经管缺陷风险。≥35岁或唐筛高风险者选无创DNA或羊穿",
    preparation: ["中期唐筛需空腹", "无创DNA无需空腹", "携带身份证和医保卡", "高龄孕妇(≥35岁)建议直接选择无创DNA-PLUS或羊水穿刺", "唐筛和无创二选一即可"]
  },
  {
    id: "cs_004", week_range: "20-24周(孕5-6月)", week_start: 20, week_end: 24,
    name: "大排畸（系统超声）",
    items: [
      { name: "系统超声检查(大排畸)", required: true },
      { name: "胎儿心脏彩超(如有指征)", required: false },
      { name: "血常规", required: false },
      { name: "尿常规", required: false },
      { name: "血压体重宫高腹围", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "详细检查胎儿各器官结构发育，排查重大畸形。最佳时间22-26周",
    preparation: ["无需空腹", "无需憋尿（中晚期B超不需充盈膀胱）", "穿着宽松便于暴露腹部", "胎儿不配合时可能需要走动后再查", "⚠️ 建议提前预约，检查时间较长(30-60分钟)"]
  },
  {
    id: "cs_005", week_range: "24-28周(孕6-7月)", week_start: 24, week_end: 28,
    name: "糖耐量筛查(OGTT)",
    items: [
      { name: "OGTT糖耐量试验(75g×3次抽血)", required: true },
      { name: "GBS(B族链球菌)筛查(新指南推荐提前至24-28周)", required: true },
      { name: "血常规(排查贫血)", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "口服葡萄糖耐量试验筛查妊娠期糖尿病；GBS筛查阳性分娩时需预防性使用抗生素",
    preparation: ["⚠️ 前一天晚10点后禁食禁水", "⚠️ 空腹至少8-10小时（非常重要！）", "OGTT前3天保持正常饮食，不要刻意减少碳水", "当天带一杯温水（医院可能提供糖水）", "OGTT全程约3小时（空腹+1h+2h三次抽血）", "期间不能进食饮水，可少量活动", "可自带零食，结束后补充能量"]
  },
  {
    id: "cs_006", week_range: "28-30周(孕7-8月)", week_start: 28, week_end: 30,
    name: "晚孕初期检查（小排畸）",
    items: [
      { name: "B超检查胎儿生长发育(小排畸)", required: true },
      { name: "血常规(重点排查贫血)", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎位检查", required: true },
      { name: "乙肝/HIV/梅毒复查", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "进入孕晚期，开始每两周一次产检。关注胎儿生长发育、胎位及贫血情况",
    preparation: ["一般无需空腹", "⚠️ 从28周起每天自数胎动（早中晚各1小时）", "记录近期体重变化（每周增重不超过0.5kg为宜）", "如有水肿、头痛、视力模糊及时告知医生"]
  },
  {
    id: "cs_007", week_range: "30-32周(孕8月)", week_start: 30, week_end: 32,
    name: "晚孕常规检查",
    items: [
      { name: "血常规", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎心监护(NST,20分钟)", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "定期监测孕妇血压、体重增长、胎心状况",
    preparation: ["胎心监护前适当进食（避免低血糖导致胎动减少）", "胎心监护约20-40分钟，可带点零食和水", "自备胎动计数记录给医生参考"]
  },
  {
    id: "cs_008", week_range: "32-34周(孕8-9月)", week_start: 32, week_end: 34,
    name: "晚孕复查",
    items: [
      { name: "B超(胎儿大小/羊水量/胎盘成熟度/脐血流S/D比值)", required: true },
      { name: "血常规", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎心监护(NST)", required: true },
      { name: "骨盆测量(外测量)", required: false },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "评估胎儿生长曲线、羊水量、胎盘成熟度及脐血流情况",
    preparation: ["B超无需特殊准备", "胎心监护前适当进食活动", "关注是否有规律宫缩感或下坠感"]
  },
  {
    id: "cs_009", week_range: "34-36周(孕9月)", week_start: 34, week_end: 36,
    name: "分娩前准备检查",
    items: [
      { name: "GBS筛查(如24-28周未做则补做)(阴道拭子)", required: true },
      { name: "血常规+凝血功能", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎心监护(NST)", required: true },
      { name: "B超评估胎儿体重及入盆情况", required: true },
      { name: "骨盆测量(内/外测量)", required: true },
      { name: "心电图(ECG)", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "全面评估分娩条件，确定分娩方式意向，做好待产准备",
    preparation: ["心电图穿宽松衣物勿佩戴金属饰品", "GBS采样前避免阴道冲洗或用药", "与医生讨论分娩方式意向（顺产/剖宫产/无痛分娩）", "确认待产包清单是否齐全"]
  },
  {
    id: "cs_010", week_range: "37周(孕10月·足月)", week_start: 37, week_end: 37,
    name: "足周初检",
    items: [
      { name: "血常规", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎心监护(NST)", required: true },
      { name: "宫颈检查(Bishop评分)", required: true },
      { name: "分娩征兆评估(见红/破水/规律宫缩)", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "胎儿足月！从本周起每周产检直至分娩。随时可能临产",
    preparation: ["每周一次产检直至分娩", "密切关注破水、见红、规律宫缩(5-6分钟/次)等临产信号", "随身携带待产包、证件、医保卡", "每天认真数胎动（异常立即就医）"]
  },
  {
    id: "cs_011", week_range: "38周(孕10月)", week_start: 38, week_end: 38,
    name: "足周复检",
    items: [
      { name: "血常规", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎心监护(NST)", required: true },
      { name: "宫颈评分(Bishop)", required: true },
      { name: "B超(羊水/胎盘/脐带)(如需要)", required: false },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "继续每周产检，评估宫颈条件和临产征兆",
    preparation: ["继续每周产检", "超过预产期(40+1周)未发动需讨论催产方案", "确认入院路线和联系方式"]
  },
  {
    id: "cs_012", week_range: "39周(孕10月)", week_start: 39, week_end: 39,
    name: "预产期前检查",
    items: [
      { name: "血常规", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎心监护(NST)", required: true },
      { name: "宫颈检查", required: true },
      { name: "B超(羊水和胎盘评估)", required: false },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "接近预产期，密切观察临产信号",
    preparation: ["到达预产期附近！随时可能临产", "41周未分娩通常需住院引产", "每天认真数胎动（早中晚各1小时）", "确保所有入院物品已打包就绪"]
  },
  {
    id: "cs_013", week_range: "40周(预产期)", week_start: 40, week_end: 40,
    name: "预产期检查",
    items: [
      { name: "血常规", required: true },
      { name: "尿常规", required: true },
      { name: "血压体重宫高腹围", required: true },
      { name: "胎心监护(NST)", required: true },
      { name: "宫颈评分(Bishop)", required: true },
      { name: "B超(羊水量/胎盘钙化程度)", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "预产期当天！如未发动需评估是否需要催产",
    preparation: ["预产期到了！大多数宝宝会在前后两周内出生", "超过41周需住院处理", "保持良好心态，准备好迎接宝宝"]
  },
  {
    id: "cs_014", week_range: "41周(过期妊娠)", week_start: 41, week_end: 41,
    name: "催产评估",
    items: [
      { name: "胎心监护(NST)", required: true },
      { name: "B超评估羊水量", required: true },
      { name: "胎盘功能评估", required: true },
      { name: "宫颈成熟度评分(Bishop评分)", required: true },
      { name: "血压体重", required: true },
      { name: "尿常规", required: true },
      { name: "凝血功能复查", required: false },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "超过预产期1周，住院评估胎儿状况与宫颈条件，决定催产方式",
    preparation: ["通常需住院观察", "了解缩宫素静滴和人工破膜的过程", "做好心理准备，过期妊娠风险略增"]
  },
  {
    id: "cs_015", week_range: "42周(过期妊娠)", week_start: 42, week_end: 42,
    name: "过期妊娠处理",
    items: [
      { name: "持续电子胎心监护", required: true },
      { name: "B超(羊水量与胎盘钙化)", required: true },
      { name: "OCT催产素激惹试验", required: true },
      { name: "血压体重", required: true },
      { name: "尿常规", required: true },
      { name: "凝血功能与肝肾功能复查", required: true },
    ] as CheckupSubItem[],
    is_mandatory: true, description: "已达过期妊娠（≥42周），需严密监护，积极催产或剖宫产终止妊娠",
    preparation: ["必须住院处理", "持续电子胎心监护", "胎盘功能下降风险高，密切观察胎动", "做好剖宫产准备"]
  },
]

interface MergedItem {
  _key: string
  _type: 'standard' | 'custom'
  id: string
  name: string
  week_range?: string
  week_start?: number
  week_end?: number
  checkup_date?: string | null
  items?: (string | CheckupSubItem)[]   // 标准产检为CheckupSubItem[]，自定义为string[]
  is_mandatory?: boolean
  description?: string
  notes?: string | null
  is_completed: boolean | number
  is_recommended?: boolean
  preparation?: string[]
  expected_date?: string  // 预计检查日期（基于LMP推算）
}

interface ReportItem {
  id: string; checkup_id: string; checkup_type: string; filename: string
  file_path: string; file_type: string; file_size: number; report_category: string
  sub_item?: string; created_at: string
}

interface NasEntry { name: string; path: string; type: 'dir' | 'file'; size: number; mtime: number }

// ========== 状态 ==========
const schedule = ref<any[]>([...DEFAULT_SCHEDULE])  // 初始化就有数据！
const customCheckups = ref<any[]>([])
const reportMap = ref<Record<string, ReportItem[]>>({})
const loading = ref(false)
const currentEl = ref<HTMLElement | null>(null)
const showAddDialog = ref(false)
const customForm = ref({ name: '', items: [] as string[], checkup_date: '', notes: '' })
const savingCustom = ref(false)
const showPresetPicker = ref(false)
const presetSearchText = ref('')

// 预设医院检查项目（按类别分组展示）
const presetItems = [
  // === 筛查类 ===
  '早期唐筛(血清学)', '中期唐筛(二联/三联)', '无创DNA(NIPT)',
  '染色体核型分析', '染色体微阵列(CMA)', '全外显子组测序(WES)',
  '单基因病携带者筛查', '地贫筛查(α+β)', 'G6PD缺乏症(蚕豆病)筛查',
  '脊髓性肌萎缩症(SMA)携带者筛查', '耳聋基因筛查',
  '尼氏症(地中海贫血)叶酸检测', '肝功能筛查',
  'TORCH筛查(弓形虫/风疹/巨细胞/单纯疱疹)', 'HIV抗体', '梅毒螺旋体(TPPA/RPR)',
  // === 超声类 ===
  'NT超声(颈项透明层)', '早孕B超(确认宫内)', '阴道B超',
  '大排畸超声(系统B超)', '小排畸超声(生长测量)', '三维/四维B超',
  '胎儿心脏彩超(胎儿超声心动图)', '胎儿生物物理评分(BPP)',
  '宫颈长度测量(经阴道)', '羊水指数(AFI)测量', '羊水最大深度测量',
  '胎盘位置及成熟度评估', '脐动脉血流S/D比值监测', '脐带绕颈评估',
  '多普勒听胎心', '胎位确认(B超)',
  // === 阴道/妇科检查 ===
  '白带常规(阴道分泌物)', 'BV检测(细菌性阴道病)',
  '支原体培养+药敏', '衣原体抗原检测', '淋球菌检测',
  'TCT(液基薄层细胞学)', 'HPV分型检测(高危+低危)', '阴道镜检查',
  '宫颈活检', 'GBS(B族链球菌)筛查(35-37周)',
  '绒毛膜活检(CVS)(11-14周)', '羊水穿刺(16-22周)', '脐血穿刺',
  // === 胎心监护 ===
  '胎心监护(NST,20分钟)', '胎心监护(NST,40分钟)', '缩宫素激惹试验(OCT/CST)',
  '多普勒听胎心(常规)', '电子胎心监护(产时)',
  // === 体格检查 ===
  '体重测量', '血压测量(收缩压/舒张压)', '宫高测量', '腹围测量',
  '骨盆测量(外测量)', '骨盆测量(内测量/CT)', '胎位检查(四步触诊法)',
  '宫颈检查( Bishop评分)', '乳房检查', '水肿评估', '静脉曲张检查',
  '心电图(ECG)', '眼底检查', '口腔检查', '骨密度检测',
  // === 血液检验 ===
  '血常规(五分类)', '血型鉴定(ABO+Rh)', 'ABO溶血筛查',
  '空腹血糖(FPG)', '餐后2h血糖', '随机血糖',
  'OGTT糖耐量试验(75g,3次抽血)', 'OGTT糖耐量筛查(50g)',
  '糖化血红蛋白(HbA1c)', '胰岛素释放试验', 'C肽释放试验',
  '肝功能(全套8项)', '肝功能(谷丙/谷草转氨酶)', '胆汁酸(TBA)',
  '肾功能(肌酐/尿素氮/尿酸)', '电解质(K/Na/Cl/Ca)',
  '甲状腺功能(甲功5项)', '甲状腺功能(甲功7项/TSH/T3/T4/FT3/FT4/TPOAb/TgAb)',
  '抗甲状腺过氧化物酶抗体(TPOAb)', '抗甲状腺球蛋白抗体(TgAb)',
  '凝血功能4项(PT/APTT/TT/FIB)', 'D-二聚体(D-Dimer)', '纤维蛋白原降解产物(FDP)',
  'C反应蛋白(CRP,超敏)', '降钙素原(PCT)', '血沉(ESR)',
  '铁蛋白(SF)', '铁代谢(铁/铁结合力/转铁蛋白饱和度)',
  '维生素B12', '叶酸', '25-羟基维生素D(25-OH-VitD)',
  '乙肝五项(两对半)', 'HBV-DNA定量', '丙肝抗体(HCV-Ab)', 'HCV-RNA定量',
  '甲肝抗体(HAV)', '戊肝抗体(HEV)',
  // === 尿液检验 ===
  '尿常规(11项)', '尿沉渣镜检', '尿蛋白定性', '尿蛋白定量(24h)',
  '尿培养+药敏', '尿酮体', '尿糖', '24小时尿蛋白总量',
  // === 其他 ===
  '孕前BMI计算', '孕期体重管理评估', '营养咨询',
  '盆底肌评估', '产后康复评估', '母乳喂养指导',
]

// 预设项目按类别分组（用于子弹窗展示）
const presetCategories: Record<string, string[]> = {
  '🔬 筛查类': [
    '染色体核型分析(G显带)', '染色体微阵列(CMA)', '全外显子组测序(WES)', '单基因病携带者筛查',
    '地贫筛查(α+β)', 'G6PD缺乏症(蚕豆病)筛查', '脊髓性肌萎缩症(SMA)携带者筛查',
    '耳聋基因筛查', '尼氏症(地中海贫血)叶酸检测', '肝功能筛查', 'TORCH筛查(弓形虫/风疹/巨细胞/单纯疱疹)',
    'HIV抗体', '梅毒螺旋体(TPPA/RPR)', 'NT超声(颈项透明层)', '早孕B超(确认宫内)',
  ],
  '📊 超声类': [
    '经阴道B超', '经腹部B超', '小排畸超声(生长测量)', '三维/四维B超',
    '胎儿心脏彩超(胎儿超声心动图)', '胎儿生物物理评分(BPP)', '宫颈长度测量(经阴道)',
    '羊水指数(AFI)测量', '羊水最大深度测量', '胎盘位置及成熟度评估',
    '脐动脉血流S/D比值监测', '脐带绕颈评估', '多普勒听胎心',
    '胎位确认(B超)', '白带常规(阴道分泌物)', '支原体培养+药敏', '衣原体抗原检测',
  ],
  '🩺 阴道/妇科': [
    'TCT(液基薄层细胞学)', 'HPV分型检测(高危+低危)', '阴道镜检查', '宫颈活检',
    '绒毛膜活检(CVS)(11-14周)', '羊水穿刺(16-22周)', '脐血穿刺',
    'BV检测(细菌性阴道病)', '霉菌性阴道炎检查', '淋球菌检测',
  ],
  '❤️ 胎心监护': [
    '胎心监护(NST,20分钟)', '胎心监护(NST,40分钟)', '缩宫素激惹试验(OCT/CST)',
    '多普勒听胎心(常规)', '电子胎心监护(产时)',
  ],
  '📋 体格检查': [
    '体重测量', '血压测量(收缩压/舒张压)', '宫高测量', '腹围测量',
    '骨盆测量(外测量)', '骨盆测量(内测量/CT)', '胎位检查(四步触诊法)',
    '宫颈检查(Bishop评分)', '乳房检查', '水肿评估', '静脉曲张检查',
    '心电图(ECG)', '眼底检查', '口腔检查', '骨密度检测',
  ],
  '🩸 血液检验': [
    '血常规(五分类)', '血型鉴定(ABO+Rh)', 'ABO溶血筛查', '空腹血糖(FPG)',
    '餐后2h血糖', '随机血糖', 'OGTT糖耐量试验(75g,3次抽血)', '糖化血红蛋白(HbA1c)',
    '胰岛素释放试验', 'C肽释放试验', '肝功能(全套8项)', '胆汁酸(TBA)',
    '肾功能(肌酐/尿素氮/尿酸)', '电解质(K/Na/Cl/Ca)',
    '甲状腺功能(甲功5项)', '甲状腺功能(甲功7项)', 'TPOAb/TgAb抗体',
    '凝血功能4项(PT/APTT/TT/FIB)', 'D-二聚体(D-Dimer)', 'C反应蛋白(CRP,超敏)',
    '乙肝五项(两对半)', 'HBV-DNA定量', '丙肝抗体(HCV-Ab)', '甲肝抗体(HAV)', '戊肝抗体(HEV)',
    '铁代谢(铁蛋白/血清铁/总铁结合力)', '叶酸水平', '维生素D(25-OH-D)',
    '同型半胱氨酸(Hcy)', '血脂四项', '血沉(ESR)',
  ],
  '💧 尿液检验': [
    '尿常规(11项)', '尿沉渣镜检', '尿蛋白定性', '尿蛋白定量(24h)',
    '尿培养+药敏', '尿酮体', '尿糖', '24小时尿蛋白总量',
  ],
  '📌 其他': [
    '孕前BMI计算', '孕期体重管理评估', '营养咨询', '盆底肌评估',
    '产后康复评估', '母乳喂养指导',
  ],
}

// 搜索过滤后的分类
const filteredPresetCategories = computed(() => {
  const keyword = (presetSearchText.value || '').trim().toLowerCase()
  if (!keyword) return presetCategories
  const result: Record<string, string[]> = {}
  for (const [cat, items] of Object.entries(presetCategories)) {
    const matched = items.filter(i => i.toLowerCase().includes(keyword))
    if (matched.length > 0) result[cat] = matched
  }
  return result
})

const scheduleDates = ref<Record<string, string>>({})
const collapsedItems = ref<Record<string, boolean>>({})
const prepCollapsed = ref<Record<string, boolean>>({})
const subItemsCollapsed = ref<Record<string, boolean>>({})
const activeCategory = ref<Record<string, string>>({})

const allCategories = [
  { label: '全部', value: '_all_' }, { label: 'B超', value: 'b超' }, { label: '血检', value: '血检' },
  { label: '尿检', value: '尿检' }, { label: '血压', value: '血压' }, { label: '血糖', value: '血糖' },
  { label: '胎心', value: '胎心' }, { label: '其他', value: '其他' },
]

// NAS browser
const showNasBrowser = ref(false)
const nasLoading = ref(false)
const nasCurrentPath = ref('/')
const nasParent = ref<string | null>(null)
const nasEntries = ref<NasEntry[]>([])
const nasTargetItem = ref<MergedItem | null>(null)
const nasTargetSubItem = ref<string | null>(null)

// ========== 计算属性 ==========
const currentWeek = computed(() => pregnancyStore.gestationalAge?.weeks ?? 0)

const mergedList = computed<MergedItem[]>(() => {
  const lmp = pregnancyStore.currentPregnancy?.last_period_date
  function dateToWeek(dateStr?: string | null): number | undefined {
    if (!dateStr || !lmp) return undefined
    const totalDays = dayjs(dateStr).diff(dayjs(lmp), 'day')
    return totalDays >= 0 ? Math.floor(totalDays / 7) : undefined
  }
  const standard: MergedItem[] = schedule.value.map(s => {
    // 基于LMP + week_start 计算预计检查日期
    let expectedDate: string | undefined
    if (lmp && s.week_start) {
      expectedDate = dayjs(lmp).add(s.week_start * 7, 'day').format('YYYY-MM-DD')
    }
    return {
      _key: `std_${s.id}`, _type: 'standard' as const, id: s.id, name: s.name,
      week_range: s.week_range, week_start: s.week_start, week_end: s.week_end,
      items: s.items, is_mandatory: s.is_mandatory, description: s.description,
      is_completed: s.is_completed, is_recommended: s.is_recommended ?? true,
      preparation: s.preparation,
      expected_date: expectedDate,
    }
  })
  const custom: MergedItem[] = customCheckups.value.map(c => {
    const weekStart = dateToWeek(c.checkup_date)
    let subItems: string[] | undefined
    if (Array.isArray(c.items)) subItems = c.items
    else if (typeof c.items === 'string') { try { subItems = JSON.parse(c.items) } catch { subItems = undefined } }
    return {
      _key: `cst_${c.id}`, _type: 'custom' as const, id: c.id, name: c.name,
      week_start: weekStart, checkup_date: c.checkup_date, notes: c.notes,
      items: subItems, is_completed: c.is_completed === 1,
    }
  })
  const all = [...standard, ...custom]
  console.log('[mergedList] standard=', standard.length, 'custom=', custom.length, 'total=', all.length)
  all.sort((a, b) => {
    const aWeek = a.week_start ?? 999
    const bWeek = b.week_start ?? 999
    if (aWeek !== bWeek) return aWeek - bWeek
    if (a._type !== b._type) return a._type === 'standard' ? -1 : 1
    return (a.checkup_date || '').localeCompare(b.checkup_date || '')
  })
  return all
})

const currentCheckupId = computed(() => {
  const week = currentWeek.value
  for (const item of schedule.value) {
    if (week >= item.week_start && week <= item.week_end) return item.id
  }
  return ''
})

const currentCheckup = computed(() => {
  if (!currentCheckupId.value) return null
  return schedule.value.find((s: any) => s.id === currentCheckupId.value) || null
})

const completedCount = computed(() => mergedList.value.filter(s => s.is_completed).length)
const totalCount = computed(() => mergedList.value.length)
const progressPercent = computed(() => totalCount.value === 0 ? 0 : Math.round((completedCount.value / totalCount.value) * 100))

const nextCheckup = computed(() => {
  const week = currentWeek.value
  const upcoming = mergedList.value.filter(s => !s.is_completed && ((s.week_start ?? 999) >= week))
  if (upcoming.length > 0) return upcoming[0]
  return mergedList.value.find(s => !s.is_completed) || null
})

const summaryStyle = computed(() => {
  const stage = pregnancyStore.gestationalAge?.trimester || 'early'
  const bgMap: Record<string, string> = { early: 'var(--stage-early-bg)', mid: 'var(--stage-mid-bg)', late: 'var(--stage-late-bg)' }
  return { background: bgMap[stage] || bgMap.early }
})

// ========== 工具函数 ==========
function getReportUrl(reportId: string) { return checkupApi.getReportDownloadUrl(reportId) }

/** 计算距离预计日期还有多少天 */
function daysUntilExpected(dateStr: string): number {
  return dayjs(dateStr).diff(dayjs().startOf('day'), 'day')
}

function getItemReports(item: MergedItem) { return reportMap.value[item._key] || [] }
function getItemReportCount(item: MergedItem) { return getItemReports(item).length }
function getCheckupTypeKey(item: MergedItem): string { return item._type === 'custom' ? 'custom' : 'standard' }
function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function getCategory(item: MergedItem): string {
  const key = item._key
  if (!(key in activeCategory.value)) activeCategory.value[key] = '_all_'
  return activeCategory.value[key] === '_all_' ? '其他' : activeCategory.value[key]
}
function filteredReports(item: MergedItem): ReportItem[] {
  const reports = getItemReports(item) || []
  const cat = activeCategory.value[item._key]
  if (!cat || cat === '_all_') return reports
  return reports.filter(r => r.report_category === cat)
}
function getCategoryCount(item: MergedItem, catValue: string): number {
  if (catValue === '_all_') return getItemReports(item).length
  return getItemReports(item).filter(r => r.report_category === catValue).length
}
function getCurrentCatLabel(item: MergedItem): string {
  const cat = activeCategory.value[item._key] || '全部'
  return allCategories.find(c => c.value === cat)?.label || cat
}

function autoCategory(itemName: string): string {
  if (/B超|超声|NT|排畸|系统超声/i.test(itemName)) return 'b超'
  if (/血常规|血型|肝肾|乙肝|梅毒|HIV|唐氏|唐筛|DNA|糖耐|OGTT|凝血|GBS|链球菌|甲状腺/i.test(itemName)) return '血检'
  if (/尿常规/i.test(itemName)) return '尿检'
  if (/血压|体重|宫高|腹围/i.test(itemName)) return '血压'
  if (/血糖/i.test(itemName)) return '血糖'
  if (/胎心|胎监/i.test(itemName)) return '胎心'
  return '其他'
}
function autoCategoryLabel(itemName: string): string {
  const map: Record<string, string> = { 'b超': 'B超', '血检': '血检', '尿检': '尿检', '血压': '血压/体重', '血糖': '血糖', '胎心': '胎心', '其他': '其他' }
  return map[autoCategory(itemName)] || '其他'
}

function subItemKey(item: MergedItem, subItem: string | CheckupSubItem): string { return `${item._key}::${subItemName(item, subItem)}` }
function isSubItemCollapsed(item: MergedItem, subItem: string | CheckupSubItem): boolean { return !!collapsedItems.value[subItemKey(item, subItem)] }
function toggleSubItemCollapse(item: MergedItem, subItem: string | CheckupSubItem) {
  const key = subItemKey(item, subItem); collapsedItems.value[key] = !collapsedItems.value[key]
}
function togglePrepCollapse(itemId: string) {
  prepCollapsed.value[itemId] = !prepCollapsed.value[itemId]
}
function toggleSubItemsCollapse(item: MergedItem) {
  subItemsCollapsed.value[item._key] = !subItemsCollapsed.value[item._key]
}

// 子项辅助函数（兼容 string | CheckupSubItem 两种格式）
function subItemName(item: MergedItem, subItem: string | CheckupSubItem): string {
  return typeof subItem === 'string' ? subItem : subItem.name
}
function isSubItemRequired(item: MergedItem, subItem: string | CheckupSubItem): boolean {
  if (typeof subItem !== 'string') return subItem.required
  // 自定义子项默认为必检
  return true
}
function getSubItemReports(item: MergedItem, subItem: string): ReportItem[] { return getItemReports(item).filter(r => r.sub_item === subItem) }
function getSubItemReportCount(item: MergedItem, subItem: string): number { return getSubItemReports(item, subItem).length }
function getUncategorizedReports(item: MergedItem): ReportItem[] { return getItemReports(item).filter(r => !r.sub_item) }

// ========== 操作函数 ==========
async function handleSubItemUpload(e: Event, item: MergedItem, subItem: string) {
  const target = e.target as HTMLInputElement; const file = target.files?.[0]; if (!file) return
  try {
    await checkupApi.uploadReport(item.id, file, getCheckupTypeKey(item), autoCategory(subItem), subItem)
    await loadReportsForItem(item); target.value = ''; message.success('上传成功')
  } catch { message.error('上传失败') }
}

async function handleSubItemNasSelect(item: MergedItem, subItem: string) {
  nasTargetItem.value = item; nasTargetSubItem.value = subItem; showNasBrowser.value = true; await navigateNas('/')
}

async function onDateChange(item: MergedItem, dateStr: string) {
  if (!dateStr || !pregnancyStore.currentPregnancy) return
  try {
    await checkupApi.setScheduleDate(pregnancyStore.currentPregnancy.id, item.id, dateStr)
    scheduleDates.value[item.id] = dateStr
  } catch { message.error('设置日期失败') }
}

function scrollToCurrent() { if (currentEl.value) currentEl.value.scrollIntoView({ behavior: 'smooth', block: 'center' }) }

async function markComplete(item: MergedItem) {
  if (!pregnancyStore.currentPregnancy) { message.warning('请先设置孕期信息'); return }
  try {
    if (item._type === 'custom') {
      await checkupApi.markCustomComplete(item.id)
      // 立即更新自定义产检的响应式状态
      const c = customCheckups.value.find(c => c.id === item.id)
      if (c) c.is_completed = 1
    } else {
      await markCheckupCompleted(item.id, pregnancyStore.currentPregnancy.id)
      // 立即更新标准产检的响应式状态
      const s = schedule.value.find(s => s.id === item.id)
      if (s) s.is_completed = true
    }
    message.success('已标记完成')
    // 后台同步后端状态（不阻塞 UI 更新）
    loadAll().catch(() => {})
  } catch (e: any) { message.error(e.message || '操作失败，请重试') }
}

function togglePresetItem(item: string) {
  const idx = customForm.value.items.indexOf(item)
  if (idx >= 0) {
    customForm.value.items.splice(idx, 1)
  } else {
    customForm.value.items.push(item)
  }
}

async function handleAddCustom() {
  const name = (customForm.value.name || '').trim()
  if (!pregnancyStore.currentPregnancy || !name) { message.warning('请输入检查名称'); return }
  if (!customForm.value.checkup_date) { message.warning('请选择计划日期'); return }
  savingCustom.value = true
  try {
    const filteredItems = customForm.value.items.filter(i => i.trim())
    console.log('[handleAddCustom] sending:', { name, itemsCount: filteredItems.length, date: customForm.value.checkup_date })
    const res: any = await checkupApi.createCustom({
      pregnancy_id: pregnancyStore.currentPregnancy.id,
      name,
      items: filteredItems.length ? filteredItems : undefined,
      checkup_date: customForm.value.checkup_date,
      notes: customForm.value.notes || undefined,
    })
    console.log('[handleAddCustom] response:', res)
    message.success('添加成功'); showAddDialog.value = false
    customForm.value = { name: '', items: [], checkup_date: '', notes: '' }
    await loadAll()
    console.log('[handleAddCustom] loadAll done, customCheckups count:', customCheckups.value.length)
  } catch (e: any) {
    console.error('[handleAddCustom] error:', e)
    message.error(e.message || '添加失败，请重试')
  } finally { savingCustom.value = false }
}

async function deleteCustom(id: string) {
  try { await checkupApi.deleteCustom(id); message.success('已删除'); await loadAll() } catch { message.error('删除失败') }
}

async function handleReportUpload(e: Event, item: MergedItem) {
  const target = e.target as HTMLInputElement; const file = target.files?.[0]; if (!file) return
  try {
    await checkupApi.uploadReport(item.id, file, getCheckupTypeKey(item), getCategory(item))
    await loadReportsForItem(item); target.value = ''; message.success('上传成功')
  } catch { message.error('上传失败') }
}

function openReport(report: ReportItem) { window.open(checkupApi.getReportDownloadUrl(report.id), '_blank') }

async function deleteReport(report: ReportItem, item: MergedItem) {
  try { await checkupApi.deleteReport(report.id); message.success('已删除'); await loadReportsForItem(item) } catch { message.error('删除失败') }
}

async function loadReportsForItem(item: MergedItem) {
  try {
    const res: any = await checkupApi.listReports(item.id, getCheckupTypeKey(item))
    reportMap.value[item._key] = res?.data || []
  } catch { reportMap.value[item._key] = [] }
}

// NAS browser
async function openNasBrowser(item: MergedItem) { nasTargetItem.value = item; showNasBrowser.value = true; await navigateNas('/') }

async function navigateNas(path: string) {
  nasLoading.value = true
  try {
    const res: any = await checkupApi.browseNasFiles(path)
    if (res.code === 0 && res.data) { nasCurrentPath.value = res.data.path; nasParent.value = res.data.parent; nasEntries.value = res.data.entries || [] }
  } catch { message.error('浏览失败') }
  nasLoading.value = false
}
function nasGoUp() { if (nasParent.value) navigateNas(nasParent.value) }

async function nasSelectFile(entry: NasEntry) {
  if (!nasTargetItem.value || !pregnancyStore.currentPregnancy) return
  try {
    const item = nasTargetItem.value; const subItem = nasTargetSubItem.value || undefined
    const category = subItem ? autoCategory(subItem) : getCategory(item)
    await checkupApi.uploadReportFromNas(item.id, entry.path, getCheckupTypeKey(item), category, subItem)
    message.success('已从NAS添加报告'); showNasBrowser.value = false; nasTargetSubItem.value = null; await loadReportsForItem(item)
  } catch { message.error('添加失败') }
}

async function loadScheduleDates() {
  if (!pregnancyStore.currentPregnancy) return
  try {
    const res: any = await checkupApi.getScheduleDates(pregnancyStore.currentPregnancy.id)
    if (res.code === 0 && res.data) scheduleDates.value = res.data
  } catch { /* ignore */ }
}

// ========== 核心加载逻辑：默认数据始终可用，后端只补充完成状态 ==========
async function loadAll() {
  loading.value = true
  // 默认数据已经内嵌在 schedule 中了，列表一定有内容
  try {
    const pid = pregnancyStore.currentPregnancy?.id

    // 从后端获取完成状态（如果后端不可用也不影响显示）
    if (pid) {
      try {
        const res: any = await checkupApi.getCompletedWeeks(pid)
        if (res.code === 0 && Array.isArray(res.data)) {
          const completedWeeks = new Set(res.data)
          schedule.value = DEFAULT_SCHEDULE.map(item => ({
            ...item,
            is_completed: (() => {
              const ws = item.week_start || 0; const we = item.week_end || item.week_start || 0
              return Array.from({ length: we - ws + 1 }, (_, i) => ws + i).some(w => completedWeeks.has(w))
            })(),
            is_recommended: false,
          }))
        }
      } catch (e) {
        console.warn('获取完成状态失败，使用默认未完成状态:', e)
      }

      // 获取自定义产检
      try {
        const res: any = await checkupApi.listCustom(pid)
        console.log('[loadAll] listCustom raw response:', JSON.stringify(res)?.slice(0, 300))
        if (res.code === 0 && Array.isArray(res.data)) {
          customCheckups.value = res.data
          console.log('[loadAll] customCheckups assigned:', res.data.length, 'items:', res.data.map((c: any) => ({ id: c.id, name: c.name, date: c.checkup_date })))
        } else {
          console.warn('[loadAll] listCustom unexpected format: code=', res?.code, 'dataType=', Array.isArray(res?.data) ? 'array' : typeof res?.data)
        }
      } catch (e) { console.warn('获取自定义产检失败:', e) }

      await loadScheduleDates()
    }

    // 加载报告
    const reportPromises: Promise<void>[] = []
    const newReportMap: Record<string, ReportItem[]> = {}
    for (const item of mergedList.value) {
      reportPromises.push((async () => {
        try {
          const res: any = await checkupApi.listReports(item.id, getCheckupTypeKey(item))
          newReportMap[item._key] = res?.data || []
        } catch { newReportMap[item._key] = [] }
      })())
    }
    await Promise.all(reportPromises)
    reportMap.value = newReportMap

    // 默认收起所有检查内容
    mergedList.value.forEach(item => {
      if (item.items?.length) {
        subItemsCollapsed.value[item._key] = true
      }
    })
  } finally { loading.value = false }
}

onMounted(() => { loadAll() })
watch(() => pregnancyStore.currentPregnancy?.id, (pid) => { if (pid) loadAll() })
</script>

<style scoped>
.checkup-schedule-view { max-width: 800px; margin: 0 auto; padding: 16px; }

.summary-section { border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.04); }
.summary-stats { display: flex; align-items: center; gap: 24px; margin-bottom: 12px; }
.stat-item { display: flex; flex-direction: column; }
.stat-value { font-size: 28px; font-weight: 800; color: var(--text-color, #1e293b); }
.stat-label { font-size: 13px; color: var(--text-secondary, #64748b); }
.stat-progress { flex: 1; display: flex; align-items: center; gap: 12px; }
.progress-bar-wrapper { flex: 1; height: 10px; background: rgba(255,255,255,.6); border-radius: 5px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: linear-gradient(90deg, #66BB6A, #4FC3F7); border-radius: 5px; transition: width .5s; }
.progress-text { font-size: 14px; font-weight: 700; min-width: 40px; }
.next-checkup { padding-top: 12px; border-top: 1px solid rgba(0,0,0,.06); }
.next-label { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
.next-name { font-size: 16px; font-weight: 600; }

.current-recommend { background: var(--stage-early-bg, #FFF3E0); border: 1px solid var(--stage-early-color, #FFB74D); border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; cursor: pointer; font-size: 14px; font-weight: 600; color: var(--stage-early-color); }

.action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.action-bar-title { font-size: 16px; font-weight: 700; }

.checkup-list { display: flex; flex-direction: column; gap: 12px; }

.checkup-card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.05); border-left: 4px solid #e2e8f0; }
.checkup-card.is-mandatory { border-left-color: #F06292; }
.checkup-card.is-custom { border-left-color: #4FC3F7; border-left-style: dashed; }
.checkup-card.is-completed { background: #E8F5E9; border-left-color: #66BB6A; }
.checkup-card.is-current { box-shadow: 0 0 0 2px #FFB74D, 0 4px 12px rgba(0,0,0,.08); }

.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.card-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-right { display: flex; align-items: center; gap: 8px; }

.week-badge { background: #E1F5FE; color: #4FC3F7; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; }
.is-custom .week-badge { background: rgba(79,195,247,.12); }
.is-completed .week-badge { background: #E8F5E9; color: #66BB6A; }
.checkup-name { font-size: 15px; font-weight: 700; }
/* 预计日期标签 */
.expected-date-tag {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 7px; border-radius: 10px; font-size: 11px;
  background: #e0f2fe; color: #0369a1; margin-left: 4px;
  transition: background .25s, color .25s, font-weight .25s;
}
.expected-date-tag.is-urgent { background: #fef3c7; color: #b45309; font-weight: 600; }
.expected-date-tag.is-urgent:has(.is-overdue) { background: #fee2e2; color: #dc2626; }
.completed-mark { font-size: 18px; }

.date-input-small {
  padding: 4px 8px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  font-size: 13px;
  background: white;
  color: var(--text-color, #1e293b);
  width: 130px;
}
.custom-date-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 10px;
  font-size: 14px;
  background: white;
  color: var(--text-color, #1e293b);
  outline: none;
  transition: border-color .2s;
}
.custom-date-input:focus { border-color: var(--primary-color); }

.card-body { margin-bottom: 12px; }
.checkup-items { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.checkup-item-tag { background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 8px; border-radius: 6px; font-size: 12px; color: #64748b; }
.is-completed .checkup-item-tag { background: rgba(102,187,106,.1); border-color: rgba(102,187,106,.3); color: #66BB6A; }
.checkup-desc { font-size: 13px; color: #94a3b8; line-height: 1.6; }

/* 子项分类上传 */
.sub-items-section { margin-bottom: 12px; }
/* 子项折叠头 */
.sub-items-toggle {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; cursor: pointer; user-select: none;
  background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
  transition: background .15s;
}
.sub-items-toggle:hover { background: #f1f5f9; }
.sub-items-icon { font-size: 14px; }
.sub-items-title { font-size: 13px; font-weight: 600; color: #475569; flex: 1; }
.sub-items-count { font-size: 11px; color: #64748b; background: #e2e8f0; padding: 1px 7px; border-radius: 10px; }
.sub-items-badge-required {
  font-size: 11px; color: #dc2626; font-weight: 600;
  background: #fef2f2; padding: 1px 7px; border-radius: 10px;
}
.sub-items-arrow { font-size: 11px; color: #94a3b8; white-space: nowrap; }
/* 子项内容区 */
.sub-items-body { padding-top: 4px; }
.sub-items-empty { font-size: 12px; color: #94a3b8; text-align: center; padding: 12px 0; }
.sub-item-row { padding: 6px 0; border-bottom: 1px solid #f1f5f9; transition: background .15s; }
.sub-item-row:last-child { border-bottom: none; }
.sub-item-row.collapsed { opacity: .75; }
.sub-item-header {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 4px 0; border-radius: 6px; transition: background .15s;
}
.sub-item-header:hover { background: rgba(0,0,0,.02); }
.sub-item-name { font-size: 13px; font-weight: 500; color: #334155; flex: 1; min-width: 80px; }
/* 子项必检/推荐标签 */
.sub-item-required-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 700;
  background: #fef2f2; color: #dc2626; flex-shrink: 0;
}
.sub-item-recommended-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600;
  background: #fefce8; color: #ca8a04; flex-shrink: 0;
}
.sub-item-cat-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600;
  background: #f1f5f9; color: #64748b; flex-shrink: 0;
}
.sub-item-cat-tag.cat-b超 { background: #E1F5FE; color: #0288D1; }
.sub-item-cat-tag.cat-血检 { background: #FCE4EC; color: #C62828; }
.sub-item-cat-tag.cat-尿检 { background: #FFF3E0; color: #E65100; }
.sub-item-cat-tag.cat-血压 { background: #F3E5F5; color: #7B1FA2; }
.sub-item-cat-tag.cat-血糖 { background: #E8F5E9; color: #2E7D32; }
.sub-item-cat-tag.cat-胎心 { background: #FFF8E1; color: #F57F17; }
.sub-item-count { font-size: 11px; color: var(--primary-color, #c44680); font-weight: 600; flex-shrink: 0; }
.sub-item-fold { font-size: 10px; color: #94a3b8; flex-shrink: 0; transition: transform .2s; }
.sub-item-upload-btn {
  font-size: 11px; color: var(--primary-color, #c44680); cursor: pointer;
  padding: 2px 8px; border: 1px dashed var(--primary-color, #c44680); border-radius: 6px;
  transition: background .2s; white-space: nowrap; flex-shrink: 0;
}
.sub-item-upload-btn:hover { background: rgba(232,160,191,.08); }
.sub-item-nas-btn {
  font-size: 12px; cursor: pointer; padding: 2px 4px; opacity: .6;
  transition: opacity .2s; flex-shrink: 0;
}
.sub-item-nas-btn:hover { opacity: 1; }
.sub-item-reports {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px;
  margin-top: 8px; padding: 8px; background: #fafbfc; border-radius: 8px; border: 1px solid #f1f5f9;
}
.report-thumb-sm {
  position: relative; width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
  cursor: pointer; border: 1px solid #e2e8f0; background: white;
  transition: border-color .15s, transform .15s;
}
.report-thumb-sm:hover { border-color: var(--primary-color, #c44680); transform: scale(1.05); }
.report-img-sm { width: 100%; height: 100%; object-fit: cover; }
.report-pdf-sm { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; font-size: 20px; }
.pdf-label-sm { font-size: 8px; color: #94a3b8; display: block; max-width: 58px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.report-del-sm {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px;
  border-radius: 50%; background: rgba(255,77,79,.85); color: white;
  border: none; cursor: pointer; font-size: 9px; display: flex;
  align-items: center; justify-content: center; opacity: 0; transition: opacity .15s;
}
.report-thumb-sm:hover .report-del-sm { opacity: 1; }

/* 自定义子项编辑器 */
.custom-items-editor { width: 100%; }
.preset-items-section { margin-bottom: 10px; }
.preset-items-label { font-size: 12px; color: #64748b; margin-bottom: 6px; font-weight: 500; }
.preset-items-grid {
  display: flex; flex-wrap: wrap; gap: 5px;
  padding: 8px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;
}
.preset-item-tag {
  display: inline-block; padding: 3px 10px; border-radius: 14px; font-size: 12px;
  background: white; border: 1px solid #cbd5e1; color: #475569; cursor: pointer;
  transition: all .15s; user-select: none; line-height: 1.6;
}
.preset-item-tag:hover { border-color: var(--primary-color, #c44680); color: var(--primary-color, #c44680); }
.preset-item-tag.is-added {
  background: var(--primary-color, #c44680); color: white; border-color: transparent;
}
.custom-items-list { margin-top: 8px; }

/* 准备事项区域 */
.preparation-section {
  margin: 0 0 10px; padding: 0;
  border-radius: 8px; overflow: hidden;
  border: 1px solid #fef3c7; background: #fffbeb;
}
.preparation-toggle {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  cursor: pointer; user-select: none; transition: background .15s;
}
.preparation-toggle:hover { background: #fde68a33; }
.prep-icon { font-size: 14px; }
.prep-title { font-size: 13px; font-weight: 600; color: #92400e; flex: 1; }
.prep-count { font-size: 11px; color: #b45309; background: #fde68a; padding: 1px 7px; border-radius: 10px; }
.prep-arrow { font-size: 11px; color: #92400e; transition: transform .2s; }
.preparation-list { padding: 0 12px 10px 28px; }
.prep-item {
  display: flex; align-items: flex-start; gap: 6px; padding: 3px 0;
  font-size: 12.5px; line-height: 1.6; color: #78350f;
}
.prep-item.is-warning { color: #dc2626; font-weight: 600; }
.prep-bullet {
  flex-shrink: 0; width: 16px; height: 16px; line-height: 16px; text-align: center;
  border-radius: 50%; font-size: 11px; font-weight: 700; margin-top: 1px;
  background: #fbbf24; color: white;
}
.is-warning .prep-bullet { background: #ef4444; }
.prep-text { flex: 1; }
.custom-item-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.custom-item-del {
  width: 20px; height: 20px; border-radius: 50%; background: #fee2e2; color: #ef4444;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  font-size: 11px; flex-shrink: 0; transition: background .15s;
}
.custom-item-del:hover { background: #fecaca; }
.custom-items-hint { font-size: 11px; color: #94a3b8; margin-top: 4px; }
.no-items-hint { font-size: 12px; color: #94a3b8; padding: 12px 0; text-align: center; background: #f8fafc; border-radius: 8px; border: 1px dashed #e2e8f0; }

/* 检查项目选择子弹窗 */
.preset-picker-body { max-height: 55vh; overflow-y: auto; }
.preset-search { margin-bottom: 12px; position: sticky; top: 0; background: white; z-index: 1; padding-bottom: 4px; }
.preset-category-list { display: flex; flex-direction: column; gap: 14px; }
.preset-category-group { }
.preset-category-title {
  font-size: 13px; font-weight: 700; color: #334155;
  padding-bottom: 4px; border-bottom: 1px solid #f1f5f9; margin-bottom: 6px;
}
.preset-picker-footer {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 14px; padding-top: 10px; border-top: 1px solid #f1f5f9;
}
.preset-selected-count { font-size: 13px; color: #64748b; font-weight: 500; }
.preset-no-result {
  text-align: center; padding: 30px 0; font-size: 13px; color: #94a3b8;
}

.report-section { margin-bottom: 12px; padding: 12px 14px; background: #f8fafc; border-radius: 10px; }
.report-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.report-label { font-size: 13px; font-weight: 600; color: #64748b; }

/* 分类标签平铺 */
.category-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.cat-tab {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 12px; border: 1px solid #e2e8f0; border-radius: 16px;
  background: white; font-size: 12px; cursor: pointer;
  transition: background-color .2s, border-color .2s, color .2s; color: #64748b; font-weight: 500;
}
.cat-tab:hover { border-color: var(--primary-color); }
.cat-tab.active {
  background: var(--primary-color, #c44680); color: white; border-color: transparent;
}
.cat-count { background: rgba(0,0,0,.1); font-size: 10px; padding: 0 5px; border-radius: 8px; min-width: 16px; text-align: center; }
.cat-tab.active .cat-count { background: rgba(255,255,255,.3); }

/* 上传按钮区 */
.upload-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.upload-link { font-size: 12px; color: var(--primary-color, #c44680); font-weight: 600; cursor: pointer; white-space: nowrap; padding: 5px 12px; border: 1px dashed var(--primary-color, #c44680); border-radius: 8px; transition: background .2s; text-decoration: none; }
.upload-link:hover { background: rgba(232,160,191,.08); }
.nas-upload { color: var(--stage-mid-color, #4FC3F7) !important; border-color: #4FC3F7 !important; }
.nas-upload:hover { background: rgba(79,195,247,.06) !important; }
.current-cat-hint { font-size: 11px; color: #94a3b8; margin-left: auto; }

/* 报告缩略图 */
.report-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.report-thumb { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; cursor: pointer; border: 2px solid transparent; background: white; transition: transform .15s, border-color .15s; }
.report-thumb:hover { transform: scale(1.05); border-color: var(--primary-color, #c44680); }
.report-img { width: 100%; height: 100%; object-fit: cover; }
.report-pdf-icon { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 2px; padding: 4px; }
.pdf-icon { font-size: 28px; }
.pdf-name { font-size: 9px; color: #94a3b8; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 74px; }
.thumb-cat-tag {
  position: absolute; top: 0; left: 0; right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,.55));
  color: white; font-size: 9px; padding: 10px 4px 3px; text-align: center;
  z-index: 1; font-weight: 600;
}
.report-delete-btn { position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; border-radius: 50%; background: rgba(255,77,79,.9); color: white; border: none; cursor: pointer; font-size: 9px; display: flex; align-items: center; justify-content: center; z-index: 2; }
.report-empty { font-size: 12px; color: #94a3b8; text-align: center; padding: 12px 0; }

.card-footer { display: flex; justify-content: flex-end; }
.completed-text { font-size: 13px; color: #66BB6A; font-weight: 600; }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; }
.empty-icon { font-size: 64px; opacity: .5; margin-bottom: 16px; }
.empty-text { font-size: 16px; color: #64748b; }

/* NAS browser */
.nas-browser { display: flex; flex-direction: column; height: 100%; }
.nas-breadcrumb { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0; margin-bottom: 8px; }
.nas-current-path { font-size: 13px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nas-file-list { flex: 1; overflow-y: auto; }
.nas-entry { display: flex; align-items: center; gap: 10px; padding: 10px 8px; cursor: pointer; border-radius: 8px; }
.nas-entry:hover { background: #f1f5f9; }
.nas-entry-icon { font-size: 20px; }
.nas-entry-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nas-entry-size { font-size: 12px; color: #94a3b8; }
.nas-empty { text-align: center; padding: 40px; color: #94a3b8; }
.nas-loading { text-align: center; padding: 40px; color: #94a3b8; }

.native-date-input { width: 100%; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; }

@media (max-width: 768px) {
  .checkup-schedule-view { padding: 8px; }
  .summary-section { padding: 16px; border-radius: 12px; }
  .summary-stats { flex-direction: column; align-items: flex-start; gap: 10px; }
  .stat-progress { width: 100%; }
  .stat-value { font-size: 24px; }
  .card-header { flex-direction: column; align-items: flex-start; }
  .card-left { width: 100%; }
  .card-right { width: 100%; justify-content: space-between; }
  .report-section { padding: 10px 8px; }
  .report-header { flex-wrap: wrap; gap: 4px; }

  /* 分类标签移动端 */
  .category-tabs { gap: 4px; margin-bottom: 8px; overflow-x: auto; flex-wrap: nowrap; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
  .cat-tab { padding: 4px 10px; font-size: 11px; white-space: nowrap; flex-shrink: 0; }

  /* 上传栏 */
  .upload-bar { flex-direction: row; gap: 6px; }
  .upload-link { padding: 4px 10px; font-size: 11px; }
  .current-cat-hint { display: none; }

  /* 报告缩略图 */
  .report-thumb { width: 64px; height: 64px; }
  .pdf-name { max-width: 54px; font-size: 8px; }
  .date-input-small { width: 100px; font-size: 12px; }
  .checkup-card { padding: 12px; }
  .sub-item-name { font-size: 12px; min-width: 60px; }
  .sub-item-reports { gap: 4px; padding: 6px; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); }
}
@media (max-width: 480px) {
  .category-tabs { gap: 3px; }
  .cat-tab { padding: 3px 8px; font-size: 10px; }
  .upload-bar { justify-content: center; }
  .report-thumb { width: 56px; height: 56px; }
}
</style>
