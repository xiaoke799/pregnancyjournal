<template>
  <div class="record-view" :class="{ 'is-mobile': isMobile }">
    <!-- ====== 1. 日历区域（固定不滚动）====== -->
    <div class="calendar-section">
      <MiniCalendar @select="onDateSelect" />
    </div>

    <!-- ====== 2. 操作栏（+ 添加按钮 / 日期标题）====== -->
    <div class="action-bar">
      <h3 class="date-title">{{ selectedDate }}</h3>
      <n-popover trigger="click" placement="bottom-end" :show-arrow="false" :style="{ maxWidth: '320px', padding: '8px' }">
        <template #trigger>
          <n-button type="primary" round :size="isMobile ? 'medium' : 'small'">
            <template #icon>＋</template>
            {{ isMobile ? '添加' : '添加记录' }}
          </n-button>
        </template>
        <div class="type-menu">
          <div
            v-for="t in quickTypes"
            :key="t.value"
            class="type-menu-item"
            @click="openQuickAdd(t.value)"
          >
            <span class="type-menu-icon">{{ t.icon }}</span>
            <span class="type-menu-label">{{ t.label }}</span>
          </div>
        </div>
      </n-popover>
    </div>

    <!-- ====== 3. 今日数据预览卡片 ====== -->
    <div v-if="previewItems.length > 0" class="preview-section">
      <div class="preview-grid">
        <div
          v-for="item in previewItems"
          :key="item.type"
          class="preview-card"
          :style="{ '--preview-color': item.color }"
        >
          <span class="preview-icon">{{ item.icon }}</span>
          <span class="preview-value">{{ item.value }}</span>
          <span class="preview-label">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <!-- ====== 4. 记录分类列表（独立滚动区域）====== -->
    <div class="list-section">
      <RecordList
        :date="selectedDate"
        :records="currentRecords"
        @edit="onEditRecord"
        @add-type="openQuickAdd"
      />
    </div>

    <!-- ====== 各类型独立小弹窗 ====== -->

    <!-- 体重弹窗 -->
    <n-modal
      v-model:show="showWeightModal"
      preset="card"
      title="⚖️ 记录体重"
      style="max-width: 400px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetWeightForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="weightForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>体重 (kg)</label>
          <n-input-number v-model:value="weightForm.value" :min="30" :max="200" :step="0.1" placeholder="请输入体重" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>备注（可选）</label>
          <n-input v-model:value="weightForm.note" placeholder="可选" />
        </div>
      </div>
      <template #action>
        <n-button @click="showWeightModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveWeight">保存</n-button>
      </template>
    </n-modal>

    <!-- 血压弹窗 -->
    <n-modal
      v-model:show="showBpModal"
      preset="card"
      title="🩺 记录血压"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetBpForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="bpForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-row">
          <div class="qf-group flex1">
            <label>收缩压 (mmHg)</label>
            <n-input-number v-model:value="bpForm.systolic" :min="60" :max="200" placeholder="高压" style="width: 100%" />
          </div>
          <div class="qf-group flex1">
            <label>舒张压 (mmHg)</label>
            <n-input-number v-model:value="bpForm.diastolic" :min="40" :max="140" placeholder="低压" style="width: 100%" />
          </div>
        </div>
        <div class="qf-group">
          <label>备注（可选）</label>
          <n-input v-model:value="bpForm.note" placeholder="可选" />
        </div>
      </div>
      <template #action>
        <n-button @click="showBpModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveBp">保存</n-button>
      </template>
    </n-modal>

    <!-- 血糖弹窗 -->
    <n-modal
      v-model:show="showGlucoseModal"
      preset="card"
      title="🩸 记录血糖"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetGlucoseForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="glucoseForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>测量时段</label>
          <n-radio-group v-model:value="glucoseForm.period" size="small">
            <n-radio-button value="fasting">空腹</n-radio-button>
            <n-radio-button value="1h">餐后1h</n-radio-button>
            <n-radio-button value="2h">餐后2h</n-radio-button>
          </n-radio-group>
        </div>
        <div class="qf-group">
          <label>血糖值 (mmol/L)</label>
          <n-input-number v-model:value="glucoseForm.value" :min="0" :max="30" :step="0.1" placeholder="请输入" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>备注（可选）</label>
          <n-input v-model:value="glucoseForm.note" placeholder="可选" />
        </div>
      </div>
      <template #action>
        <n-button @click="showGlucoseModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveGlucose">保存</n-button>
      </template>
    </n-modal>

    <!-- 胎心弹窗 -->
    <n-modal
      v-model:show="showFhrModal"
      preset="card"
      title="❤️ 测胎心"
      style="max-width: 400px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetFhrForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="fhrForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>胎心率 (bpm)</label>
          <n-input-number v-model:value="fhrForm.value" :min="60" :max="200" placeholder="110-160" style="width: 100%" />
        </div>
        <div class="form-hint-text">💡 正常范围：110-160 bpm</div>
        <div class="qf-group">
          <label>备注（可选）</label>
          <n-input v-model:value="fhrForm.note" placeholder="可选" />
        </div>
      </div>
      <template #action>
        <n-button @click="showFhrModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveFhr">保存</n-button>
      </template>
    </n-modal>

    <!-- 便便弹窗 -->
    <n-modal
      v-model:show="showStoolModal"
      preset="card"
      title="💩 记录便便"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetStoolForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="stoolForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>排便次数</label>
          <n-input-number v-model:value="stoolForm.count" :min="0" :max="10" placeholder="次数" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>便质</label>
          <n-radio-group v-model:value="stoolForm.consistency" size="small">
            <n-radio-button value="hard">干硬</n-radio-button>
            <n-radio-button value="normal">正常</n-radio-button>
            <n-radio-button value="soft">偏软</n-radio-button>
            <n-radio-button value="diarrhea">腹泻</n-radio-button>
          </n-radio-group>
        </div>
        <div class="qf-group">
          <label>备注（可选）</label>
          <n-input v-model:value="stoolForm.note" placeholder="可选" />
        </div>
      </div>
      <template #action>
        <n-button @click="showStoolModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveStool">保存</n-button>
      </template>
    </n-modal>

    <!-- 心情弹窗 -->
    <n-modal
      v-model:show="showMoodModal"
      preset="card"
      title="😊 记录心情"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetMoodForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="moodForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>今天心情如何？</label>
          <div class="mood-btn-row">
            <button
              v-for="m in moodOptions" :key="m.value"
              class="mood-pick-btn" :class="{ active: moodForm.value === m.value }"
              @click="moodForm.value = m.value"
            >{{ m.emoji }} {{ m.label }}</button>
          </div>
        </div>
        <div class="qf-group">
          <label>心情备注（可选）</label>
          <n-input v-model:value="moodForm.note" type="textarea" :rows="2" placeholder="记录一下..." />
        </div>
      </div>
      <template #action>
        <n-button @click="showMoodModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveMood">保存</n-button>
      </template>
    </n-modal>

    <!-- 日记弹窗 -->
    <n-modal
      v-model:show="showNoteModal"
      preset="card"
      title="📝 写日记"
      style="max-width: 480px; width: 94vw;"
      :mask-closable="true"
      @after-leave="resetNoteForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="noteForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>日记内容</label>
          <n-input v-model:value="noteForm.content" type="textarea" :rows="5" placeholder="记录今天的感受..." />
        </div>
      </div>
      <template #action>
        <n-button @click="showNoteModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveNote">保存</n-button>
      </template>
    </n-modal>

    <!-- 症状弹窗 -->
    <n-modal
      v-model:show="showSymptomModal"
      preset="card"
      title="📋 记录症状"
      style="max-width: 440px; width: 94vw;"
      :mask-closable="true"
      @after-leave="resetSymptomForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="symptomForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>选择症状（可多选）</label>
          <div class="symptom-tag-grid">
            <span
              v-for="s in symptomOptions" :key="s"
              class="symptom-chip" :class="{ selected: symptomForm.items.includes(s) }"
              @click="toggleSymptomItem(s)"
            >{{ s }}</span>
          </div>
        </div>
      </div>
      <template #action>
        <n-button @click="showSymptomModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveSymptom">保存</n-button>
      </template>
    </n-modal>

    <!-- 补充剂弹窗 -->
    <n-modal
      v-model:show="showSupplementModal"
      preset="card"
      title="💊 营养补充"
      style="max-width: 440px; width: 94vw;"
      :mask-closable="true"
      @after-leave="resetSupplementForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="supplementForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>今日补充（可多选）</label>
          <div class="supp-tag-grid">
            <span
              v-for="s in supplementOptions" :key="s"
              class="supp-chip" :class="{ selected: supplementForm.items.includes(s) }"
              @click="toggleSuppItem(s)"
            >{{ s }}</span>
          </div>
        </div>
      </div>
      <template #action>
        <n-button @click="showSupplementModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveSupplement">保存</n-button>
      </template>
    </n-modal>

    <!-- 好习惯弹窗 -->
    <n-modal
      v-model:show="showHabitModal"
      preset="card"
      title="✅ 好习惯打卡"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetHabitForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="habitForm.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>今日完成的好习惯</label>
          <n-input v-model:value="habitForm.text" type="textarea" :rows="3" placeholder="如：喝了8杯水、散步30分钟、吃了叶酸..." />
        </div>
      </div>
      <template #action>
        <n-button @click="showHabitModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveHabit">保存</n-button>
      </template>
    </n-modal>

    <!-- 体温弹窗 -->
    <n-modal v-model:show="showTempModal" preset="card" title="🌡️ 记录体温" style="max-width:400px;width:92vw;" :mask-closable="true" @after-leave="resetTempForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="tempForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-group"><label>体温 (°C)</label><n-input-number v-model:value="tempForm.value" :min="35" :max="42" :step="0.1" placeholder="36.5" style="width:100%" /></div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="tempForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showTempModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveTemp">保存</n-button></template>
    </n-modal>

    <!-- 睡眠弹窗 -->
    <n-modal v-model:show="showSleepModal" preset="card" title="😴 记录睡眠" style="max-width:420px;width:92vw;" :mask-closable="true" @after-leave="resetSleepForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="sleepForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>入睡时间</label><n-time-picker v-model:formatted-value="sleepForm.bedtime" format="HH:mm" value-format="HH:mm" placeholder="22:00" style="width:100%" /></div>
          <div class="qf-group flex1"><label>起床时间</label><n-time-picker v-model:formatted-value="sleepForm.waketime" format="HH:mm" value-format="HH:mm" placeholder="07:00" style="width:100%" /></div>
        </div>
        <div class="qf-group"><label>睡眠质量</label><n-radio-group v-model:value="sleepForm.quality" size="small"><n-radio-button value="差">差</n-radio-button><n-radio-button value="一般">一般</n-radio-button><n-radio-button value="好">好</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="sleepForm.note" placeholder="如：起夜几次、做梦等" /></div>
      </div>
      <template #action><n-button @click="showSleepModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveSleep">保存</n-button></template>
    </n-modal>

    <!-- 饮水弹窗 -->
    <n-modal v-model:show="showWaterModal" preset="card" title="💧 记录饮水" style="max-width:400px;width:92vw;" :mask-closable="true" @after-leave="resetWaterForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="waterForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-group"><label>饮水量 (ml)</label><n-input-number v-model:value="waterForm.value" :min="0" :max="5000" :step="50" placeholder="今日总饮水量" style="width:100%" /></div>
        <div class="form-hint-text">💡 建议孕期每日饮水 1700-2300ml</div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="waterForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showWaterModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveWater">保存</n-button></template>
    </n-modal>

    <!-- 饮食弹窗 -->
    <n-modal v-model:show="showDietModal" preset="card" title="🍎 记录饮食" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetDietForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="dietForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-group"><label>餐次</label><n-radio-group v-model:value="dietForm.meal" size="small"><n-radio-button value="早餐">早餐</n-radio-button><n-radio-button value="午餐">午餐</n-radio-button><n-radio-button value="晚餐">晚餐</n-radio-button><n-radio-button value="加餐">加餐</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>饮食内容</label><n-input v-model:value="dietForm.content" type="textarea" :rows="3" placeholder="记录吃了什么..." /></div>
      </div>
      <template #action><n-button @click="showDietModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveDiet">保存</n-button></template>
    </n-modal>

    <!-- 运动弹窗 -->
    <n-modal v-model:show="showExerciseModal" preset="card" title="🏃 记录运动" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetExerciseForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="exerciseForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>运动类型</label><n-select v-model:value="exerciseForm.type" :options="exerciseTypeOptions" placeholder="选择运动类型" style="width:100%" /></div>
          <div class="qf-group flex1"><label>时长(分钟)</label><n-input-number v-model:value="exerciseForm.duration" :min="0" :max="300" :step="5" placeholder="分钟" style="width:100%" /></div>
        </div>
        <div class="qf-group"><label>强度感受</label><n-radio-group v-model:value="exerciseForm.intensity" size="small"><n-radio-button value="轻松">轻松</n-radio-button><n-radio-button value="中等">中等</n-radio-button><n-radio-button value="较累">较累</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="exerciseForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showExerciseModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveExercise">保存</n-button></template>
    </n-modal>

    <!-- 胎动弹窗 -->
    <n-modal v-model:show="showFmModal" preset="card" title="🦶 记录胎动" style="max-width:400px;width:92vw;" :mask-closable="true" @after-leave="resetFmForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="fmForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>胎动次数</label><n-input-number v-model:value="fmForm.count" :min="0" :max="200" placeholder="次数" style="width:100%" /></div>
          <div class="qf-group flex1"><label>用时(分钟)</label><n-input-number v-model:value="fmForm.duration" :min="0" :max="180" :step="5" placeholder="分钟" style="width:100%" /></div>
        </div>
        <div class="form-hint-text">💡 正常胎动：每小时≥3次，每天累计10次以上</div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="fmForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showFmModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveFm">保存</n-button></template>
    </n-modal>

    <!-- 宫缩弹窗 -->
    <n-modal v-model:show="showContrModal" preset="card" title="⏱️ 记录宫缩" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetContrForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="contrForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>持续时间(秒)</label><n-input-number v-model:value="contrForm.duration" :min="0" :max="300" placeholder="秒" style="width:100%" /></div>
          <div class="qf-group flex1"><label>间隔时间(分钟)</label><n-input-number v-model:value="contrForm.interval" :min="0" :max="60" :step="0.5" placeholder="分钟" style="width:100%" /></div>
        </div>
        <div class="qf-group"><label>疼痛程度</label><n-radio-group v-model:value="contrForm.pain" size="small"><n-radio-button value="无感">无感</n-radio-button><n-radio-button value="轻微">轻微</n-radio-button><n-radio-button value="明显">明显</n-radio-button><n-radio-button value="剧烈">剧烈</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="contrForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showContrModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveContr">保存</n-button></template>
    </n-modal>

    <!-- 计划弹窗 -->
    <n-modal v-model:show="showPlanModal" preset="card" title="📌 记录计划" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetPlanForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="planForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-group"><label>计划内容</label><n-input v-model:value="planForm.text" type="textarea" :rows="3" placeholder="今天计划做什么..." /></div>
      </div>
      <template #action><n-button @click="showPlanModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="savePlan">保存</n-button></template>
    </n-modal>

    <!-- 爱爱弹窗 -->
    <n-modal v-model:show="showIntimacyModal" preset="card" title="💑 记录爱爱" style="max-width:420px;width:94vw;" :mask-closable="true" @after-leave="resetIntimacyForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="intimacyForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-group"><label>次数</label><n-input-number v-model:value="intimacyForm.count" :min="0" :max="10" placeholder="次数" style="width:100%" /></div>
        <div class="qf-group"><label>是否有避孕措施</label><n-radio-group v-model:value="intimacyForm.hasProtection" size="small"><n-radio-button value="yes">有措施</n-radio-button><n-radio-button value="no">无措施</n-radio-button></n-radio-group></div>
        <div class="qf-group" v-if="intimacyForm.hasProtection === 'yes'"><label>措施类型</label><n-radio-group v-model:value="intimacyForm.protectionType" size="small"><n-radio-button value="condom">避孕套</n-radio-button><n-radio-button value="pill">口服避孕药</n-radio-button><n-radio-button value="other">其他</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="intimacyForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showIntimacyModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveIntimacy">保存</n-button></template>
    </n-modal>

    <!-- HCG 专业记录弹窗 -->
    <n-modal v-model:show="showHcgModal" preset="card" title="🧬 HCG 记录" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetHcgForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="hcgForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-group"><label>HCG 值 (mIU/mL)</label><n-input-number v-model:value="hcgForm.value" :min="0" :max="1000000" :step="100" placeholder="如：50000" style="width:100%" /></div>
        <div class="qf-group"><label>孕周（可选，用于参考范围）</label><n-input-number v-model:value="hcgForm.weeks" :min="3" :max="15" :step="1" placeholder="如：6" style="width:100%" /></div>
        <div class="form-hint-text">💡 孕3-4周: 50-500 | 孕4-5周: 100-5000 | 孕5-6周: 1000-50000 | 孕6-8周达峰值后逐渐下降</div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="hcgForm.note" placeholder="如：翻倍情况、医生建议等" /></div>
      </div>
      <template #action><n-button @click="showHcgModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveHcg">保存</n-button></template>
    </n-modal>

    <!-- 尿酸专业记录弹窗 -->
    <n-modal v-model:show="showUaModal" preset="card" title="🧪 尿酸记录" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetUaForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="uaForm.date" type="date" value-format="YYYY-MM-DD" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>尿酸值 (μmol/L)</label><n-input-number v-model:value="uaForm.value" :min="100" :max="800" :step="10" placeholder="如：350" style="width:100%" /></div>
          <div class="qf-group flex1"><label>测量时段</label><n-select v-model:value="uaForm.period" :options="uaPeriodOptions" placeholder="选择" style="width:100%" /></div>
        </div>
        <div class="form-hint-text">💡 正常参考值：非孕期 150-360 μmol/L；孕期可能略高，>420需关注</div>
        <div class="qf-group"><label>备注（可选）</label><n-input v-model:value="uaForm.note" placeholder="如：是否空腹、医生建议等" /></div>
      </div>
      <template #action><n-button @click="showUaModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveUa">保存</n-button></template>
    </n-modal>

    <!-- 编辑/添加通用大弹窗（photo等无独立小弹窗的类型走这里） -->
    <AddRecordDialog :show="showAddDialog" :date="selectedDate" :pregnancy-id="pregnancyStore.currentPregnancy?.id" :default-type="addDialogType" :edit-record="addDialogRecord" @update:show="showAddDialog = $event" @saved="onRecordSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  NButton, NModal, NInput, NInputNumber, NDatePicker,
  NRadioGroup, NRadioButton, NPopover, NTimePicker, NSelect,
  useMessage,
} from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useResize } from '@/composables/useResize'
import { dailyRecordApi } from '@/api/daily-record'
import dayjs from 'dayjs'
import MiniCalendar from '@/components/record/MiniCalendar.vue'
import RecordList from '@/components/record/RecordList.vue'
import AddRecordDialog from '@/components/record/AddRecordDialog.vue'

