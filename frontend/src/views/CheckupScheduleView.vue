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
          <div class="next-label">下一次产检</div>
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
            <!-- ⚠️「预计日期」只在 .card-right 保留一处（紧挨着完成日期输入框）。
                 这里原来还有一个重复的，移动端会多占一整行，已按用户要求去掉。 -->
            <n-tag v-if="item._type === 'standard' && item.is_recommended !== false" size="tiny" type="warning" :bordered="false">推荐</n-tag>
            <n-tag v-if="item._type === 'custom'" size="tiny" type="info" :bordered="false">自定义</n-tag>
          </div>
          <div class="card-right">
            <!-- 预计日期 + 倒计时（只读），紧挨着完成日期输入框 -->
            <span v-if="item.expected_date" class="expected-date-tag" :class="{ 'is-urgent': daysUntilExpected(item.expected_date) <= 7 && daysUntilExpected(item.expected_date) >= 0 }">
              预计 {{ dayjs(item.expected_date).format('MM/DD') }}
              <template v-if="daysUntilExpected(item.expected_date) === 0"> · 今天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) > 0"> · 还有{{ daysUntilExpected(item.expected_date) }}天</template>
              <template v-else-if="daysUntilExpected(item.expected_date) < 0"> · 已过{{ Math.abs(daysUntilExpected(item.expected_date)) }}天</template>
            </span>
            <!-- 完成日期（可输入） -->
            <input
              type="date"
              class="date-input-small"
              :value="scheduleDates[item.id] || completionDateOf(item)"
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
            ><AppIcon name="trash" :size="16" /></n-button>
          </div>
        </div>

        <!-- 准备事项（仅标准产检显示） -->
        <div v-if="item._type === 'standard' && item.preparation?.length" class="preparation-section">
          <div class="preparation-toggle" @click="togglePrepCollapse(item.id)">
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
                <span>上传</span>
              </label>
              <span class="sub-item-nas-btn" @click.stop="handleSubItemNasSelect(item, subItemName(item, subItem))"><AppIcon name="monitor" :size="16" /></span>
            </div>
            <div v-if="!isSubItemCollapsed(item, subItem) && getSubItemReports(item, subItemName(item, subItem)).length" class="sub-item-reports">
              <div v-for="r in getSubItemReports(item, subItemName(item, subItem))" :key="r.id" class="report-thumb-sm" @click="openReport(r)">
                <template v-if="r.file_type === 'image'">
                  <img :src="getReportUrl(r.id)" class="report-img-sm" />
                </template>
                <template v-else>
                  <div class="report-pdf-sm"><span class="pdf-label-sm">{{ r.filename }}</span></div>
                </template>
                <button class="report-del-sm" @click.stop="deleteReport(r, item)"><AppIcon name="close" :size="12" /></button>
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
                  <div class="report-pdf-sm"><span class="pdf-label-sm">{{ r.filename }}</span></div>
                </template>
                <button class="report-del-sm" @click.stop="deleteReport(r, item)"><AppIcon name="close" :size="12" /></button>
              </div>
            </div>
          </div>
          <div v-if="getItemReportCount(item) === 0" class="sub-items-empty">暂无报告，点击子项旁的📎上传</div>
        </div>

        <!-- 自定义产检 / 无子项的标准产检：保持原有上传方式 -->
        <div v-else class="report-section">
          <div class="report-header">
            <span class="report-label">报告 ({{ getItemReportCount(item) }})</span>
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
              <span>本地上传</span>
            </label>
            <span class="upload-link nas-upload" @click.stop="openNasBrowser(item)">NAS选择</span>
            <span class="current-cat-hint">当前: {{ getCurrentCatLabel(item) }}</span>
          </div>
          <div class="report-grid" v-if="filteredReports(item).length">
            <div v-for="r in filteredReports(item)" :key="r.id" class="report-thumb" @click="openReport(r)">
              <span class="thumb-cat-tag">{{ r.report_category || '其他' }}</span>
              <template v-if="r.file_type === 'image'">
                <img :src="getReportUrl(r.id)" :alt="r.filename" class="report-img" />
              </template>
              <template v-else>
                <div class="report-pdf-icon"><span class="pdf-name">{{ r.filename }}</span></div>
              </template>
              <button class="report-delete-btn" @click.stop="deleteReport(r, item)"><AppIcon name="close" :size="12" /></button>
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
            :loading="!!pendingComplete[item._key]"
            :disabled="!!pendingComplete[item._key]"
            @click="markComplete(item)"
          >
            标记完成
          </n-button>
          <template v-else>
            <span class="completed-text">已完成</span>
            <!-- 误按「标记完成」的兜底：可撤销。只回退本应用自己产生的那条完成记录，用户手填的数据不动。 -->
            <n-button
              size="tiny"
              quaternary
              :loading="!!pendingComplete[item._key]"
              :disabled="!!pendingComplete[item._key]"
              @click="cancelComplete(item)"
            >取消完成</n-button>
          </template>
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
                <span class="custom-item-del" @click="customForm.items.splice(idx, 1)"><AppIcon name="close" :size="14" /></span>
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
            <template #prefix><AppIcon name="search" :size="16" /></template>
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
          <n-button size="tiny" quaternary @click="nasGoUp" :disabled="!nasParent">上层</n-button>
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
            <span class="nas-entry-icon"><AppIcon :name="entry.type === 'dir' ? 'folder' : 'file'" :size="20" /></span>
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
import { markCheckupCompleted, unmarkCheckupCompleted, getCheckupSchedule } from '@/api/checkup-schedule'
import AppIcon from '@/components/common/AppIcon.vue'
import { checkupApi } from '@/api/checkup'
import dayjs from 'dayjs'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

