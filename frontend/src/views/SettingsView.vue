<template>
  <div class="settings-view">
    <h2>⚙️ 设置</h2>
    <div class="settings-sections">
      <!-- 孕期管理 -->
      <div class="section">
        <h3>🤰 孕期管理</h3>

        <div v-if="pregnancyStore.currentPregnancy" class="pregnancy-status">
          <div class="status-row">
            <div class="status-item">
              <span class="status-label">当前预产期</span>
              <span class="due-date-value">{{ pregnancyStore.currentPregnancy.due_date || '未设置' }}</span>
            </div>
            <div class="status-item" v-if="pregnancyStore.gestationalAge">
              <span class="status-label">当前孕周</span>
              <span class="gestational-info">
                {{ pregnancyStore.gestationalAge.weeks }}周{{ pregnancyStore.gestationalAge.days }}天
                <n-tag size="small" :type="trimesterTagType" style="margin-left: 8px;">
                  {{ pregnancyStore.gestationalAge.trimester }}
                </n-tag>
              </span>
            </div>
          </div>
        </div>

        <div class="pregnancy-form">
          <div class="form-group">
            <label class="form-label">设置方式</label>
            <n-radio-group v-model:value="dueDateMode" size="medium">
              <n-radio-button value="lmp">末次月经推算</n-radio-button>
              <n-radio-button value="direct">直接输入预产期</n-radio-button>
            </n-radio-group>
          </div>

          <div class="form-group">
            <label class="form-label">{{ dueDateMode === 'lmp' ? '末次月经日期' : '预产期' }}</label>
            <input
              type="date"
              v-model="primaryDate"
              class="date-input"
              :placeholder="dueDateMode === 'lmp' ? '请选择末次月经日期' : '请选择预产期'"
            />
          </div>

          <div class="form-group" v-if="dueDateMode === 'lmp' && calculatedDueDate">
            <label class="form-label">推算预产期</label>
            <span class="due-date-value calculated">{{ calculatedDueDate }}</span>
          </div>

          <div class="form-group">
            <label class="form-label">宝宝昵称</label>
            <n-input v-model:value="babyName" placeholder="可选，给宝贝起个小名" style="width: 100%" size="large" />
          </div>

          <div class="form-actions">
            <n-button type="primary" size="large" @click="savePregnancy" :loading="savingPregnancy">
              {{ pregnancyStore.currentPregnancy ? '更新孕期信息' : '创建孕期档案' }}
            </n-button>
          </div>
        </div>
      </div>

      <!-- 多孕期切换 -->
      <div v-if="allPregnancies.length > 1" class="section">
        <h3>🔄 孕期切换</h3>
        <div
          v-for="p in allPregnancies"
          :key="p.id"
          class="pregnancy-item"
          :class="{ active: p.id === activePregnancyId }"
          @click="switchPregnancy(p.id)"
        >
          <span class="pregnancy-name">{{ p.baby_name || '宝宝' }}</span>
          <span class="pregnancy-due">预产期：{{ p.due_date || '未设置' }}</span>
          <n-tag v-if="p.is_active" size="small" type="success">当前</n-tag>
        </div>
      </div>

      <!-- 数据备份 -->
      <div class="section">
        <h3>💾 数据备份与恢复</h3>

        <div class="backup-simple">
          <div class="backup-card">
            <div class="backup-card-icon">💾</div>
            <div class="backup-card-body">
              <div class="backup-card-title">创建备份</div>
              <div class="backup-card-desc">自动备份全部数据（记录、日记、相册等），覆盖上一次备份</div>
              <div v-if="defaultBackupDir" class="backup-path-hint">
                📍 保存位置：<code>{{ defaultBackupDir }}</code>
              </div>
            </div>
            <n-button type="primary" @click="handleBackup" :loading="backingUp" :disabled="backingUp">
              立即备份
            </n-button>
          </div>

          <div v-if="backupResult" class="backup-result" :class="{ success: backupResult.success, error: !backupResult.success }">
            {{ backupResult.message }}
          </div>

          <div class="backup-card">
            <div class="backup-card-icon">📥</div>
            <div class="backup-card-body">
              <div class="backup-card-title">一键恢复</div>
              <div class="backup-card-desc">从最新备份数据自动恢复（会覆盖当前数据）</div>
            </div>
            <n-button type="warning" @click="handleRestoreLatest" :loading="importing" :disabled="importing">
              恢复数据
            </n-button>
          </div>

          <!-- 导出备份到指定位置：原有的「立即备份」完全不受影响，这是额外多存一份的能力 -->
          <div class="backup-card export-card">
            <div class="backup-card-icon">📤</div>
            <div class="backup-card-body">
              <div class="backup-card-title">导出备份到指定位置</div>
              <div class="backup-card-desc">
                把完整备份（数据库 + 照片 + 检查报告）另存到你指定的目录，方便同步到别的硬盘或网盘。
              </div>

              <div class="export-target">
                <span class="export-target-label">导出到：</span>
                <span class="export-target-path" :class="{ empty: !exportDir }">
                  {{ exportDir || '尚未选择' }}
                </span>
                <button class="db-nav-btn" @click="toggleExportBrowser">
                  {{ showExportBrowser ? '收起' : '选择目录' }}
                </button>
                <button v-if="exportDir" class="db-nav-btn" @click="exportDir = ''">清除</button>
              </div>

              <div class="export-manual">
                <span class="export-target-label">或直接填路径：</span>
                <input
                  v-model="manualDir"
                  class="export-input"
                  placeholder="/vol1/1000/备份"
                  @keyup.enter="applyManualDir"
                />
                <button class="db-nav-btn" :disabled="!manualDir.trim() || checkingDir" @click="applyManualDir">
                  {{ checkingDir ? '检查中…' : '检查并使用' }}
                </button>
              </div>

              <div v-if="storageLoaded && !authorizedDirs.length" class="export-guide">
                还没有读到授权目录。请到 <b>飞牛应用中心 → 孕程记 → 设置 → 授权目录</b>
                添加一个文件夹（例如 <code>/vol1/1000/备份</code>），
                然后到应用中心把孕程记 <b>「停用」再「启用」</b>一次 ——
                授权路径只在应用启动时下发，不重启读不到（刷新页面没用）。
              </div>

              <!-- 排查区：授权了目录却读不到时，这里的原始值能直接说明是哪一环断了 -->
              <details v-if="diag" class="export-diag">
                <summary>看不到我刚授权的目录？点这里排查</summary>
                <div class="diag-body">
                  <div class="diag-row">
                    <span class="diag-k">版本 / 启动于</span>
                    <span class="diag-v">
                      v{{ diag.trim_env?.TRIM_APPVER || '?' }} ·
                      {{ diag.started_at }}（{{ diag.uptime_sec }} 秒前）
                    </span>
                  </div>
                  <div class="diag-row">
                    <span class="diag-k">授权目录原始值</span>
                    <span class="diag-v" :class="{ bad: !diag.accessible_raw }">
                      {{ diag.accessible_raw || '（空 —— 系统没把这个变量给应用进程）' }}
                    </span>
                  </div>
                  <div class="diag-row">
                    <span class="diag-k">解析后的授权目录</span>
                    <span class="diag-v">{{ (diag.accessible_parsed || []).join('  |  ') || '（无）' }}</span>
                  </div>
                  <div class="diag-row">
                    <span class="diag-k">共享目录原始值</span>
                    <span class="diag-v">{{ diag.share_raw || '（空）' }}</span>
                  </div>
                  <div class="diag-row">
                    <span class="diag-k">系统版本 / 架构</span>
                    <span class="diag-v">
                      {{ diag.trim_env?.TRIM_SYS_VERSION || '未知' }} / {{ diag.trim_env?.TRIM_SYS_ARCH || '未知' }}
                    </span>
                  </div>
                  <div class="diag-row">
                    <span class="diag-k">应用运行用户</span>
                    <span class="diag-v">{{ diag.trim_env?.TRIM_USERNAME || '未知' }}（uid={{ diag.uid }} / gid={{ diag.gid }}）</span>
                  </div>
                  <div class="diag-row">
                    <span class="diag-k">收到的 TRIM_ 变量</span>
                    <span class="diag-v wrap">{{ (diag.trim_env_keys || []).join(', ') || '（一个都没有）' }}</span>
                  </div>
                  <div class="diag-tip">
                    授权路径是<b>应用启动时</b>由系统注入的。如果「原始值」是空的、但你在应用中心确实加了目录，
                    请到应用中心把应用<b>「停用」再「启用」</b>一次（只刷新页面没用），再回来看。
                    实在拿不到也别急 —— 用上面的「或直接填路径」当场就能用。
                  </div>
                </div>
              </details>

              <div v-if="showExportBrowser" class="dir-browser-inline">
                <div v-if="quickDirs.length" class="db-quick-select">
                  <div class="db-quick-label">推荐位置</div>
                  <div class="db-quick-list">
                    <button
                      v-for="d in quickDirs"
                      :key="d.path"
                      class="db-quick-btn"
                      :class="[d.type, { active: exportDir === d.path, ro: !d.canRW }]"
                      :disabled="!d.canRW"
                      @click="pickQuickDir(d)"
                    >
                      <span class="db-quick-icon">{{ d.type === 'accessible' ? '📂' : '🗂️' }}</span>
                      <span class="db-quick-text">
                        <span class="db-quick-name">{{ d.name }}</span>
                        <span class="db-quick-desc">{{ d.path }}{{ d.canRW ? '' : '（只读）' }}</span>
                      </span>
                    </button>
                  </div>
                </div>

                <div class="db-path">
                  <span class="db-path-text">📁 {{ currentBrowsePath }}</span>
                  <span v-if="currentCanRW === false" class="db-path-tag db-rw-no">只读，无法导出到这里</span>
                  <span v-else-if="currentCanRW === true" class="db-path-tag db-rw-ok">可写</span>
                </div>
                <div v-if="dirLoading" class="db-loading">加载中…</div>
                <div v-else-if="!dirItems.length" class="db-empty">该目录下没有子文件夹</div>
                <div v-else class="db-list">
                  <div
                    v-for="it in dirItems"
                    :key="it.path"
                    class="db-item"
                    :class="{ ro: !it.canRW }"
                    @click="selectDir(it.path)"
                    @dblclick="navigateTo(it.path)"
                  >
                    <span>{{ it.canRW ? '📁' : '🔒' }}</span>
                    <span>{{ it.name }}</span>
                  </div>
                </div>

                <div class="db-bar">
                  <button class="db-nav-btn" :disabled="!canNavigateUp" @click="navigateUp">⬆ 上一级</button>
                  <span class="db-bar-tip">单击选中 · 双击进入</span>
                  <button class="db-confirm-btn" :disabled="currentCanRW === false" @click="confirmExportDir">
                    用这个目录
                  </button>
                </div>
              </div>

              <div class="export-actions">
                <n-button type="primary" :loading="exportingBackup" :disabled="!exportDir" @click="handleExportBackup">
                  📤 导出备份
                </n-button>
              </div>

              <div
                v-if="exportResult"
                class="backup-result"
                :class="{ success: exportResult.success, error: !exportResult.success }"
                style="margin-top: 8px;"
              >
                {{ exportResult.message }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 数据导出 -->
      <div class="section">
        <h3>📊 数据导出</h3>
        <div class="setting-item" style="flex-wrap: wrap; gap: 10px;">
          <n-button type="primary" @click="handleExportCsv" :loading="exportingCsv">
            📋 导出健康记录 CSV
          </n-button>
          <n-button type="info" @click="handleExportDiaryPdf" :loading="exportingDiary">
            📖 导出日记 PDF
          </n-button>
          <n-button @click="handleGeneratePdf" :loading="generatingPdf">
            📄 生成纪念册
          </n-button>
        </div>
        <div class="setting-hint">CSV 包含所有健康指标数据，可用 Excel 打开；日记和相册导出为 PDF 文件</div>
      </div>

      <!-- 推送渠道：企业微信 / 飞书（结构一致，共用一套模板） -->
      <div v-for="ch in pushChannelMeta" :key="ch.key" class="section wecom-section">
        <h3>{{ ch.icon }} {{ ch.name }}推送</h3>
        <div class="setting-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <label>Webhook URL</label>
          <n-input
            v-model:value="channelState[ch.key].url"
            type="textarea"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :placeholder="channelState[ch.key].placeholder || ch.urlPlaceholder"
          />
        </div>
        <div v-if="ch.needsSecret" class="setting-item" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <label>加签密钥</label>
          <n-input
            v-model:value="channelState[ch.key].secret"
            type="password"
            show-password-on="click"
            :placeholder="channelState[ch.key].secretSet ? '已设置（留空则不改动）' : '可留空；仅当机器人开启「签名校验」时需要填写'"
          />
        </div>
        <!-- 推送开关和内容选项 -->
        <div v-if="channelState[ch.key].configured" class="setting-item">
          <label>推送开关</label>
          <n-switch v-model:value="channelState[ch.key].enabled" @update:value="saveChannelPrefs(ch.key)" />
        </div>
        <div v-if="channelState[ch.key].configured && channelState[ch.key].enabled" class="setting-item" style="flex-direction:column; align-items:stretch; gap:6px;">
          <label style="font-size:13px;color:#666;">推送内容</label>
          <n-checkbox-group v-model:value="channelState[ch.key].types" @update:value="saveChannelPrefs(ch.key)">
            <n-space>
              <n-checkbox value="push_daily" label="孕期概览" />
              <n-checkbox value="push_checkup" label="产检安排" />
              <n-checkbox value="push_reminder" label="提醒事项" />
            </n-space>
          </n-checkbox-group>
          <span style="font-size:12px;color:#999;">到达推送时间后，会推送上面勾选的内容（至少勾选一项，改完立即生效）</span>
        </div>
        <div v-if="channelState[ch.key].configured && channelState[ch.key].enabled" class="setting-item">
          <label>每日推送时间</label>
          <n-time-picker v-model:formatted-value="channelState[ch.key].time" format="HH:mm" style="width: 130px" @update:value="saveChannelPrefs(ch.key)" />
          <span style="font-size:12px;color:#999;margin-left:8px;">到达该时间会自动推送，失败会自动重试</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <n-button type="primary" @click="saveChannel(ch.key)" :loading="channelState[ch.key].saving">保存</n-button>
          <n-button @click="sendChannelTest(ch.key)" :loading="channelState[ch.key].testing" :disabled="!channelState[ch.key].configured">测试发送</n-button>
          <n-button v-if="channelState[ch.key].configured" type="warning" quaternary @click="clearChannel(ch.key)">清除</n-button>
        </div>
        <div v-if="channelState[ch.key].configured" class="setting-item">
          <label>状态</label>
          <n-tag :type="channelState[ch.key].status?.success ? 'success' : 'error'" size="small">{{ channelState[ch.key].status?.message || '已配置' }}</n-tag>
        </div>
        <div class="setting-hint" style="padding-left:0; line-height:1.7;">{{ ch.hint }}</div>
      </div>

      <!-- 推送记录（两个渠道合并展示，可按渠道筛选） -->
      <div v-if="anyChannelConfigured" class="section">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <h3 style="margin:0;">📋 推送记录</h3>
          <n-button size="small" @click="loadPushLogs">刷新</n-button>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
          <n-radio-group v-model:value="pushLogFilter" size="small" @update:value="loadPushLogs">
            <n-radio-button value="today">今天</n-radio-button>
            <n-radio-button value="week7">近7天</n-radio-button>
            <n-radio-button value="all">全部</n-radio-button>
          </n-radio-group>
          <n-radio-group v-model:value="pushLogChannel" size="small" @update:value="loadPushLogs">
            <n-radio-button value="">全部渠道</n-radio-button>
            <n-radio-button v-for="ch in pushChannelMeta" :key="ch.key" :value="ch.key">{{ ch.name }}</n-radio-button>
          </n-radio-group>
        </div>
        <div v-if="pushLogs.length === 0" style="text-align:center; color:#999; font-size:13px; padding:20px 0;">暂无推送记录</div>
        <div v-else class="push-log-list">
          <div v-for="log in pushLogs" :key="log.id" class="push-log-item">
            <div class="push-log-left">
              <n-tag :bordered="false" size="small" style="background:var(--bg-secondary,#f1f5f9); color:var(--text-secondary,#64748b);">{{ channelLabel(log.channel) }}</n-tag>
              <n-tag :type="log.status === 'success' ? 'success' : log.status === 'failed' ? 'error' : 'default'" size="small">
                {{ log.status === 'success' ? '成功' : log.status === 'failed' ? '失败' : '等待中' }}
              </n-tag>
              <span class="push-log-type">{{ typeLabel(log.push_type) }}</span>
              <span class="push-log-content">{{ log.push_content }}</span>
            </div>
            <div class="push-log-right">
              <span class="push-log-time">{{ formatLogTime(log.pushed_at || log.created_at) }}</span>
              <n-button v-if="log.status === 'failed'" size="tiny" type="primary" text :loading="retryingId === log.id" @click="retryPush(log.id)">重试</n-button>
            </div>
            <div v-if="log.error_message" class="push-log-error">{{ log.error_message }}</div>
          </div>
        </div>
      </div>

      <!-- 软件日志 -->
      <div class="section">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>📋 软件日志</h3>
          <div style="display:flex; gap:8px;">
            <n-button size="small" @click="loadLogs" :loading="logLoading">刷新</n-button>
            <n-button size="small" @click="clearLogs" type="error" ghost>清空</n-button>
          </div>
        </div>
        <div v-if="logInfo" style="display:flex; gap:12px; margin-bottom:8px; font-size:12px; color:#888;">
          <span>PID: {{ logInfo.pid }}</span>
          <span>运行: {{ formatUptime(logInfo.uptime) }}</span>
          <span>内存: {{ logInfo.memory }}</span>
          <span>Node: {{ logInfo.node_version }}</span>
        </div>
        <div class="log-box">{{ logText || '暂无日志' }}</div>
      </div>

      <!-- 关于 -->
      <div class="section">
        <h3>ℹ️ 关于</h3>
        <div class="setting-item">
          <label>应用</label>
          <span>孕程记 (Pregnancy Journal)</span>
        </div>
        <div class="setting-item">
          <label>理念</label>
          <span>数据私有 · NAS 本地 · 零上云</span>
        </div>
        <div class="setting-item">
          <label>反馈</label>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <a class="feedback-link" href="mailto:celiang-xiang@foxmail.com">✉️ 邮箱：celiang-xiang@foxmail.com</a>
            <a class="feedback-link" href="https://github.com/xiaoke799" target="_blank" rel="noopener">🐙 GitHub：github.com/xiaoke799</a>
            <a class="feedback-link" href="https://qm.qq.com/q/BYvbmcnI4g" target="_blank" rel="noopener">💬 QQ群：689881692（xiaoke799 开发学习）</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { NInput, NButton, NRadioGroup, NRadioButton, NTag, NSwitch, NCheckboxGroup, NCheckbox, NSpace, useMessage } from 'naive-ui'
import dayjs from 'dayjs'
import { usePregnancyStore } from '@/stores/pregnancy'
import { pregnancyApi } from '@/api/pregnancy'
import { exportApi } from '@/api/export'
import client from '@/api/client'
import { pushApi } from '@/api/push'

const logText = ref('')
const logInfo = ref<any>(null)
const logLoading = ref(false)

async function loadLogs() {
  logLoading.value = true
  try {
    const res: any = await exportApi.getLogs()
    if (res.code === 0 && res.data) {
      logText.value = res.data.logs || ''
      logInfo.value = res.data
    }
  } catch { logText.value = '加载失败' }
  logLoading.value = false
}

async function clearLogs() {
  try { await exportApi.clearLogs(); logText.value = '' } catch {}
}

function formatUptime(sec: number) {
  if (!sec) return '-'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}时${m}分` : `${m}分${sec % 60}秒`
}

const pregnancyStore = usePregnancyStore()

// 安全获取 message（防止在特殊上下文中失败导致整个组件崩溃）
let message: any = { success: () => {}, error: () => {}, warning: () => {}, info: () => {} }
try { message = useMessage() } catch {}

const dueDateMode = ref<'lmp' | 'direct'>('lmp')
const primaryDate = ref('')
const babyName = ref('')
const savingPregnancy = ref(false)
const backingUp = ref(false)
const importing = ref(false)
const generatingPdf = ref(false)
const exportingCsv = ref(false)
const exportingDiary = ref(false)
const backupDir = ref('')
const restoreDir = ref('')
const backupResult = ref<{ success: boolean; message: string } | null>(null)

// ===== 导出备份到指定位置 =====
// 与「立即备份」完全独立：立即备份照旧写到默认位置，这里是额外把它另存到用户指定目录。
const exportDir = ref('')
const exportingBackup = ref(false)
const showExportBrowser = ref(false)
const exportResult = ref<{ success: boolean; message: string } | null>(null)
const authorizedDirs = ref<any[]>([])
const defaultBackupDir = ref('')
const storageLoaded = ref(false)
const diag = ref<any>(null)
const manualDir = ref('')
const checkingDir = ref(false)

const showDirBrowser = ref(false)
const browsingFor = ref<'backup' | 'restore'>('backup')
const currentBrowsePath = ref('/')
const dirRoots = ref<any[]>([])
const dirItems = ref<any[]>([])
const dirLoading = ref(false)
const selectedDirPath = ref('')
const currentCanRW = ref<boolean | null>(null)

const allPregnancies = ref<any[]>([])
const activePregnancyId = ref('')

// ===== 推送（企业微信 / 飞书）=====
// 两个渠道的界面结构完全一致，用同一套模板 + 按渠道分片的状态渲染。
const pushChannelMeta = [
  {
    key: 'wecom' as const,
    name: '企业微信',
    icon: '💬',
    needsSecret: false,
    urlPlaceholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx',
    hint: '在企业微信群聊里点「⋯ → 群机器人 → 添加机器人」，复制它的 Webhook 地址粘贴到上面，再点「保存」即可。',
  },
  {
    key: 'feishu' as const,
    name: '飞书',
    icon: '🐦',
    needsSecret: true,
    urlPlaceholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx-xxxx-xxxx',
    hint: '在飞书群里点「设置 → 群机器人 → 添加机器人 → 自定义机器人」，复制 Webhook 地址。若机器人安全设置选了「签名校验」，请把加签密钥填到上面；选了「自定义关键词」，关键词请填「孕程记」；选了「IP 白名单」，需把 NAS 的出口 IP 加进去。',
  },
]

type ChannelState = {
  url: string
  secret: string
  placeholder: string
  secretSet: boolean
  configured: boolean
  enabled: boolean
  types: string[]
  time: string
  status: any
  saving: boolean
  testing: boolean
}

const channelState = reactive<Record<string, ChannelState>>({
  wecom: { url: '', secret: '', placeholder: '', secretSet: false, configured: false, enabled: true, types: ['push_daily', 'push_checkup', 'push_reminder'], time: '08:00', status: null, saving: false, testing: false },
  feishu: { url: '', secret: '', placeholder: '', secretSet: false, configured: false, enabled: true, types: ['push_daily', 'push_checkup', 'push_reminder'], time: '08:00', status: null, saving: false, testing: false },
})

const anyChannelConfigured = computed(() => pushChannelMeta.some(ch => channelState[ch.key].configured))

// 推送记录
const pushLogs = ref<any[]>([])
const pushLogFilter = ref<'today' | 'week7' | 'all'>('all')
const pushLogChannel = ref<string>('')
const retryingId = ref<string | null>(null)

const calculatedDueDate = computed(() => {
  if (!primaryDate.value || dueDateMode.value !== 'lmp') return ''
  return dayjs(primaryDate.value).add(280, 'day').format('YYYY-MM-DD')
})

const trimesterTagType = computed(() => {
  const t = pregnancyStore.gestationalAge?.trimester
  if (t === '孕早期') return 'warning'
  if (t === '孕中期') return 'info'
  if (t === '孕晚期') return 'error'
  return 'default'
})

watch(dueDateMode, () => {
  try { loadDateForMode() } catch {}
})

function loadDateForMode() {
  const p = pregnancyStore.currentPregnancy
  if (!p) {
    primaryDate.value = ''
    return
  }
  if (dueDateMode.value === 'lmp') {
    primaryDate.value = p.last_period_date || ''
  } else {
    primaryDate.value = p.due_date || ''
  }
}

onMounted(() => {
  // 非阻塞加载：不await，让页面先渲染出来
  pregnancyStore.fetchActivePregnancy().then(() => {
    const p = pregnancyStore.currentPregnancy
    if (p) {
      if (p.last_period_date) { dueDateMode.value = 'lmp'; primaryDate.value = p.last_period_date }
      else if (p.due_date) { dueDateMode.value = 'direct'; primaryDate.value = p.due_date }
      babyName.value = p.baby_name || ''
    }
  }).catch(() => {})
  loadAllPregnancies()
  loadChannels()
  loadLogs()
  loadStorageInfo()
})

async function loadAllPregnancies() {
  try {
    const res: any = await pregnancyApi.list()
    if (res.code === 0) {
      allPregnancies.value = res.data?.items || res.data || []
      const active = allPregnancies.value.find((p: any) => p.is_active)
      if (active) activePregnancyId.value = active.id
    }
  } catch {
    // 忽略
  }
}

async function switchPregnancy(id: string) {
  try {
    await pregnancyApi.activate(id)
    await pregnancyStore.fetchActivePregnancy()
    activePregnancyId.value = id
    if (pregnancyStore.currentPregnancy) {
      primaryDate.value = pregnancyStore.currentPregnancy.last_period_date || ''
      babyName.value = pregnancyStore.currentPregnancy.baby_name || ''
    }
    await loadAllPregnancies()
    message.success('已切换孕期')
  } catch {
    message.error('切换失败')
  }
}

// ========== 孕期管理 ==========
async function savePregnancy() {
  if (dueDateMode.value === 'lmp' && !primaryDate.value && !babyName.value) {
    message.warning('请输入末次月经日期或宝宝昵称')
    return
  }
  if (dueDateMode.value === 'direct' && !primaryDate.value) {
    message.warning('请输入预产期日期')
    return
  }
  savingPregnancy.value = true
  try {
    const payload: any = {}
    if (dueDateMode.value === 'lmp') {
      if (primaryDate.value) payload.last_period_date = primaryDate.value
    } else {
      if (primaryDate.value) payload.due_date = primaryDate.value
    }
    if (babyName.value) payload.baby_name = babyName.value
    if (pregnancyStore.currentPregnancy?.id) {
      await pregnancyApi.update(pregnancyStore.currentPregnancy.id, payload)
      message.success('孕期信息已更新')
    } else {
      await pregnancyApi.create(payload)
      message.success('孕期档案创建成功！')
    }
    await pregnancyStore.fetchActivePregnancy()
    if (pregnancyStore.currentPregnancy) {
      primaryDate.value = pregnancyStore.currentPregnancy.last_period_date || ''
      babyName.value = pregnancyStore.currentPregnancy.baby_name || ''
    }
    await loadAllPregnancies()
  } catch {
    message.error('保存失败，请重试')
  }
  savingPregnancy.value = false
}

// ========== 目录浏览器 ==========
const canNavigateUp = computed(() => currentBrowsePath.value !== '/' && currentBrowsePath.value.length > 1)

// 可选起点一览：用户授权目录 / 应用共享目录 / 存储卷（没授权任何目录时的兜底）。
// 不再单独排一行「根目录按钮」——集合与这里完全一致，两排只会显得重复。
const quickDirs = computed(() => dirRoots.value)

function toggleDirBrowser(forWhat: 'backup' | 'restore') {
  if (showDirBrowser.value && browsingFor.value === forWhat) {
    showDirBrowser.value = false
    return
  }
  browsingFor.value = forWhat
  selectedDirPath.value = forWhat === 'backup' ? backupDir.value : restoreDir.value
  dirRoots.value = []
  dirItems.value = []
  dirLoading.value = false
  currentCanRW.value = null
  currentBrowsePath.value = '/'
  showDirBrowser.value = true
  loadDirRoots()
}

async function loadDirRoots() {
  dirLoading.value = true
  try {
    const res: any = await exportApi.browseDir('/')
    if (res.code === 0 && res.data) {
      dirRoots.value = res.data.roots || []
      if (dirRoots.value.length > 0) {
        currentBrowsePath.value = dirRoots.value[0].path
        currentCanRW.value = dirRoots.value[0].canRW || false
        await loadDirItems(currentBrowsePath.value)
      }
    }
  } catch (e) { console.error('loadDirRoots:', e); dirRoots.value = [] }
  dirLoading.value = false
}

async function navigateTo(dirPath: string) {
  if (!dirPath) return
  currentBrowsePath.value = dirPath
  selectedDirPath.value = dirPath
  const root = dirRoots.value.find((r: any) => r.path === dirPath || dirPath.startsWith(r.path))
  currentCanRW.value = root ? root.canRW : null
  await loadDirItems(dirPath)
}

async function loadDirItems(dirPath: string) {
  dirLoading.value = true
  try {
    const res: any = await exportApi.browseDir(dirPath)
    if (res.code === 0 && res.data) {
      dirItems.value = res.data.items || []
      if (res.data.canRW !== undefined) currentCanRW.value = res.data.canRW
      if (!dirRoots.value.length && res.data.roots) dirRoots.value = res.data.roots
    }
  } catch (e) { console.error('loadDirItems:', e); dirItems.value = [] }
  dirLoading.value = false
}

function navigateUp() {
  const parts = currentBrowsePath.value.split('/').filter(Boolean)
  parts.pop()
  navigateTo('/' + parts.join('/') || '/')
}

function selectDir(path: string) { selectedDirPath.value = path }

function confirmDirSelect() {
  if (browsingFor.value === 'backup') backupDir.value = selectedDirPath.value
  else restoreDir.value = selectedDirPath.value
  showDirBrowser.value = false
}

// ========== 导出备份到指定位置 ==========
/** 读取「默认备份落点 + 用户已授权目录」。用户授权目录由飞牛系统通过环境变量注入，
 *  只能由用户在「应用中心 → 应用设置 → 授权目录」里添加，应用自己无权代劳。 */
async function loadStorageInfo() {
  try {
    const res: any = await exportApi.storageInfo()
    if (res.code === 0 && res.data) {
      defaultBackupDir.value = res.data.default_backup_dir || ''
      authorizedDirs.value = res.data.authorized_dirs || []
      diag.value = res.data.diag || null
    }
  } catch (e) {
    console.error('loadStorageInfo:', e)
  }
  storageLoaded.value = true
}

async function toggleExportBrowser() {
  if (showExportBrowser.value) {
    showExportBrowser.value = false
    return
  }
  showExportBrowser.value = true
  browsingFor.value = 'backup'
  selectedDirPath.value = exportDir.value
  currentCanRW.value = null
  if (!dirRoots.value.length) {
    await loadDirRoots()
  }
  if (exportDir.value) {
    currentBrowsePath.value = exportDir.value
    await loadDirItems(exportDir.value)
  }
}

/** 点「推荐位置」里的快捷目录：直接选定并进入 */
function pickQuickDir(d: any) {
  if (!d || d.canRW === false) return
  exportDir.value = d.path
  navigateTo(d.path)
}

function confirmExportDir() {
  const p = selectedDirPath.value || currentBrowsePath.value
  if (!p) return
  exportDir.value = p
  showExportBrowser.value = false
}

/** 手动填路径：交给后端做真实写入测试，写得进去才认（ACL 就是授权凭证） */
async function applyManualDir() {
  const p = manualDir.value.trim()
  if (!p) return
  checkingDir.value = true
  try {
    const res: any = await exportApi.trustDir(p)
    if (res.code === 0) {
      exportDir.value = res.data?.dir || p
      manualDir.value = ''
      message.success('目录可写，已选为导出位置')
      loadStorageInfo()
    } else {
      message.error(res.message || '该目录不可用')
    }
  } catch (e: any) {
    message.error('检查失败：' + (e?.message || ''))
  }
  checkingDir.value = false
}

async function handleExportBackup() {
  if (!exportDir.value) {
    message.warning('请先选择导出目录')
    return
  }
  exportingBackup.value = true
  exportResult.value = null
  try {
    const res: any = await exportApi.backup(exportDir.value)
    if (res.code === 0) {
      const where = res.data?.dir || exportDir.value
      exportResult.value = {
        success: true,
        message: `导出完成！共 ${res.data?.total_rows || 0} 条记录、${res.data?.files?.total || 0} 个文件。位置：${where}`,
      }
      message.success('备份已导出')
      loadStorageInfo()
    } else {
      exportResult.value = { success: false, message: res.message || '导出失败' }
      message.error('导出失败')
    }
  } catch (e: any) {
    exportResult.value = { success: false, message: '导出失败: ' + (e?.message || '') }
    message.error('导出失败')
  }
  exportingBackup.value = false
}

// ========== 数据管理 ==========
async function handleBackup() {
  backingUp.value = true
  backupResult.value = null
  try {
    const res: any = await exportApi.backup(undefined)
    if (res.code === 0) {
      const dirPath = res.data?.dir || '未知路径'
      backupResult.value = { success: true, message: `备份完成！共 ${res.data?.total_rows || 0} 条记录，${res.data?.files?.total || 0} 个文件。备份位置：${dirPath}，请手动复制该备份文件到安全位置保存。` }
      message.success('备份成功')
    } else {
      backupResult.value = { success: false, message: res.message || '备份失败' }
      message.error('备份失败: ' + (res.message || ''))
    }
  } catch (e: any) {
    backupResult.value = { success: false, message: '备份失败: ' + (e?.message || '') }
    message.error('备份失败')
  }
  backingUp.value = false
}

async function handleRestoreLatest() {
  if (!confirm('确定要从最新备份数据恢复吗？当前数据将被覆盖！建议先手动备份一次。')) return
  importing.value = true
  backupResult.value = null
  try {
    const res: any = await exportApi.restoreLatest()
    if (res.code === 0) {
      backupResult.value = { success: true, message: res.message || '恢复成功！页面将刷新...' }
      message.success('恢复成功，正在刷新...')
      setTimeout(() => window.location.reload(), 1500)
    } else {
      backupResult.value = { success: false, message: res.message || '恢复失败' }
      message.error('恢复失败: ' + (res.message || ''))
    }
  } catch (e: any) {
    backupResult.value = { success: false, message: '恢复失败: ' + (e?.message || '') }
    message.error('恢复失败')
  }
  importing.value = false
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟释放：立即 revokeObjectURL 会让部分浏览器（尤其 iframe/WebView）取消下载，
  // 表现为「提示成功但找不到文件」
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

async function handleExportCsv() {
  if (!pregnancyStore.currentPregnancy?.id) { message.warning('请先创建孕期档案'); return }
  exportingCsv.value = true
  try {
    const res: any = await exportApi.exportCsv({ pregnancy_id: pregnancyStore.currentPregnancy.id })
    if (res instanceof Blob) {
      downloadBlob(res, `孕程记_健康记录_${new Date().toISOString().slice(0, 10)}.csv`)
      message.success('CSV 导出成功')
    } else if (res && typeof res === 'object' && res.code !== undefined) {
      message.warning(res.message || '没有可导出的数据')
    } else if (res) {
      const blob = new Blob([res], { type: 'text/csv;charset=utf-8;' })
      downloadBlob(blob, `孕程记_健康记录_${new Date().toISOString().slice(0, 10)}.csv`)
      message.success('CSV 导出成功')
    } else {
      message.warning('没有可导出的数据')
    }
  } catch (e: any) {
    message.error('导出失败: ' + (e?.message || ''))
  }
  exportingCsv.value = false
}

async function handleExportDiaryPdf() {
  if (!pregnancyStore.currentPregnancy?.id) { message.warning('请先创建孕期档案'); return }
  exportingDiary.value = true
  try {
    const res: any = await exportApi.exportDiaryPdf({ pregnancy_id: pregnancyStore.currentPregnancy.id })
    if (res instanceof Blob) {
      downloadBlob(res, `孕程记_日记_${new Date().toISOString().slice(0,10)}.pdf`)
      message.success('日记 PDF 导出成功')
    } else if (res && typeof res === 'object' && res.code !== undefined) {
      message.warning(res.message || '没有可导出的日记内容')
    } else if (res) {
      const blob = new Blob([res], { type: 'application/pdf' })
      downloadBlob(blob, `孕程记_日记_${new Date().toISOString().slice(0,10)}.pdf`)
      message.success('日记 PDF 导出成功')
    } else {
      message.warning(res?.message || '没有可导出的日记内容')
    }
  } catch (e: any) {
    message.error('导出失败: ' + (e?.message || ''))
  }
  exportingDiary.value = false
}

async function handleGeneratePdf() {
  if (!pregnancyStore.currentPregnancy) {
    message.warning('请先创建孕期档案')
    return
  }
  generatingPdf.value = true
  try {
    const res: any = await exportApi.exportAlbumPdf({ pregnancy_id: pregnancyStore.currentPregnancy.id })
    if (res instanceof Blob) {
      downloadBlob(res, `孕程记_纪念相册_${new Date().toISOString().slice(0,10)}.pdf`)
      message.success('纪念相册 PDF 生成成功')
    } else if (res && typeof res === 'object' && res.code !== undefined) {
      message.error('生成失败' + (res.message ? ': ' + res.message : ''))
    } else if (res) {
      const blob = new Blob([res], { type: 'application/pdf' })
      downloadBlob(blob, `孕程记_纪念相册_${new Date().toISOString().slice(0,10)}.pdf`)
      message.success('纪念相册 PDF 生成成功')
    } else {
      message.error('生成失败，没有可导出的相册内容')
    }
  } catch (e: any) {
    message.error('生成失败: ' + (e?.message || ''))
  }
  generatingPdf.value = false
}

// ========== 推送渠道（企业微信 / 飞书）==========
async function loadChannel(chKey: string) {
  const st = channelState[chKey]
  try {
    const res: any = await pushApi.getChannelConfig(chKey as any)
    const d = res?.data || {}
    st.configured = !!d.configured
    st.enabled = d.enabled !== false
    if (d.url_placeholder) st.placeholder = d.url_placeholder
    st.secretSet = !!d.secret_set
    const types: string[] = []
    if (d.push_daily !== false) types.push('push_daily')
    if (d.push_checkup !== false) types.push('push_checkup')
    if (d.push_reminder !== false) types.push('push_reminder')
    st.types = types
    st.time = d.push_time || '08:00'
    // 地址与密钥不回显，输入框留空（重新填写才会覆盖）
    st.url = ''
    st.secret = ''
    st.status = d.status || null
  } catch {
    // 忽略
  }
}

async function loadChannels() {
  try {
    const res: any = await pushApi.getChannels()
    for (const ch of (res?.data || [])) {
      const st = channelState[ch.channel]
      if (!st) continue
      st.configured = !!ch.configured
      st.enabled = ch.enabled !== false
      if (ch.url_placeholder) st.placeholder = ch.url_placeholder
      st.secretSet = !!ch.secret_set
      const types: string[] = []
      if (ch.push_daily !== false) types.push('push_daily')
      if (ch.push_checkup !== false) types.push('push_checkup')
      if (ch.push_reminder !== false) types.push('push_reminder')
      st.types = types
      st.time = ch.push_time || '08:00'
      st.status = ch.status || null
    }
  } catch {
    // 忽略
  }
  loadPushLogs()
}

/** 保存地址（重新填写时才带地址；地址留空则只保存当前偏好） */
async function saveChannel(chKey: string) {
  const st = channelState[chKey]
  if (!st.url.trim() && !st.configured) {
    message.warning('请输入 Webhook URL')
    return
  }
  st.saving = true
  try {
    const payload: any = {
      enabled: st.enabled,
      push_daily: st.types.includes('push_daily'),
      push_checkup: st.types.includes('push_checkup'),
      push_reminder: st.types.includes('push_reminder'),
      push_time: st.time,
    }
    if (st.url.trim()) payload.webhook_url = st.url.trim()
    if (st.secret.trim()) payload.secret = st.secret.trim()

    const res: any = await pushApi.saveChannelConfig(chKey as any, payload)
    if (res.code === 0) {
      // 配置一定已保存；测试发送可能因网络抖动失败，用 warning 区分提示
      if (res.data && res.data.test_failed) message.warning(res.message || '配置已保存，但测试发送失败')
      else message.success(res.message || '保存成功')
      if (st.url.trim()) st.configured = true
      await loadChannel(chKey)
    } else {
      message.error(res.message || '保存失败')
    }
  } catch (e: any) {
    message.error('保存失败: ' + (e?.message || ''))
  }
  st.saving = false
}

async function sendChannelTest(chKey: string) {
  const st = channelState[chKey]
  st.testing = true
  try {
    const res: any = await pushApi.sendTest(chKey as any)
    if (res.code === 0) message.success(res.message || '测试消息已发送到群聊，请查看')
    else message.error(res.message || '发送失败')
  } catch (e: any) {
    message.error('发送失败: ' + (e?.message || ''))
  }
  st.testing = false
}

async function clearChannel(chKey: string) {
  const st = channelState[chKey]
  const meta = pushChannelMeta.find(c => c.key === chKey)
  try {
    const res: any = await pushApi.saveChannelConfig(chKey as any, { webhook_url: '' })
    if (res.code === 0) {
      st.configured = false
      st.status = null
      st.url = ''
      st.secret = ''
      st.secretSet = false
      message.info(res.message || `已清除${meta?.name || ''}配置`)
      loadPushLogs()
    } else {
      message.error(res.message || '操作失败')
    }
  } catch (e: any) {
    message.error('操作失败: ' + (e?.message || ''))
  }
}

async function saveChannelPrefs(chKey: string) {
  const st = channelState[chKey]
  if (!st.configured) return
  try {
    await pushApi.saveChannelConfig(chKey as any, {
      enabled: st.enabled,
      push_checkup: st.types.includes('push_checkup'),
      push_daily: st.types.includes('push_daily'),
      push_reminder: st.types.includes('push_reminder'),
      push_time: st.time,
    })
  } catch (e: any) { console.error('保存推送偏好失败:', e?.message) }
}

// ========== 推送记录 ==========
async function loadPushLogs() {
  try {
    const res: any = await pushApi.getLogs(pushLogFilter.value, pushLogChannel.value as any)
    pushLogs.value = res?.data || []
  } catch (e: any) { console.error('加载推送记录失败:', e?.message) }
}

async function retryPush(logId: string) {
  retryingId.value = logId
  try {
    const res: any = await pushApi.retry(logId)
    if (res.code === 0) { message.success(res.message || '重试成功'); loadPushLogs() }
    else message.warning(res.message || '重试失败')
  } catch (e: any) { message.error(e?.message || '重试失败') }
  finally { retryingId.value = null }
}

function channelLabel(ch?: string): string {
  const map: Record<string, string> = { wecom: '企业微信', feishu: '飞书' }
  return map[ch || 'wecom'] || (ch || '企业微信')
}

function typeLabel(type: string): string {
  const map: Record<string, string> = { daily: '每日看板', test: '测试', checkup: '产检提醒', reminder: '提醒' }
  return map[type] || type
}

function formatLogTime(t?: string): string {
  if (!t) return ''
  // 后端统一写「本地时间」字符串（2026-09-23 08:00:00，无时区标记）。
  // 部分浏览器对这种格式解析有兼容问题，统一补成 ISO 本地时间形式再解析。
  let s = String(t).trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) s = s.replace(' ', 'T')
  const d = new Date(s)
  if (isNaN(d.getTime())) return String(t)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

</script>

<style scoped>
.settings-view { max-width: 600px; margin: 0 auto; padding: 16px; }
.section { background: var(--bg-card, white); border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.section h3 { margin-bottom: 16px; font-size: 16px; }
.setting-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-color, #e2e8f0); }
.setting-item:last-child { border-bottom: none; }
.setting-item label { min-width: 72px; color: var(--text-secondary, #64748b); font-size: 14px; flex-shrink: 0; }
.feedback-link { color: var(--primary-color, #c44680); text-decoration: none; font-size: 14px; transition: opacity .15s; word-break: break-all; }
.feedback-link:hover { text-decoration: underline; opacity: .82; }
.setting-hint { font-size: 12px; color: var(--text-hint, #94a3b8); padding: 4px 0 0 84px; margin-top: 4px; }
.due-date-value { color: var(--primary-color, #c44680); font-weight: 600; }
.due-date-value.calculated { font-size: 16px; }
.gestational-info { font-weight: 600; }
.mode-switcher { flex-direction: column; align-items: stretch; gap: 8px; }
.mode-switcher label { min-width: auto; }

.pregnancy-status {
  background: var(--bg-secondary, #f8f9fa);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.status-row { display: flex; gap: 24px; flex-wrap: wrap; }
.status-item { display: flex; flex-direction: column; gap: 4px; }
.status-label { font-size: 12px; color: var(--text-hint, #94a3b8); }

.pregnancy-form { display: flex; flex-direction: column; gap: 16px; }
.form-group { display: flex; flex-direction: column; gap: 8px; }
.form-label { font-size: 14px; font-weight: 600; color: var(--text-secondary, #64748b); }
.date-input {
  width: 100%; height: 40px; padding: 0 12px;
  border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px;
  font-size: 15px; color: var(--text-color, #1e293b);
  background: white; outline: none; transition: border-color 0.2s; box-sizing: border-box;
}
.date-input:focus { border-color: var(--primary-color, #c44680); box-shadow: 0 0 0 2px rgba(196,70,128,.15); }
.date-input::-webkit-calendar-picker-indicator { cursor: pointer; }
.form-actions { padding-top: 8px; }

.pregnancy-item {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border-radius: 8px; cursor: pointer; transition: background-color 0.2s, border-color 0.2s;
  border: 2px solid transparent; margin-bottom: 4px;
}
.pregnancy-item:hover { background: rgba(232,160,191,0.05); }
.pregnancy-item.active { border-color: var(--primary-color, #c44680); background: rgba(232,160,191,0.1); }
.log-box {
  background: #1e1e2e;
  color: #a6e3a1;
  border-radius: 8px;
  padding: 12px;
  font-family: "Cascadia Code", "Fira Code", monospace;
  font-size: 11px;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.pregnancy-name { font-weight: 600; }
.pregnancy-due { color: var(--text-secondary, #64748b); font-size: 13px; flex: 1; }

.wecom-section { border-left: 4px solid #07c160; }

.push-log-list { display: flex; flex-direction: column; gap: 6px; }
.push-log-item { background: #f8fafc; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
.push-log-left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.push-log-type { font-weight: 500; color: #333; font-size: 12px; }
.push-log-content { color: #666; font-size: 12px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.push-log-right { display: flex; align-items: center; gap: 8px; margin-top: 4px; justify-content: flex-end; }
.push-log-time { color: #999; font-size: 11px; }
.push-log-error { color: #e53e3e; font-size: 11px; margin-top: 4px; }

.dir-browser-inline {
  border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;
  background: #fafbfc; margin-top: 6px;
}
.db-roots {
  display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px;
  background: #f1f5f9; border-bottom: 1px solid #e2e8f0;
}
.db-root-btn {
  padding: 4px 12px; border: 1px solid #cbd5e1; border-radius: 6px;
  background: white; cursor: pointer; font-size: 13px; transition: all 0.15s;
}
.db-root-btn:hover { border-color: #3b82f6; color: #3b82f6; }
.db-root-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
.db-root-btn.readonly { opacity: 0.6; }
.db-hint { font-size: 12px; color: #ef4444; padding: 4px 0; }
.db-ro-tag {
  font-size: 10px; padding: 1px 5px; background: #fef3c7; color: #d97706;
  border-radius: 4px; margin-left: 4px;
}
.db-path {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 12px; font-size: 13px; color: #475569;
  border-bottom: 1px solid #e2e8f0; background: white;
}
.db-path-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-path-tag { flex-shrink: 0; font-size: 12px; }
.db-rw-ok { color: #16a34a; font-weight: 600; }
.db-rw-no { color: #dc2626; font-weight: 600; }
.db-loading, .db-empty {
  padding: 24px; text-align: center; color: #94a3b8; font-size: 13px;
}
.db-list { max-height: 200px; overflow-y: auto; }
.db-item {
  padding: 8px 14px; cursor: pointer; display: flex; align-items: center; gap: 6px;
  font-size: 13.5px; border-bottom: 1px solid #f1f5f9; transition: background 0.15s;
}
.db-item:hover { background: #eff6ff; }
.db-item.ro { opacity: 0.55; }
.db-bar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 12px; border-top: 1px solid #e2e8f0; background: #f8fafc;
}
.db-nav-btn {
  padding: 5px 14px; border: 1px solid #cbd5e1; border-radius: 6px;
  background: white; cursor: pointer; font-size: 12.5px;
}
.db-nav-btn:hover:not(:disabled) { background: #f1f5f9; }
.db-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.db-confirm-btn {
  padding: 5px 16px; border: none; border-radius: 6px;
  background: #2563eb; color: white; cursor: pointer; font-size: 12.5px; font-weight: 600;
}
.db-confirm-btn:hover:not(:disabled) { background: #1d4ed8; }
.db-confirm-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 快捷目录选择区 */
.db-quick-select {
  padding: 10px 12px;
  background: linear-gradient(135deg, #f0f9ff, #faf5ff);
  border-bottom: 1px solid #e2e8f0;
}
.db-quick-label {
  font-size: 11px;
  font-weight: 600;
  color: #6366f1;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.db-quick-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.db-quick-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1.5px solid #c7d2fe;
  border-radius: 10px;
  background: white;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
  position: relative;
}
.db-quick-btn:hover { border-color: #818cf8; background: #eef2ff; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(99,102,241,0.15); }
.db-quick-btn.accessible { border-color: #a5b4fc; }
.db-quick-btn.accessible:hover, .db-quick-btn.accessible.active { border-color: #6366f1; background: #ede9fe; }
.db-quick-btn.share { border-color: #93c5fd; }
.db-quick-btn.share:hover, .db-quick-btn.share.active { border-color: #3b82f6; background: #dbeafe; }
.db-quick-btn.volume { border-color: #86efac; }
.db-quick-btn.volume:hover, .db-quick-btn.volume.active { border-color: #22c55e; background: #dcfce7; }
.db-quick-btn.active { font-weight: 600; box-shadow: 0 0 0 2px rgba(99,102,241,0.3); }
.db-quick-btn.ro { opacity: 0.5; cursor: not-allowed; }
.db-quick-icon { font-size: 16px; }
.db-quick-name { font-weight: 500; color: #334155; }
.db-quick-desc { font-size: 10px; color: #94a3b8; }

/* 简化备份恢复 */
.backup-simple { display: flex; flex-direction: column; gap: 12px; }
.backup-card {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; border-radius: 10px;
  background: #f8fafc; border: 1px solid #e2e8f0;
}
.backup-card-icon { font-size: 28px; flex-shrink: 0; }
.backup-card-body { flex: 1; min-width: 0; }
.backup-card-title { font-size: 15px; font-weight: 600; color: var(--text-color, #1e293b); }
.backup-card-desc { font-size: 12px; color: var(--text-hint, #94a3b8); margin-top: 2px; line-height: 1.4; }
.backup-result {
  padding: 10px 14px; border-radius: 8px; font-size: 13px; line-height: 1.5;
  word-break: break-all;
}
.backup-result.success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
.backup-result.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

/* ===== 导出备份到指定位置 ===== */
.backup-path-hint { margin-top: 4px; font-size: 12px; color: #64748b; word-break: break-all; }
.backup-path-hint code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 11.5px; color: #475569; }

.export-card { align-items: flex-start; }
.export-target {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 10px;
}
.export-target-label { font-size: 12.5px; color: #64748b; }
.export-target-path {
  font-size: 12.5px; color: #1e293b; background: #fff;
  border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 10px;
  max-width: 100%; word-break: break-all;
}
.export-target-path.empty { color: #94a3b8; font-style: italic; }

.export-manual { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.export-input {
  flex: 1 1 190px; min-width: 0; padding: 5px 10px; font-size: 12.5px;
  border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #1e293b;
}
.export-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15); }

.export-guide {
  margin-top: 10px; padding: 10px 12px; border-radius: 8px;
  background: #fffbeb; border: 1px solid #fde68a;
  font-size: 12.5px; color: #92400e; line-height: 1.6;
}
.export-guide code { background: #fef3c7; padding: 1px 5px; border-radius: 4px; }

/* 授权目录排查区 */
.export-diag {
  margin-top: 10px; border: 1px solid #e2e8f0; border-radius: 8px;
  background: #f8fafc; overflow: hidden;
}
.export-diag > summary {
  padding: 9px 12px; cursor: pointer; color: #475569; font-size: 12.5px;
  list-style: none; user-select: none;
}
.export-diag > summary::-webkit-details-marker { display: none; }
.export-diag > summary::before { content: '🔍 '; }
.export-diag[open] > summary {
  border-bottom: 1px solid #e2e8f0; background: #f1f5f9;
  color: #1e293b; font-weight: 600;
}
.diag-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.diag-row { display: flex; flex-wrap: wrap; gap: 2px 8px; }
.diag-k { flex: 0 0 124px; color: #64748b; font-size: 12px; }
.diag-v {
  flex: 1 1 150px; min-width: 0; color: #1e293b; word-break: break-all;
  font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
}
.diag-v.bad { color: #dc2626; font-weight: 600; }
.diag-v.wrap { font-size: 11px; line-height: 1.5; }
.diag-tip {
  margin-top: 4px; padding: 8px 10px; border-radius: 6px;
  background: #fffbeb; border: 1px solid #fde68a; color: #92400e;
  font-size: 12px; line-height: 1.6;
}

.export-card .dir-browser-inline { margin-top: 10px; }
/* 起点按钮：路径可能很长（/vol1/@appshare/...），限宽 + 省略号，别把按钮撑成两行 */
.db-quick-btn { max-width: 100%; overflow: hidden; }
.db-quick-btn .db-quick-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
.db-quick-btn .db-quick-name,
.db-quick-btn .db-quick-desc { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.db-bar-tip { font-size: 11px; color: #94a3b8; }
.export-actions { margin-top: 12px; }
</style>