const pregnancyStore = usePregnancyStore()
const { isMobile } = useResize()
const message = useMessage()

const selectedDate = ref(dayjs().format('YYYY-MM-DD'))
const saving = ref(false)
const currentRecords = ref<any[]>([])

// ====== 弹窗状态 ======
const showAddDialog = ref(false)
const addDialogType = ref<string | undefined>(undefined)
const addDialogRecord = ref<any>(null)

// 各类型小弹窗状态
const showWeightModal = ref(false)
const showBpModal = ref(false)
const showGlucoseModal = ref(false)
const showFhrModal = ref(false)
const showStoolModal = ref(false)
const showMoodModal = ref(false)
const showNoteModal = ref(false)
const showSymptomModal = ref(false)
const showSupplementModal = ref(false)
const showHabitModal = ref(false)
const showTempModal = ref(false)
const showSleepModal = ref(false)
const showWaterModal = ref(false)
const showDietModal = ref(false)
const showExerciseModal = ref(false)
const showFmModal = ref(false)
const showContrModal = ref(false)
const showPlanModal = ref(false)
const showIntimacyModal = ref(false)
const showHcgModal = ref(false)
const showUaModal = ref(false)

// ====== 表单数据 ======
const defaultDate = () => selectedDate.value || dayjs().format('YYYY-MM-DD')