// ========== 产检时间表默认数据（内嵌，不依赖后端） ==========
// 检查子项结构：{ name: 名称, required: true(必检) | false(推荐) }
interface CheckupSubItem { name: string; required: boolean }

// 产检时间表已改为唯一数据源：后端 checkup_schedule.json（经 /checkup-schedule 接口下发），页面不再内嵌。

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
  completed_at?: string | null  // 实际完成日期（后端从"标记完成"的产检记录推导，纯读取）
}

interface ReportItem {
  id: string; checkup_id: string; checkup_type: string; filename: string
  file_path: string; file_type: string; file_size: number; report_category: string
  sub_item?: string; created_at: string
}

interface NasEntry { name: string; path: string; type: 'dir' | 'file'; size: number; mtime: number }

// ========== 状态 ==========
const schedule = ref<any[]>([])  // 数据来自后端 /checkup-schedule（唯一数据源：checkup_schedule.json）
const customCheckups = ref<any[]>([])
const reportMap = ref<Record<string, ReportItem[]>>({})
const loading = ref(false)

// 数据版本号（非响应式）：任何「用户操作造成的本地乐观改动」或「新一轮 loadAll」都会把它 +1。
// loadAll 在把网络结果写回 schedule / customCheckups / scheduleDates 之前，先核对序号：
// 若期间已被更新的操作/刷新取代，就丢弃本次结果 —— 避免「过期的后台刷新把刚变绿/刚取消的状态覆盖回去」。
let dataSeq = 0
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
/** 每张卡片「标记完成 / 取消完成」的在途标志：置位时按钮转圈并禁用，避免手机端连点重复请求。 */
const pendingComplete = ref<Record<string, boolean>>({})
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

/** 实际完成日期（YYYY-MM-DD）：优先用户手填的「完成日期」，其次后端从"标记完成"记录推导的日期。
 *  纯读取，不写入任何数据 —— 老用户没手填过也能拿到真实完成时间。
 *  manualDates 仅用于测试注入，默认读组件内的 scheduleDates。 */
function completionDateOf(item: MergedItem, manualDates?: Record<string, string>): string {
  if (!item.is_completed) return ''
  const map = manualDates || scheduleDates.value
  const manual = item.id ? (map[item.id] || '') : ''
  if (manual) return manual
  return item._type === 'standard' ? (item.completed_at || '') : ''
}

/** 排序用日期：已完成的用【实际完成日期】，未完成的用【计划日期】
 *  （标准 = LMP 推算的预计日期；自定义 = 约定的检查日期）。 */
function sortDateOf(item: MergedItem, manualDates?: Record<string, string>): string {
  const done = completionDateOf(item, manualDates)
  if (done) return done
  return item._type === 'standard' ? (item.expected_date || '') : (item.checkup_date || '')
}

/** 产检列表排序比较器：以「真实日期」为准 —— 已完成按实际完成日期、未完成按计划日期。
 *  传 hasLmp 才启用日期排序：没设置孕期时标准条目推不出计划日期，此时保持原有的孕周顺序。
 *  为什么不再用 week_start（计划孕周）当主键：那是"整周取整"，会让 5月1日 的条目
 *  挤到 4月10日 与 4月28日 之间（周号相邻/相同），顺序和真实时间对不上。
 *  manualDates 仅用于测试注入。 */
function compareCheckupItems(a: MergedItem, b: MergedItem, hasLmp: boolean, manualDates?: Record<string, string>): number {
  if (hasLmp) {
    const da = sortDateOf(a, manualDates)
    const db = sortDateOf(b, manualDates)
    const hasA = da !== ''
    const hasB = db !== ''
    if (hasA !== hasB) return hasA ? -1 : 1          // 有日期的在前，推不出日期的沉底
    if (hasA && da !== db) return da < db ? -1 : 1   // YYYY-MM-DD 可直接按字典序比
  }
  // 同日期（或未设置孕期、拿不到计划日期）时的稳定次序，保持原有相对顺序
  const aWeek = a.week_start ?? 999
  const bWeek = b.week_start ?? 999
  if (aWeek !== bWeek) return aWeek - bWeek
  if (a._type !== b._type) return a._type === 'standard' ? -1 : 1
  return (a.checkup_date || '').localeCompare(b.checkup_date || '')
}

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
      completed_at: s.completed_at ?? null,
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
  all.sort((a, b) => compareCheckupItems(a, b, !!lmp))
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

/** 摘要卡片的底色跟着孕期阶段走，但只取全局的「浅色底」token（--bg-tint-*）。
 *  原来用的是 --stage-*-bg（橙 #fff5e8 / 蓝 #e8f5fc / 粉 #fde7ed），
 *  三块饱和底色随孕期整块变，是全页最扎眼、也最"换一页换一个色"的一处；
 *  而且 --stage-*-bg 没有深色适配。现在色相只作很弱的提示，
 *  主体仍是中性卡 + 品牌粉进度条。（深色模式若接上，--bg-tint-* 会自动跟随） */