// 体重
const weightForm = ref({ date: '', value: null as number | null, note: '' })
// 血压
const bpForm = ref({ date: '', systolic: null as number | null, diastolic: null as number | null, note: '' })
// 血糖
const glucoseForm = ref({ date: '', period: 'fasting' as 'fasting' | '1h' | '2h', value: null as number | null, note: '' })
// 胎心
const fhrForm = ref({ date: '', value: null as number | null, note: '' })
// 便便
const stoolForm = ref({ date: '', count: null as number | null, consistency: 'normal' as 'hard' | 'normal' | 'soft' | 'diarrhea', note: '' })
// 心情
const moodOptions = [
  { value: 1, emoji: '😢', label: '很差' },
  { value: 2, emoji: '😔', label: '不好' },
  { value: 3, emoji: '😐', label: '一般' },
  { value: 4, emoji: '😊', label: '不错' },
  { value: 5, emoji: '😄', label: '很好' },
]
const moodForm = ref({ date: '', value: 3, note: '' })
// 日记
const noteForm = ref({ date: '', content: '' })
// 症状
const symptomOptions = ['恶心', '呕吐', '头痛', '头晕', '水肿', '腰痛', '胃灼热', '便秘', '腹泻', '尿频', '失眠', '焦虑', '乏力', '气短', '心悸', '背痛', '腿抽筋']
const symptomForm = ref({ date: '', items: [] as string[] })
// 补充剂
const supplementOptions = ['叶酸', '铁剂', '钙片', 'DHA', '复合维生素', '维生素D', '维生素B6', '益生菌']
const supplementForm = ref({ date: '', items: [] as string[] })
// 好习惯
const habitForm = ref({ date: '', text: '' })
// 体温
const tempForm = ref({ date: '', value: null as number | null, note: '' })
// 睡眠
const sleepForm = ref({ date: '', bedtime: '' as string, waketime: '' as string, quality: '一般' as '差' | '一般' | '好', note: '' })
// 饮水
const waterForm = ref({ date: '', value: null as number | null, note: '' })
// 饮食
const dietForm = ref({ date: '', meal: '早餐' as '早餐' | '午餐' | '晚餐' | '加餐', content: '' })
// 运动
const exerciseTypeOptions = [
  { label: '散步', value: '散步' }, { label: '瑜伽', value: '瑜伽' }, { label: '游泳', value: '游泳' },
  { label: '孕妇操', value: '孕妇操' }, { label: '骑行', value: '骑行' }, { label: '其他', value: '其他' },
]
const exerciseForm = ref({ date: '', type: '散步', duration: null as number | null, intensity: '轻松' as '轻松' | '中等' | '较累', note: '' })
// 胎动
const fmForm = ref({ date: '', count: null as number | null, duration: null as number | null, note: '' })
// 宫缩
const contrForm = ref({ date: '', duration: null as number | null, interval: null as number | null, pain: '轻微' as '无感' | '轻微' | '明显' | '剧烈', note: '' })
// 计划
const planForm = ref({ date: '', text: '' })
// 爱爱
const intimacyForm = ref({ date: '', count: null as number | null, hasProtection: 'no' as 'yes' | 'no', protectionType: '' as string, note: '' })
// HCG
const hcgForm = ref({ date: '', value: null as number | null, weeks: null as number | null, note: '' })
// 尿酸
const uaPeriodOptions = [
  { label: '空腹', value: '空腹' }, { label: '餐后', value: '餐后' },
  { label: '随机', value: '随机' },
]
const uaForm = ref({ date: '', value: null as number | null, period: '空腹', note: '' })

// ====== 类型菜单定义 ======
const quickTypes = [
  { value: 'weight', icon: '⚖️', label: '体重' },
  { value: 'blood_pressure', icon: '🩺', label: '血压' },
  { value: 'blood_glucose', icon: '🩸', label: '血糖' },
  { value: 'fetal_heart_rate', icon: '❤️', label: '胎心' },
  { value: 'stool', icon: '💩', label: '便便' },
  { value: 'mood', icon: '😊', label: '心情' },
  { value: 'symptoms', icon: '📋', label: '症状' },
  { value: 'supplement', icon: '💊', label: '补充剂' },
  { value: 'habit', icon: '✅', label: '好习惯' },
  { value: 'temperature', icon: '🌡️', label: '体温' },
  { value: 'sleep', icon: '😴', label: '睡眠' },
  { value: 'water', icon: '💧', label: '饮水' },
  { value: 'diet', icon: '🍎', label: '饮食' },
  { value: 'exercise', icon: '🏃', label: '运动' },
  { value: 'fetal_movement', icon: '🦶', label: '胎动' },
  { value: 'contraction', icon: '⏱️', label: '宫缩' },
  { value: 'plan', icon: '📌', label: '计划' },
  { value: 'intimacy', icon: '💑', label: '爱爱' },
]