const summaryStyle = computed(() => {
  const stage = pregnancyStore.gestationalAge?.trimester || 'early'
  const tintMap: Record<string, string> = {
    early: 'var(--bg-tint-cream)',
    mid: 'var(--bg-tint-blue)',
    late: 'var(--bg-tint-pink)',
  }
  return { background: tintMap[stage] || tintMap.early }
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
// 「其他报告」兜底：凡是没有 sub_item、或 sub_item 未匹配上本条目【当前任何子项名】的报告，都收进来。
// 目的：排期按国标校正时删/改过子项名（cs_005 删 GBS、cs_007/cs_008 删 NST、cs_009 GBS 改名），
// 老报告若只按旧名匹配会既不在子项行、也不在兜底行，界面上彻底失去入口。这里保证它一定可见、可点开、可删。
function getUncategorizedReports(item: MergedItem): ReportItem[] {
  const currentNames = new Set((item.items || []).map((si: any) => subItemName(item, si)))
  return getItemReports(item).filter(r => !r.sub_item || !currentNames.has(r.sub_item))
}

// ========== 操作函数 ==========
async function handleSubItemUpload(e: Event, item: MergedItem, subItem: string) {
  const target = e.target as HTMLInputElement; const file = target.files?.[0]; if (!file) return
  try {
    await checkupApi.uploadReport(item.id, file, getCheckupTypeKey(item), autoCategory(subItem), subItem)
    await loadReportsForItem(item); target.value = ''; message.success('上传成功')
  } catch (e: any) { message.error('上传失败：' + (e?.message || '未知原因')) }
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
  if (pendingComplete.value[item._key]) return   // 在途，忽略连点
  const pid = pregnancyStore.currentPregnancy.id

  // ① 先做本地「乐观更新」：卡片立刻变绿，不等网络。
  //    ⚠️ 原实现把状态更新写在 await 之后 —— 手机端一次请求 1~3 秒，点完界面毫无变化、
  //    按钮也不 loading，用户以为没点上就去点下一条；等第一条响应回来才变绿 ⇒
  //    「点下一条，上一条才显示完成」。改动日期 2026-09-26（复现脚本 repro_checkup_complete.js）。
  const prevCompleted = item.is_completed
  const prevDate = scheduleDates.value[item.id]
  const todayStr = dayjs().format('YYYY-MM-DD')
  if (item._type === 'custom') {
    const c = customCheckups.value.find(c => c.id === item.id); if (c) c.is_completed = 1
  } else {
    const s = schedule.value.find(s => s.id === item.id); if (s) s.is_completed = true
  }
  // 完成日期：只在用户【还没填过】时垫上，绝不覆盖手填值（保证原有数据不被改动）。
  // 垫上后列表立刻按真实完成时间重排。
  if (!prevDate) scheduleDates.value[item.id] = todayStr

  dataSeq++   // 本轮乐观改动作数：让任何在途的旧 loadAll 结果作废
  pendingComplete.value[item._key] = true
  try {
    if (item._type === 'custom') {
      await checkupApi.markCustomComplete(item.id)
    } else {
      await markCheckupCompleted(item.id, pid)
    }
    // 完成日期落库（既有接口、幂等）；写库失败也不影响"已完成"状态，排序会自动退回计划日期。
    if (!prevDate) {
      try { await checkupApi.setScheduleDate(pid, item.id, todayStr) } catch { /* 忽略：不影响完成状态 */ }
    }
    message.success('已标记完成')
    // 后台同步后端状态（不阻塞 UI 更新）
    loadAll().catch(() => {})
  } catch (e: any) {
    // ② 失败必须回滚本地乐观状态，界面绝不停在"假已完成"
    if (item._type === 'custom') {
      const c = customCheckups.value.find(c => c.id === item.id); if (c) c.is_completed = prevCompleted ? 1 : 0
    } else {
      const s = schedule.value.find(s => s.id === item.id); if (s) s.is_completed = !!prevCompleted
    }
    if (!prevDate) delete scheduleDates.value[item.id]
    message.error(e?.message || '操作失败，请重试')
  } finally {
    delete pendingComplete.value[item._key]
  }
}

/** 取消完成 —— 给「标记完成」误按兜底。
 *  只回退【本应用「标记完成」自己产生的那条完成记录】；用户手填的「完成日期」后端不会删，
 *  这里也就不动本地 scheduleDates（只有后端明确回报 date_cleared 时才删）。 */
async function cancelComplete(item: MergedItem) {
  if (!pregnancyStore.currentPregnancy) { message.warning('请先设置孕期信息'); return }
  if (pendingComplete.value[item._key]) return
  const pid = pregnancyStore.currentPregnancy.id

  // 本地快照，用于「后端说不是本页标记的」或请求失败时回滚
  const prevCompleted = item.is_completed
  const prevCompletedAt: any = item._type === 'standard' ? (item.completed_at ?? null) : null
  const prevDate = scheduleDates.value[item.id]

  const applyLocal = (done: boolean) => {
    if (item._type === 'custom') {
      const c = customCheckups.value.find(c => c.id === item.id); if (c) c.is_completed = done ? 1 : 0
    } else {
      const s: any = schedule.value.find(s => s.id === item.id)
      if (s) { s.is_completed = done; if (!done) s.completed_at = null }
    }
  }
  const restoreCompletedAt = () => {
    const s: any = schedule.value.find(s => s.id === item.id)
    if (s && prevCompletedAt) s.completed_at = prevCompletedAt
  }

  // 乐观更新：先本地取消，避免手机端等网络（与 markComplete 同理）
  applyLocal(false)
  dataSeq++   // 本轮乐观改动作数：让任何在途的旧 loadAll 结果作废
  pendingComplete.value[item._key] = true
  try {
    if (item._type === 'custom') {
      await checkupApi.unmarkCustomComplete(item.id)
    } else {
      const res: any = await unmarkCheckupCompleted(item.id, pid)
      // 没有找到"标记完成"写下的那条记录 ⇒ 这条完成状态来自别处（如用户自己添加的产检记录），
      // 不在本页悄悄改用户数据：回滚本地状态并如实告知。
      if (res && res.data && res.data.changed === 0) {
        applyLocal(!!prevCompleted)
        restoreCompletedAt()
        message.warning('这条完成记录不是在本页标记的，无法在这里取消')
        return
      }
      // 只有后端明确回报清掉了自动写入的日期，才删本地日期缓存；用户手填的日期保留
      const cleared = res && res.data ? res.data.date_cleared : null
      if (cleared) delete scheduleDates.value[item.id]
    }
    message.success('已取消完成')
    loadAll().catch(() => {})
  } catch (e: any) {
    applyLocal(!!prevCompleted)
    restoreCompletedAt()
    if (prevDate) scheduleDates.value[item.id] = prevDate
    else delete scheduleDates.value[item.id]
    message.error(e?.message || '操作失败，请重试')
  } finally {
    delete pendingComplete.value[item._key]
  }
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
  } catch (e: any) { message.error('上传失败：' + (e?.message || '未知原因')) }
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
  } catch (e: any) { message.error('浏览失败：' + (e?.message || '未知原因')) }
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
  } catch (e: any) { message.error('添加失败：' + (e?.message || '未知原因')) }
}