// ====== 预览卡片数据 ======
interface PreviewItem {
  type: string
  icon: string
  label: string
  value: string
  color: string
}

const previewItems = computed<PreviewItem[]>(() => {
  const r = currentRecords.value.length > 0 ? currentRecords.value[0] : {}
  const items: PreviewItem[] = []

  if (r.weight) items.push({ type: 'weight', icon: '⚖️', label: '体重', value: r.weight + ' kg', color: '#a78bfa' })
  if (r.blood_pressure_systolic || r.blood_pressure_diastolic) {
    items.push({
      type: 'blood_pressure', icon: '🩺', label: '血压',
      value: (r.blood_pressure_systolic || '--') + '/' + (r.blood_pressure_diastolic || '--'),
      color: '#ef4444',
    })
  }
  if (r.blood_glucose_fasting || r.blood_glucose_1h || r.blood_glucose_2h) {
    const parts: string[] = []
    if (r.blood_glucose_fasting) parts.push('空腹' + r.blood_glucose_fasting)
    if (r.blood_glucose_1h) parts.push('1h' + r.blood_glucose_1h)
    if (r.blood_glucose_2h) parts.push('2h' + r.blood_glucose_2h)
    items.push({ type: 'blood_glucose', icon: '🩸', label: '血糖', value: parts.join(' ') + ' mmol/L', color: '#f59e0b' })
  }
  if (r.fetal_heart_rate) items.push({ type: 'fetal_heart_rate', icon: '❤️', label: '胎心', value: r.fetal_heart_rate + ' bpm', color: '#f472b6' })
  if (r.mood) {
    const icons = ['', '😢', '😔', '😐', '😊', '😄']
    items.push({ type: 'mood', icon: '😊', label: '心情', value: (icons[r.mood] || '😐') + (r.mood_note ? ' ' + r.mood_note.slice(0, 8) : ''), color: '#f87171' })
  }

  return items.slice(0, 6) // 最多显示6个预览项
})

// ====== 数据加载 ======
async function fetchRecords() {
  if (!pregnancyStore.currentPregnancy?.id) return
  try {
    const res: any = await dailyRecordApi.getByDate(
      pregnancyStore.currentPregnancy.id,
      selectedDate.value
    )
    if (res.code === 0) {
      currentRecords.value = res.data ? [res.data] : []
    }
  } catch { /* ignore errors silently */ }
}

watch([() => selectedDate.value, () => pregnancyStore.currentPregnancy?.id], ([date, pid]) => {
  if (date && pid) fetchRecords()
}, { immediate: true })

onMounted(() => window.addEventListener('record-added', fetchRecords))
onUnmounted(() => window.removeEventListener('record-added', fetchRecords))

// ====== 事件处理 ======
function onDateSelect(date: string) {
  selectedDate.value = date
}

function onRecordSaved() {
  window.dispatchEvent(new CustomEvent('record-added'))
}

function openAddDialog() {
  addDialogType.value = undefined
  addDialogRecord.value = null
  showAddDialog.value = true
}

function onEditRecord(payload: { type: string; record: any }) {
  // 编辑模式使用原有的大弹窗
  addDialogType.value = payload.type
  addDialogRecord.value = payload.record
  showAddDialog.value = true
}

// ====== 快捷添加：根据类型打开对应小弹窗 ======
function openQuickAdd(type: string) {
  const d = defaultDate()
  switch (type) {
    case 'weight': resetWeightForm(); weightForm.value.date = d; showWeightModal.value = true; break
    case 'blood_pressure': resetBpForm(); bpForm.value.date = d; showBpModal.value = true; break
    case 'blood_glucose': resetGlucoseForm(); glucoseForm.value.date = d; showGlucoseModal.value = true; break
    case 'fetal_heart_rate': resetFhrForm(); fhrForm.value.date = d; showFhrModal.value = true; break
    case 'stool': resetStoolForm(); stoolForm.value.date = d; showStoolModal.value = true; break
    case 'mood': resetMoodForm(); moodForm.value.date = d; showMoodModal.value = true; break
    case 'symptoms': resetSymptomForm(); symptomForm.value.date = d; showSymptomModal.value = true; break
    case 'supplement': resetSupplementForm(); supplementForm.value.date = d; showSupplementModal.value = true; break
    case 'habit': resetHabitForm(); habitForm.value.date = d; showHabitModal.value = true; break
    case 'temperature': resetTempForm(); tempForm.value.date = d; showTempModal.value = true; break
    case 'sleep': resetSleepForm(); sleepForm.value.date = d; showSleepModal.value = true; break
    case 'water': resetWaterForm(); waterForm.value.date = d; showWaterModal.value = true; break
    case 'diet': resetDietForm(); dietForm.value.date = d; showDietModal.value = true; break
    case 'exercise': resetExerciseForm(); exerciseForm.value.date = d; showExerciseModal.value = true; break
    case 'fetal_movement': resetFmForm(); fmForm.value.date = d; showFmModal.value = true; break
    case 'contraction': resetContrForm(); contrForm.value.date = d; showContrModal.value = true; break
    case 'plan': resetPlanForm(); planForm.value.date = d; showPlanModal.value = true; break
    case 'intimacy': resetIntimacyForm(); intimacyForm.value.date = d; showIntimacyModal.value = true; break
    case 'hcg': resetHcgForm(); hcgForm.value.date = d; showHcgModal.value = true; break
    case 'uric_acid': resetUaForm(); uaForm.value.date = d; showUaModal.value = true; break
  default: message.warning('未知类型: ' + type)
  }
}

// ====== 通用保存辅助 ======
async function doUpsert(data: any) {
  if (!pregnancyStore.currentPregnancy?.id) {
    message.error('缺少孕期信息')
    return false
  }
  const fields = Object.keys(data).filter(k => !['pregnancy_id', 'record_date'].includes(k))
  console.log('[Record] doUpsert:', { date: data.record_date, fields })
  saving.value = true
  try {
    data.pregnancy_id = pregnancyStore.currentPregnancy.id
    data.record_date = data.record_date || dayjs().format('YYYY-MM-DD')
    const res: any = await dailyRecordApi.upsert(data)
    console.log('[Record] doUpsert 响应:', res.code, res.message || 'OK')
    if (res.code === 0) {
      message.success('已保存')
      onRecordSaved()
      return true
    } else {
      message.error(res.message || '保存失败')
      return false
    }
  } catch (e: any) {
    console.error('[Record] doUpsert 失败:', e)
    // 显示具体错误信息
    const errMsg = e?.message || e?.response?.data?.message || '网络异常，请检查网络连接'
    message.error(errMsg)
    return false
  } finally {
    saving.value = false
  }
}

// ====== 各类型保存函数 ======
async function saveWeight() {
  if (!weightForm.value.value) { message.warning('请输入体重'); return }
  const ok = await doUpsert({
    record_date: weightForm.value.date,
    weight: weightForm.value.value,
    note: weightForm.value.note || undefined,
  })
  if (ok) showWeightModal.value = false
}

async function saveBp() {
  if (!bpForm.value.systolic || !bpForm.value.diastolic) { message.warning('请输入血压值'); return }
  const ok = await doUpsert({
    record_date: bpForm.value.date,
    blood_pressure_systolic: String(bpForm.value.systolic),
    blood_pressure_diastolic: String(bpForm.value.diastolic),
    note: bpForm.value.note || undefined,
  })
  if (ok) showBpModal.value = false
}

async function saveGlucose() {
  if (!glucoseForm.value.value) { message.warning('请输入血糖值'); return }
  const data: any = {
    record_date: glucoseForm.value.date,
    note: glucoseForm.value.note || undefined,
  }
  if (glucoseForm.value.period === 'fasting') data.blood_glucose_fasting = glucoseForm.value.value
  else if (glucoseForm.value.period === '1h') data.blood_glucose_1h = glucoseForm.value.value
  else data.blood_glucose_2h = glucoseForm.value.value
  const ok = await doUpsert(data)
  if (ok) showGlucoseModal.value = false
}

async function saveFhr() {
  if (!fhrForm.value.value) { message.warning('请输入胎心率'); return }
  const ok = await doUpsert({
    record_date: fhrForm.value.date,
    fetal_heart_rate: fhrForm.value.value,
    note: fhrForm.value.note || undefined,
  })
  if (ok) showFhrModal.value = false
}

async function saveStool() {
  if (stoolForm.value.count == null) { message.warning('请输入次数'); return }
  const ok = await doUpsert({
    record_date: stoolForm.value.date,
    stool_record: JSON.stringify({
      count: stoolForm.value.count,
      consistency: stoolForm.value.consistency,
    }),
    note: stoolForm.value.note || undefined,
  })
  if (ok) showStoolModal.value = false
}

async function saveMood() {
  const ok = await doUpsert({
    record_date: moodForm.value.date,
    mood: String(moodForm.value.value),
    mood_note: moodForm.value.note || undefined,
  })
  if (ok) showMoodModal.value = false
}

async function saveNote() {
  if (!noteForm.value.content.trim()) { message.warning('请输入内容'); return }
  const ok = await doUpsert({
    record_date: noteForm.value.date,
    note: noteForm.value.content,
  })
  if (ok) showNoteModal.value = false
}

async function saveSymptom() {
  if (symptomForm.value.items.length === 0) { message.warning('请选择至少一项症状'); return }
  const ok = await doUpsert({
    record_date: symptomForm.value.date,
    symptoms: JSON.stringify(symptomForm.value.items),
  })
  if (ok) showSymptomModal.value = false
}

async function saveSupplement() {
  const ok = await doUpsert({
    record_date: supplementForm.value.date,
    supplement_record: JSON.stringify(supplementForm.value.items.map((name: string) => ({ name }))),
  })
  if (ok) showSupplementModal.value = false
}

async function saveHabit() {
  if (!habitForm.value.text.trim()) { message.warning('请输入内容'); return }
  console.log('[Record] saveHabit:', habitForm.value.text.slice(0, 30))
  const ok = await doUpsert({
    record_date: habitForm.value.date,
    habit_text: habitForm.value.text,
  })
  if (ok) showHabitModal.value = false
}