async function loadScheduleDates(seqGuard?: number) {
  if (!pregnancyStore.currentPregnancy) return
  try {
    const res: any = await checkupApi.getScheduleDates(pregnancyStore.currentPregnancy.id)
    // seqGuard 存在时：只有仍是同一轮刷新才写回，避免「过期刷新」覆盖用户最新操作。
    if ((seqGuard === undefined || seqGuard === dataSeq) && res.code === 0 && res.data) scheduleDates.value = res.data
  } catch { /* ignore */ }
}

// ========== 核心加载逻辑：默认数据始终可用，后端只补充完成状态 ==========
async function loadAll() {
  // 记下本轮序号：网络往返期间若用户又做了「标记完成/取消完成」等操作（或触发了更新的刷新），
  // 序号会变，本次结果即视为过期而丢弃 —— 这是「点了没反应 / 状态被刷回去」类问题的根因护栏。
  const mySeq = ++dataSeq
  loading.value = true
  // 默认数据已经内嵌在 schedule 中了，列表一定有内容
  try {
    const pid = pregnancyStore.currentPregnancy?.id

    // 产检时间表：唯一数据源 = 后端 checkup_schedule.json（经 /checkup-schedule 接口下发，含完成状态）。
    // ⚠️ 必须放在 if (pid) 之外：未设置孕期的用户也要能看到完整排期。
    // 后端已允许省略 pregnancy_id（只回排期本体、不带完成状态）。
    try {
      const res: any = await getCheckupSchedule(pid)
      if (res.code === 0 && Array.isArray(res.data)) {
        if (mySeq === dataSeq) schedule.value = res.data
        else console.log('[loadAll] 结果已过期（期间有更新的操作），跳过写回 schedule')
      } else {
        console.warn('[loadAll] getCheckupSchedule unexpected format: code=', res?.code)
      }
    } catch (e) {
      console.warn('获取产检时间表失败:', e)
    }

    if (pid) {
      // 获取自定义产检
      try {
        const res: any = await checkupApi.listCustom(pid)
        console.log('[loadAll] listCustom raw response:', JSON.stringify(res)?.slice(0, 300))
        if (res.code === 0 && Array.isArray(res.data)) {
          if (mySeq === dataSeq) customCheckups.value = res.data
          console.log('[loadAll] customCheckups assigned:', res.data.length, 'items:', res.data.map((c: any) => ({ id: c.id, name: c.name, date: c.checkup_date })))
        } else {
          console.warn('[loadAll] listCustom unexpected format: code=', res?.code, 'dataType=', Array.isArray(res?.data) ? 'array' : typeof res?.data)
        }
      } catch (e) { console.warn('获取自定义产检失败:', e) }

      await loadScheduleDates(mySeq)
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
    if (mySeq === dataSeq) reportMap.value = newReportMap

    // 默认收起所有检查内容（只在用户没手动展开过时生效 —— 否则每次刷新/标记完成
    // 都会把用户已展开的「检查内容」重新折叠，界面无故跳动）。
    mergedList.value.forEach(item => {
      if (item.items?.length && subItemsCollapsed.value[item._key] === undefined) {
        subItemsCollapsed.value[item._key] = true
      }
    })
  } finally { loading.value = false }
}

onMounted(() => {
  loadAll()
  // 直接进入/刷新本页时，pregnancyStore 可能还是空的（它只在首页等页面被加载过）。
  // 本页的「预计日期」要用 LMP 推算，「完成日期 / 自定义产检」要用 pregnancy_id 拉取，
  // 所以这里自己补拉一次；拿到后下面的 watch 会自动再 loadAll 一遍。
  if (!pregnancyStore.currentPregnancy) {
    pregnancyStore.fetchActivePregnancy().catch(() => { /* 没有档案就保持空，不影响排期展示 */ })
  }
})
watch(() => pregnancyStore.currentPregnancy?.id, (pid) => { if (pid) loadAll() })
</script>

<style scoped>
/* ============================================================================
   产检排期页 · 配色令牌（本页唯一色彩来源）
   ----------------------------------------------------------------------------
   这一页历史上硬写了 60 余种颜色，混了 4 套互不相干的色板（Tailwind slate、
   Material 彩虹、另一套 Material 分类色、Tailwind amber/red），但只用了 21 处
   全局变量 —— 所以看着"杂"，也和 App 其它页面不是一套。

   现在收敛成 5 个角色（与 App.vue 里的 Naive 主题色一一对应，组件与自写样式
   因此自动同色）：

     粉 --ck-accent   可操作 / 选中 / 必检竖条   （= primaryColor #c44680）
     蓝 --ck-info     孕周 / 信息 / 自定义标识   （= infoColor    #4fb6e8）
     绿 --ck-done     已完成                     （= successColor #4ea750）
     琥 --ck-attn     待办 / 提醒 / 本次推荐      （= warningColor #f0a020）
     红 --ck-danger   必检标记 / 逾期 / 删除      （= errorColor   #e64646）

   其余一律走灰阶（--ck-ink-* / --ck-line-* / --ck-surface*）。

   ⚠️ 令牌挂在 :global(:root) 而不是组件根类上：Naive 的 n-modal 会把弹窗内容
      teleport 到 body 之外，挂在组件根上的自定义属性继承不进去（弹窗里有
      「选择检查项目」「从NAS选择」两个界面）。--ck- 前缀保证不与全局 token 冲突。
   ⚠️ 深浅底一律取全局的 --bg-tint-* 与 --text-* / --border-*：将来若真的接上
      深色模式（目前 html.dark 只是预留，currentTheme 还没接到 DOM 上），
      这些变量会被自动覆盖，本页不需要再维护第二套深色值。
   ============================================================================ */
:global(:root) {
  /* 表面与线条 */
  --ck-surface: var(--bg-card, #ffffff);
  --ck-surface-2: var(--bg-color-2, #f6f1ee);
  --ck-line: var(--border-color, #efe7ef);
  --ck-line-soft: var(--divider-color, #f1ebf2);
  --ck-line-strong: var(--border-color-strong, #e1d5e3);
  /* 文字三级 */
  --ck-ink: var(--text-color, #1f1730);
  --ck-ink-2: var(--text-secondary, #5c5275);
  --ck-ink-3: var(--text-hint, #6b6480);
  /* 粉：可操作 / 选中 / 必检 */
  --ck-accent: var(--primary-color, #c44680);
  --ck-accent-soft: var(--primary-soft, #e8a0bf);
  --ck-accent-bg: var(--bg-tint-pink, #fff5fa);
  /* 蓝：孕周 / 信息。
     ⚠️ ink 比 fill(--ck-info #4fb6e8) 明显更深：fill 是给图形（描边、圆点）用的，
     用来写字对比度只有 2 出头（原生 #4FC3F7 on #E1F5FE 实测 1.78，严重不达标）。
     #17709b on --ck-info-bg 实测 5.15:1，11px 小字也够。 */
  --ck-info: var(--info-color, #4fb6e8);
  --ck-info-bg: var(--bg-tint-blue, #f4f8ff);
  --ck-info-ink: #17709b;
  /* 绿：已完成 */
  --ck-done: var(--success-color, #4ea750);
  --ck-done-bg: var(--bg-tint-mint, #f1faf4);
  --ck-done-ink: #3f7f42;
  /* 琥珀：待办 / 提醒 / 本次推荐 */
  --ck-attn: var(--warning-color, #f0a020);
  --ck-attn-bg: var(--bg-tint-cream, #fff9ec);
  --ck-attn-line: #f0dfb8;
  /* ink 在 --ck-attn-line 上原本 4.49（差一点点不达标），压深到 #7d4f0d 后 5.32 */
  --ck-attn-ink: #7d4f0d;
  /* 红：危险 / 逾期 / 删除 */
  --ck-danger: var(--error-color, #e64646);
  --ck-danger-bg: #fdf2f2;
  --ck-danger-line: #f3d6d6;
  --ck-danger-ink: #b32d2d;
}

.checkup-schedule-view { max-width: 800px; margin: 0 auto; padding: 16px; }

/* ---------- 顶部摘要（底色由 summaryStyle 按孕期阶段给浅色底） ---------- */
.summary-section {
  border-radius: 16px; padding: 24px; margin-bottom: 16px;
  border: 1px solid var(--ck-line-soft);
  box-shadow: var(--shadow-sm);
}
.summary-stats { display: flex; align-items: center; gap: 24px; margin-bottom: 12px; }
.stat-item { display: flex; flex-direction: column; }
.stat-value { font-size: 28px; font-weight: 800; color: var(--ck-ink); }
.stat-label { font-size: 13px; color: var(--ck-ink-3); }
.stat-progress { flex: 1; display: flex; align-items: center; gap: 12px; }
.progress-bar-wrapper { flex: 1; height: 10px; background: var(--ck-line); border-radius: 5px; overflow: hidden; }
/* 进度条用品牌粉的同族渐变（原来是"绿→蓝"两色渐变，跟页面里任何东西都不同族） */
.progress-bar-fill { height: 100%; background: linear-gradient(90deg, var(--ck-accent-soft), var(--ck-accent)); border-radius: 5px; transition: width .5s; }
/* 百分比用主文字色而不是品牌粉：粉字在浅底上只有 4.41（< 4.5），而进度条本身就是粉的，
   不差这一处品牌色，数字清楚更重要。 */
.progress-text { font-size: 14px; font-weight: 700; min-width: 40px; color: var(--ck-ink); }
.next-checkup { padding-top: 12px; border-top: 1px solid var(--ck-line); }
.next-label { font-size: 13px; color: var(--ck-ink-3); margin-bottom: 4px; }
.next-name { font-size: 16px; font-weight: 600; color: var(--ck-ink); }

/* ---------- 本次推荐 ---------- */
/* 原来是写死的"孕早期"橙（孕中晚期也是橙的），现在统一成琥珀=提醒，语义一致 */
.current-recommend {
  background: var(--ck-attn-bg);
  border: 1px solid var(--ck-attn-line);
  border-left: 3px solid var(--ck-attn);
  border-radius: 12px; padding: 12px 16px; margin-bottom: 16px;
  cursor: pointer; font-size: 14px; font-weight: 600; color: var(--ck-attn-ink);
}

.action-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.action-bar-title { font-size: 16px; font-weight: 700; color: var(--ck-ink); }

.checkup-list { display: flex; flex-direction: column; gap: 12px; }

/* ---------- 卡片 ---------- */
/* 左竖条只表达状态，颜色全部来自令牌：中性=普通 粉=必检 蓝虚线=自定义 绿=已完成。
   加了一圈 1px 描边：原来只靠 box-shadow 分层，深底上阴影几乎看不见。 */
.checkup-card {
  background: var(--ck-surface);
  border-radius: 12px; padding: 16px;
  border: 1px solid var(--ck-line-soft);
  border-left: 4px solid var(--ck-line-strong);
  box-shadow: var(--shadow-xs);
}
.checkup-card.is-mandatory { border-left-color: var(--ck-accent); }
.checkup-card.is-custom { border-left-color: var(--ck-info); border-left-style: dashed; }
.checkup-card.is-completed { background: var(--ck-done-bg); border-left-color: var(--ck-done); }
.checkup-card.is-current { box-shadow: 0 0 0 2px var(--ck-attn), var(--shadow-md); }

.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.card-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.card-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.week-badge { background: var(--ck-info-bg); color: var(--ck-info-ink); padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; }
/* 完成卡整体已是浅绿底，徽章改用卡片同色才看得见（原来徽章和卡片同色，等于隐形） */
.is-completed .week-badge { background: var(--ck-surface); color: var(--ck-done-ink); }
.checkup-name { font-size: 15px; font-weight: 700; color: var(--ck-ink); }

/* 预计日期标签 —— 与「孕周」徽章同属"时间/信息"，统一用蓝（原来两个蓝不一样） */
.expected-date-tag {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 7px; border-radius: 10px; font-size: 11px;
  background: var(--ck-info-bg); color: var(--ck-info-ink); margin-left: 4px;
  transition: background .25s, color .25s, font-weight .25s;
}
.expected-date-tag.is-urgent { background: var(--ck-attn-bg); color: var(--ck-attn-ink); font-weight: 600; }
.completed-mark { font-size: 18px; }

.date-input-small {
  padding: 4px 8px;
  border: 1px solid var(--ck-line);
  border-radius: 8px;
  font-size: 13px;
  background: var(--ck-surface);
  color: var(--ck-ink);
  width: 148px;
  /* 原生 type=date 控件要放下「日历图标 + yyyy/mm/dd」，太窄会被截掉最后一位。
     给一个下限，宁可让它换行到下一行也不要把控件压扁。 */
  min-width: 138px;
  box-sizing: border-box;
}
.custom-date-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--ck-line);
  border-radius: 10px;
  font-size: 14px;
  background: var(--ck-surface);
  color: var(--ck-ink);
  outline: none;
  transition: border-color .2s;
}
.custom-date-input:focus { border-color: var(--ck-accent); }

/* 说明：以下 5 条（.card-body / .checkup-items / .checkup-item-tag / .is-completed .checkup-item-tag /
   .checkup-desc）在模板里已无对应元素（「检查项平铺成标签」被下面的子项列表取代了），
   本次审查发现后删除，不再为死规则维护颜色。 */

/* ---------- 子项分类上传 ---------- */
.sub-items-section { margin-bottom: 12px; }
/* 子项折叠头 */
.sub-items-toggle {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; cursor: pointer; user-select: none;
  background: var(--ck-surface-2); border: 1px solid var(--ck-line); border-radius: 8px;
  transition: background .15s;
}
.sub-items-toggle:hover { background: var(--ck-line-soft); }
.sub-items-title { font-size: 13px; font-weight: 600; color: var(--ck-ink-2); flex: 1; }
.sub-items-count { font-size: 11px; color: var(--ck-ink-3); background: var(--ck-line); padding: 1px 7px; border-radius: 10px; }
.sub-items-badge-required {
  font-size: 11px; color: var(--ck-danger-ink); font-weight: 600;
  background: var(--ck-danger-bg); padding: 1px 7px; border-radius: 10px;
}
.sub-items-arrow { font-size: 11px; color: var(--ck-ink-3); white-space: nowrap; }
/* 子项内容区 */
.sub-items-body { padding-top: 4px; }
.sub-items-empty { font-size: 12px; color: var(--ck-ink-3); text-align: center; padding: 12px 0; }
.sub-item-row { padding: 6px 0; border-bottom: 1px solid var(--ck-line-soft); transition: background .15s; }
.sub-item-row:last-child { border-bottom: none; }
.sub-item-row.collapsed { opacity: .75; }
.sub-item-header {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  padding: 4px 0; border-radius: 6px; transition: background .15s;
}
.sub-item-header:hover { background: rgba(0,0,0,.02); }
.sub-item-name { font-size: 13px; font-weight: 500; color: var(--ck-ink); flex: 1; min-width: 80px; }
/* 子项必检/推荐标签 */
.sub-item-required-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 700;
  background: var(--ck-danger-bg); color: var(--ck-danger-ink); flex-shrink: 0;
}
.sub-item-recommended-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600;
  background: var(--ck-attn-bg); color: var(--ck-attn-ink); flex-shrink: 0;
}
/* 分类标签：原来 6 个分类各用一种 Material 彩虹色（b超蓝 / 血检粉 / 尿检橙 /
   血压紫 / 血糖绿 / 胎心黄），是全页最"花"的地方。分类名字本来就在标签文字里，
   不靠颜色区分，统一收成中性小标签。 */
.sub-item-cat-tag {
  font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 600;
  background: var(--ck-surface-2); color: var(--ck-ink-3); flex-shrink: 0;
}
.sub-item-count { font-size: 11px; color: var(--ck-accent); font-weight: 600; flex-shrink: 0; }
.sub-item-fold { font-size: 10px; color: var(--ck-ink-3); flex-shrink: 0; transition: transform .2s; }
.sub-item-upload-btn {
  font-size: 11px; color: var(--ck-accent); cursor: pointer;
  padding: 2px 8px; border: 1px dashed var(--ck-accent); border-radius: 6px;
  transition: background .2s; white-space: nowrap; flex-shrink: 0;
}
.sub-item-upload-btn:hover { background: var(--ck-accent-bg); }
.sub-item-nas-btn {
  font-size: 12px; cursor: pointer; padding: 2px 4px; opacity: .6;
  transition: opacity .2s; flex-shrink: 0;
}
.sub-item-nas-btn:hover { opacity: 1; }
.sub-item-reports {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 6px;
  margin-top: 8px; padding: 8px; background: var(--ck-surface-2); border-radius: 8px; border: 1px solid var(--ck-line-soft);
}
.report-thumb-sm {
  position: relative; width: 100%; aspect-ratio: 1; border-radius: 8px; overflow: hidden;
  cursor: pointer; border: 1px solid var(--ck-line); background: var(--ck-surface);
  transition: border-color .15s, transform .15s;
}
.report-thumb-sm:hover { border-color: var(--ck-accent); transform: scale(1.05); }
.report-img-sm { width: 100%; height: 100%; object-fit: cover; }
.report-pdf-sm { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; font-size: 20px; }
.pdf-label-sm { font-size: 8px; color: var(--ck-ink-3); display: block; max-width: 58px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
.report-del-sm {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px;
  border-radius: 50%; background: var(--ck-danger); color: #fff;
  border: none; cursor: pointer; font-size: 9px; display: flex;
  align-items: center; justify-content: center; opacity: 0; transition: opacity .15s;
}
.report-thumb-sm:hover .report-del-sm { opacity: 1; }

/* 自定义子项编辑器 */
.custom-items-editor { width: 100%; }
.preset-items-grid {
  display: flex; flex-wrap: wrap; gap: 5px;
  padding: 8px; background: var(--ck-surface-2); border-radius: 8px; border: 1px solid var(--ck-line);
}
.preset-item-tag {
  display: inline-block; padding: 3px 10px; border-radius: 14px; font-size: 12px;
  background: var(--ck-surface); border: 1px solid var(--ck-line-strong); color: var(--ck-ink-2); cursor: pointer;
  transition: all .15s; user-select: none; line-height: 1.6;
}
.preset-item-tag:hover { border-color: var(--ck-accent); color: var(--ck-accent); }
.preset-item-tag.is-added {
  background: var(--ck-accent); color: #fff; border-color: transparent;
}
.custom-items-list { margin-top: 8px; }

/* ---------- 检查准备 ---------- */
/* 原来这一个小黄块里塞了 8 种颜色（#fef3c7/#fffbeb/#fde68a/#92400e/#b45309/#78350f/
   #fbbf24/#ef4444），现在收敛成"琥珀=待办 + 红=警告"两组。 */
.preparation-section {
  margin: 0 0 10px; padding: 0;
  border-radius: 8px; overflow: hidden;
  border: 1px solid var(--ck-attn-line); background: var(--ck-attn-bg);
}
.preparation-toggle {
  display: flex; align-items: center; gap: 6px; padding: 8px 12px;
  cursor: pointer; user-select: none; transition: background .15s;
}
.preparation-toggle:hover { background: rgba(0,0,0,.04); }
.prep-title { font-size: 13px; font-weight: 600; color: var(--ck-attn-ink); flex: 1; }
.prep-count { font-size: 11px; color: var(--ck-attn-ink); background: var(--ck-attn-line); padding: 1px 7px; border-radius: 10px; }
.prep-arrow { font-size: 11px; color: var(--ck-attn-ink); transition: transform .2s; }
.preparation-list { padding: 0 12px 10px 28px; }
.prep-item {
  display: flex; align-items: flex-start; gap: 6px; padding: 3px 0;
  font-size: 12.5px; line-height: 1.6; color: var(--ck-ink-2);
}
.prep-item.is-warning { color: var(--ck-danger-ink); font-weight: 600; }
/* 圆点里的字形用深色：白字在琥珀上只有 2.15（改前 #fbbf24 更低，1.67），
   深色 --ck-ink 是 7.97。警告那条保留白字（白 on 红 3.94，作为图形符号达标）。 */
.prep-bullet {
  flex-shrink: 0; width: 16px; height: 16px; line-height: 16px; text-align: center;
  border-radius: 50%; font-size: 11px; font-weight: 700; margin-top: 1px;
  background: var(--ck-attn); color: var(--ck-ink);
}
.is-warning .prep-bullet { background: var(--ck-danger); color: #fff; }
.prep-text { flex: 1; }
.custom-item-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.custom-item-del {
  width: 20px; height: 20px; border-radius: 50%; background: var(--ck-danger-bg); color: var(--ck-danger);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
  font-size: 11px; flex-shrink: 0; transition: background .15s;
}
.custom-item-del:hover { background: var(--ck-danger-line); }
.custom-items-hint { font-size: 11px; color: var(--ck-ink-3); margin-top: 4px; }
.no-items-hint { font-size: 12px; color: var(--ck-ink-3); padding: 12px 0; text-align: center; background: var(--ck-surface-2); border-radius: 8px; border: 1px dashed var(--ck-line); }

/* 检查项目选择子弹窗 */
.preset-picker-body { max-height: 55vh; overflow-y: auto; }
.preset-search { margin-bottom: 12px; position: sticky; top: 0; background: var(--ck-surface); z-index: 1; padding-bottom: 4px; }
.preset-category-list { display: flex; flex-direction: column; gap: 14px; }
.preset-category-group { }
.preset-category-title {
  font-size: 13px; font-weight: 700; color: var(--ck-ink);
  padding-bottom: 4px; border-bottom: 1px solid var(--ck-line-soft); margin-bottom: 6px;
}
.preset-picker-footer {
  display: flex; justify-content: space-between; align-items: center;
  margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--ck-line-soft);
}
.preset-selected-count { font-size: 13px; color: var(--ck-ink-3); font-weight: 500; }
.preset-no-result {
  text-align: center; padding: 30px 0; font-size: 13px; color: var(--ck-ink-3);
}

.report-section { margin-bottom: 12px; padding: 12px 14px; background: var(--ck-surface-2); border-radius: 10px; }
.report-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.report-label { font-size: 13px; font-weight: 600; color: var(--ck-ink-3); }

/* 分类标签平铺 */
.category-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.cat-tab {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 12px; border: 1px solid var(--ck-line); border-radius: 16px;
  background: var(--ck-surface); font-size: 12px; cursor: pointer;
  transition: background-color .2s, border-color .2s, color .2s; color: var(--ck-ink-3); font-weight: 500;
}
.cat-tab:hover { border-color: var(--ck-accent); color: var(--ck-accent); }
.cat-tab.active {
  background: var(--ck-accent); color: #fff; border-color: transparent;
}
.cat-count { background: rgba(0,0,0,.1); font-size: 10px; padding: 0 5px; border-radius: 8px; min-width: 16px; text-align: center; }
.cat-tab.active .cat-count { background: rgba(255,255,255,.3); }

/* 上传按钮区 */
.upload-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
.upload-link { font-size: 12px; color: var(--ck-accent); font-weight: 600; cursor: pointer; white-space: nowrap; padding: 5px 12px; border: 1px dashed var(--ck-accent); border-radius: 8px; transition: background .2s; text-decoration: none; }
.upload-link:hover { background: var(--ck-accent-bg); }
/* NAS 选择用蓝（信息色），跟"本地/主色"的粉区分开 */
.nas-upload { color: var(--ck-info) !important; border-color: var(--ck-info) !important; }
.nas-upload:hover { background: var(--ck-info-bg) !important; }
.current-cat-hint { font-size: 11px; color: var(--ck-ink-3); margin-left: auto; }

/* 报告缩略图 */
.report-grid { display: flex; flex-wrap: wrap; gap: 8px; }
.report-thumb { position: relative; width: 84px; height: 84px; border-radius: 8px; overflow: hidden; cursor: pointer; border: 2px solid transparent; background: var(--ck-surface); transition: transform .15s, border-color .15s; }
.report-thumb:hover { transform: scale(1.05); border-color: var(--ck-accent); }
.report-img { width: 100%; height: 100%; object-fit: cover; }
.report-pdf-icon { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 2px; padding: 4px; }
.pdf-name { font-size: 9px; color: var(--ck-ink-3); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 74px; }
.thumb-cat-tag {
  position: absolute; top: 0; left: 0; right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,.55));
  color: #fff; font-size: 9px; padding: 10px 4px 3px; text-align: center;
  z-index: 1; font-weight: 600;
}
.report-delete-btn { position: absolute; top: -2px; right: -2px; width: 18px; height: 18px; border-radius: 50%; background: var(--ck-danger); color: #fff; border: none; cursor: pointer; font-size: 9px; display: flex; align-items: center; justify-content: center; z-index: 2; }
.report-empty { font-size: 12px; color: var(--ck-ink-3); text-align: center; padding: 12px 0; }

.card-footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
.completed-text { font-size: 13px; color: var(--ck-done-ink); font-weight: 600; }
/* 「取消完成」做成次要按钮：能点到，但不抢「标记完成」的视觉重量 */
.card-footer .n-button { flex-shrink: 0; }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; }
.empty-icon { font-size: 64px; opacity: .5; margin-bottom: 16px; }
.empty-text { font-size: 16px; color: var(--ck-ink-3); }

/* NAS browser */
.nas-browser { display: flex; flex-direction: column; height: 100%; }
.nas-breadcrumb { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--ck-line); margin-bottom: 8px; }
.nas-current-path { font-size: 13px; color: var(--ck-ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nas-file-list { flex: 1; overflow-y: auto; }
.nas-entry { display: flex; align-items: center; gap: 10px; padding: 10px 8px; cursor: pointer; border-radius: 8px; }
.nas-entry:hover { background: var(--ck-surface-2); }
.nas-entry-icon { font-size: 20px; }
.nas-entry-name { flex: 1; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ck-ink); }
.nas-entry-size { font-size: 12px; color: var(--ck-ink-3); }
.nas-empty { text-align: center; padding: 40px; color: var(--ck-ink-3); }
.nas-loading { text-align: center; padding: 40px; color: var(--ck-ink-3); }

/* ⚠️ 这里原本有一条 `.native-date-input`：本文件模板用的是 `.date-input-small`，
   SetupWizardView 里虽然也有同名类，但那是它自己的 scoped 规则、管不到这里 ——
   即本文件这条是死规则。本次审查发现后删除。 */

@media (max-width: 768px) {
  .checkup-schedule-view { padding: 8px; }
  .summary-section { padding: 16px; border-radius: 12px; }
  .summary-stats { flex-direction: column; align-items: flex-start; gap: 10px; }
  .stat-progress { width: 100%; }
  .stat-value { font-size: 24px; }
  .card-header { flex-direction: column; align-items: flex-start; }
  .card-left { width: 100%; }
  .card-right { width: 100%; justify-content: space-between; row-gap: 8px; }
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
  /* 完成日期：手机上独占一整行、占满宽度。
     原生 type=date 控件要放下日历图标 + "yyyy/mm/dd"，原来写死 100px 会被截成
     "yyyy/mm"（显示不全）；给满宽度既能完整显示，点按区域也更大更好用。
     字号不在这里设：global.css 已用 input{font-size:16px!important} 防 iOS 聚焦缩放。 */
  .date-input-small {
    order: 9;
    flex: 1 1 100%;
    width: 100%;
    max-width: 280px;   /* 平板宽度下别拉成一整行；手机最窄 320px 时仍能拿到 228px */
    min-width: 0;
    padding: 6px 10px;
  }
  /* 输入框换到第二行后，把「必检/选检 + ✅」推到右侧，视觉上仍然成组 */
  .card-right .n-tag { margin-left: auto; }
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