// ====== 重置表单函数 ======
function resetWeightForm() { weightForm.value = { date: '', value: null, note: '' } }
function resetBpForm() { bpForm.value = { date: '', systolic: null, diastolic: null, note: '' } }
function resetGlucoseForm() { glucoseForm.value = { date: '', period: 'fasting', value: null, note: '' } }
function resetFhrForm() { fhrForm.value = { date: '', value: null, note: '' } }
function resetStoolForm() { stoolForm.value = { date: '', count: null, consistency: 'normal', note: '' } }
function resetMoodForm() { moodForm.value = { date: '', value: 3, note: '' } }
function resetNoteForm() { noteForm.value = { date: '', content: '' } }
function resetSymptomForm() { symptomForm.value = { date: '', items: [] } }
function resetSupplementForm() { supplementForm.value = { date: '', items: [] } }
function resetHabitForm() { habitForm.value = { date: '', text: '' } }
function resetTempForm() { tempForm.value = { date: '', value: null, note: '' } }
function resetSleepForm() { sleepForm.value = { date: '', bedtime: '', waketime: '', quality: '一般', note: '' } }
function resetWaterForm() { waterForm.value = { date: '', value: null, note: '' } }
function resetDietForm() { dietForm.value = { date: '', meal: '早餐', content: '' } }
function resetExerciseForm() { exerciseForm.value = { date: '', type: '散步', duration: null, intensity: '轻松', note: '' } }
function resetFmForm() { fmForm.value = { date: '', count: null, duration: null, note: '' } }
function resetContrForm() { contrForm.value = { date: '', duration: null, interval: null, pain: '轻微', note: '' } }
function resetPlanForm() { planForm.value = { date: '', text: '' } }
function resetIntimacyForm() { intimacyForm.value = { date: '', count: null, hasProtection: 'no', protectionType: '', note: '' } }

// ====== 新增类型保存函数 ======
async function saveTemp() {
  if (!tempForm.value.value) { message.warning('请输入体温'); return }
  const ok = await doUpsert({ record_date: tempForm.value.date, body_temperature: tempForm.value.value, note: tempForm.value.note || undefined })
  if (ok) showTempModal.value = false
}

async function saveSleep() {
  let hours: number | undefined = undefined
  if (sleepForm.value.bedtime && sleepForm.value.waketime) {
    const [bh, bm] = sleepForm.value.bedtime.split(':').map(Number)
    const [wh, wm] = sleepForm.value.waketime.split(':').map(Number)
    let diff = (wh * 60 + wm) - (bh * 60 + bm)
    if (diff < 0) diff += 24 * 60 // 跨天
    hours = Math.round((diff / 60) * 10) / 10 // 保留一位小数
  }
  console.log('[Record] saveSleep:', { bedtime: sleepForm.value.bedtime, waketime: sleepForm.value.waketime, hours, quality: sleepForm.value.quality })
  const ok = await doUpsert({
    record_date: sleepForm.value.date,
    sleep_hours: hours,
    sleep_quality: sleepForm.value.quality || undefined,
    note: sleepForm.value.note || undefined,
  })
  if (ok) showSleepModal.value = false
}

async function saveWater() {
  if (!waterForm.value.value) { message.warning('请输入饮水量'); return }
  const ok = await doUpsert({ record_date: waterForm.value.date, water_intake: waterForm.value.value, note: waterForm.value.note || undefined })
  if (ok) showWaterModal.value = false
}

async function saveDiet() {
  if (!dietForm.value.content.trim()) { message.warning('请输入饮食内容'); return }
  console.log('[Record] saveDiet:', { meal: dietForm.value.meal, content: dietForm.value.content.slice(0, 30) })
  const ok = await doUpsert({ record_date: dietForm.value.date, diet_note: dietForm.value.content })
  if (ok) showDietModal.value = false
}

async function saveExercise() {
  if (!exerciseForm.value.duration) { message.warning('请输入运动时长'); return }
  console.log('[Record] saveExercise:', { type: exerciseForm.value.type, duration: exerciseForm.value.duration })
  const ok = await doUpsert({
    record_date: exerciseForm.value.date,
    exercise_type: exerciseForm.value.type,
    exercise_duration: exerciseForm.value.duration,
    note: exerciseForm.value.note || undefined,
  })
  if (ok) showExerciseModal.value = false
}

async function saveFm() {
  if (!fmForm.value.count) { message.warning('请输入胎动次数'); return }
  console.log('[Record] saveFetalMovement:', { count: fmForm.value.count, duration: fmForm.value.duration })
  const ok = await doUpsert({
    record_date: fmForm.value.date,
    fetal_movement_count: fmForm.value.count,
    fetal_movement_duration: fmForm.value.duration || undefined,
    note: fmForm.value.note || undefined,
  })
  if (ok) showFmModal.value = false
}

async function saveContr() {
  console.log('[Record] saveContraction:', { duration: contrForm.value.duration, interval: contrForm.value.interval, pain: contrForm.value.pain })
  const ok = await doUpsert({
    record_date: contrForm.value.date,
    contraction_duration: contrForm.value.duration || undefined,  // 持续时间(秒)
    contraction_interval: contrForm.value.interval || undefined,   // 间隔时间(分钟)
    contraction_pain: contrForm.value.pain || undefined,           // 疼痛程度
    note: contrForm.value.note || undefined,
  })
  if (ok) showContrModal.value = false
}

async function savePlan() {
  if (!planForm.value.text.trim()) { message.warning('请输入计划内容'); return }
  console.log('[Record] savePlan:', planForm.value.text.slice(0, 30))
  const ok = await doUpsert({ record_date: planForm.value.date, plan_text: planForm.value.text })
  if (ok) showPlanModal.value = false
}

async function saveIntimacy() {
  const ok = await doUpsert({
    record_date: intimacyForm.value.date,
    intimacy_record: JSON.stringify({ count: intimacyForm.value.count, has_protection: intimacyForm.value.hasProtection, protection_type: intimacyForm.value.protectionType }),
    note: intimacyForm.value.note || undefined,
  })
  if (ok) showIntimacyModal.value = false
}

// ====== HCG & 尿酸 ======
function resetHcgForm() { hcgForm.value = { date: '', value: null, weeks: null, note: '' } }
function resetUaForm() { uaForm.value = { date: '', value: null, period: '空腹', note: '' } }

async function saveHcg() {
  if (!hcgForm.value.value) { message.warning('请输入HCG值'); return }
  console.log('[Record] saveHCG:', { value: hcgForm.value.value, weeks: hcgForm.value.weeks })
  const ok = await doUpsert({
    record_date: hcgForm.value.date,
    hcg_value: hcgForm.value.value,
    hcg_weeks: hcgForm.value.weeks || undefined,
    note: hcgForm.value.note || undefined,
  })
  if (ok) showHcgModal.value = false
}

async function saveUa() {
  if (!uaForm.value.value) { message.warning('请输入尿酸值'); return }
  console.log('[Record] saveUricAcid:', { value: uaForm.value.value, period: uaForm.value.period })
  const ok = await doUpsert({
    record_date: uaForm.value.date,
    uric_acid: uaForm.value.value,
    uric_acid_period: uaForm.value.period || undefined,
    note: uaForm.value.note || undefined,
  })
  if (ok) showUaModal.value = false
}

// ====== 多选切换辅助 ======
function toggleSymptomItem(s: string) {
  const idx = symptomForm.value.items.indexOf(s)
  if (idx >= 0) symptomForm.value.items.splice(idx, 1)
  else symptomForm.value.items.push(s)
}
function toggleSuppItem(s: string) {
  const idx = supplementForm.value.items.indexOf(s)
  if (idx >= 0) supplementForm.value.items.splice(idx, 1)
  else supplementForm.value.items.push(s)
}
</script>

<style scoped>
.record-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* ====== 1. 日历区域：固定高度不随列表滚动 ====== */
.calendar-section {
  flex-shrink: 0;
  background: var(--bg-card, #fff);
  border-radius: 14px;
  border: 1px solid var(--border-color, #e2e8f0);
  box-shadow: var(--shadow-sm);
  padding: 4px;
}

/* ====== 2. 操作栏 ====== */
.action-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 4px 8px;
  flex-shrink: 0;
}

.date-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-color, #1e293b);
  margin: 0;
}

/* ====== 3. 预览卡片区域 ====== */
.preview-section {
  flex-shrink: 0;
  padding: 4px 0 10px;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.preview-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  background: var(--bg-card, #fff);
  border-radius: 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  box-shadow: var(--shadow-sm);
  transition: transform 0.15s ease;
}

.preview-card:hover {
  transform: translateY(-1px);
}

.preview-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.preview-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--preview-color, var(--primary-color, #c44680));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-label {
  font-size: 11px;
  color: var(--text-hint, #94a3b8);
  flex-shrink: 0;
}

/* ====== 4. 列表区域：独立滚动 ====== */
.list-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 2px;
}

/* ====== 类型弹出菜单 ====== */
.type-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}

.type-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s ease;
  user-select: none;
  font-size: 14px;
  color: var(--text-color, #1e293b);
}

.type-menu-item:hover {
  background: rgba(232, 160, 191, 0.08);
}

.type-menu-item:active {
  background: rgba(232, 160, 191, 0.15);
}

.type-menu-icon {
  font-size: 18px;
  line-height: 1;
  width: 24px;
  text-align: center;
  flex-shrink: 0;
}

.type-menu-label {
  font-weight: 500;
}

.type-menu-divider {
  height: 1px;
  background: var(--border-color, #e2e8f0);
  margin: 4px 10px;
}

/* ====== 小弹窗表单通用样式 ====== */
.quick-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.qf-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qf-group label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary, #64748b);
}

.qf-row {
  display: flex;
  gap: 12px;
}

.flex1 {
  flex: 1;
  min-width: 0;
}

.form-hint-text {
  font-size: 12px;
  color: var(--text-hint, #94a3b8);
  margin-top: -6px;
}

/* 心情选择按钮行 */
.mood-btn-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mood-pick-btn {
  padding: 6px 14px;
  border: 1.5px solid var(--border-color, #e2e8f0);
  border-radius: 20px;
  background: transparent;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--text-color, #1e293b);
}

.mood-pick-btn:hover {
  border-color: var(--primary-color, #c44680);
}

.mood-pick-btn.active {
  background: var(--primary-color, #c44680);
  color: #fff;
  border-color: var(--primary-color, #c44680);
}

/* 症状标签网格 */
.symptom-tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.symptom-chip {
  padding: 5px 13px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  color: var(--text-color, #1e293b);
}

.symptom-chip:hover {
  border-color: #f06292;
}

.symptom-chip.selected {
  background: #f06292;
  color: #fff;
  border-color: #f06292;
}

/* 补充剂标签网格 */
.supp-tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.supp-chip {
  padding: 5px 13px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 16px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  color: var(--text-color, #1e293b);
}

.supp-chip:hover {
  border-color: #06b6d4;
}

.supp-chip.selected {
  background: #06b6d4;
  color: #fff;
  border-color: #06b6d4;
}

/* ====== 手机端适配 ====== */
@media (max-width: 768px) {
  .record-view {
    height: 100vh;
    height: 100dvh;
    min-height: 0;
    overflow: hidden;
  }

  /* 日历固定不滚动，紧凑化 */
  .calendar-section {
    flex-shrink: 0;
    border-radius: 0;
    border-left: none;
    border-right: none;
    border-top: none;
    padding: 2px;
  }

  /* 操作栏固定在日历下方 */
  .action-bar {
    flex-shrink: 0;
    background: var(--bg-color, #f8f9fa);
    padding: 8px 4px 6px;
  }

  .date-title {
    font-size: 15px;
  }

  /* 预览卡片改为横向滚动或2列 */
  .preview-section {
    flex-shrink: 0;
    padding: 2px 0 6px;
  }

  .preview-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 5px;
  }

  .preview-card {
    padding: 6px 8px;
  }

  .preview-icon {
    font-size: 15px;
  }

  .preview-value {
    font-size: 12px;
  }

  .preview-label {
    font-size: 10px;
  }

  /* 列表区域独立滚动 */
  .list-section {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .type-menu-item {
    padding: 11px 16px;
    font-size: 15px;
  }

  .type-menu-icon {
    font-size: 20px;
  }

  .mood-pick-btn {
    padding: 8px 16px;
    font-size: 14px;
  }

  .symptom-chip,
  .supp-chip {
    padding: 6px 14px;
    font-size: 14px;
  }
}

/* ====== 超小屏幕适配 (< 375px) ====== */
@media (max-width: 374px) {
  .preview-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 5px;
  }

  .preview-card {
    padding: 6px 8px;
  }

  .preview-value {
    font-size: 12px;
  }

  .action-bar {
    padding: 8px 2px 6px;
  }
}
</style>
