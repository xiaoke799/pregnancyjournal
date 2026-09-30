<template>
  <div class="record-view" :class="{ 'is-mobile': isMobile }">
    <!-- ====== 1. 日历区域（固定不滚动）====== -->
    <div class="calendar-section">
      <MiniCalendar @select="onDateSelect" />
    </div>

    <!-- ====== 2. 操作栏（+ 添加按钮 / 日期标题 / 子级Tab切换）====== -->
    <div class="action-bar">
      <h3 class="date-title">{{ selectedDate }}</h3>
      <div class="sub-tab-bar">
        <button class="sub-tab-btn" :class="{ active: activeSubTab === 'record' }" @click="activeSubTab = 'record'">记录</button>
        <button class="sub-tab-btn" :class="{ active: activeSubTab === 'stats' }" @click="activeSubTab = 'stats'">统计</button>
      </div>
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
            <span class="type-menu-icon"><AppIcon :name="t.icon" :size="18" /></span>
            <span class="type-menu-label">{{ t.label }}</span>
          </div>
        </div>
      </n-popover>
    </div>

    <!-- ====== 记录模式内容 ====== -->
    <template v-if="activeSubTab === 'record'">
    <!-- ====== 3. 今日数据预览卡片 ====== -->
    <div v-if="previewItems.length > 0" class="preview-section">
      <div class="preview-grid">
        <div
          v-for="item in previewItems"
          :key="item.type"
          class="preview-card"
          :style="{ '--preview-color': item.color }"
        >
          <span class="preview-icon"><AppIcon :name="item.icon" :size="18" /></span>
          <span class="preview-value">{{ item.value }}</span>
          <span class="preview-label">{{ item.label }}</span>
        </div>
      </div>
    </div>

    <!-- ====== 4. 记录分类列表（独立滚动区域）====== -->
    <div class="list-section">
      <!-- 每次会话的明细（计数器 / 计时器产生的原始记录）**不在这里铺开**——
           用户反馈「上面放多了、显示不好操作」。改为点下方「胎动」「宫缩」条目
           弹出明细框（SessionDetailDialog），页面只留主要数据 -->
      <RecordList
        :date="selectedDate"
        :records="currentRecords"
        :plans="todayPlans"
        @edit="onEditRecord"
        @add-type="openQuickAdd"
        @detail="openSessionDetail"
      />
    </div>
    </template>

    <!-- ====== 统计模式内容 ====== -->
    <StatsPanel v-if="activeSubTab === 'stats'" />

    <!-- ====== 各类型独立小弹窗 ====== -->

    <!-- 体重弹窗 -->
    <n-modal
      v-model:show="showWeightModal"
      preset="card"
      title="记录体重"
      style="max-width: 400px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetWeightForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="weightForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>体重 (kg)</label>
          <n-input-number v-model:value="weightForm.value" :min="30" :max="200" :step="0.1" placeholder="请输入体重" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>当天备注（可选）</label>
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
      title="记录血压"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetBpForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="bpForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
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
          <label>当天备注（可选）</label>
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
      title="记录血糖"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetGlucoseForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="glucoseForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
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
          <label>当天备注（可选）</label>
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
      title="测胎心"
      style="max-width: 400px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetFhrForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="fhrForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>胎心率 (bpm)</label>
          <n-input-number v-model:value="fhrForm.value" :min="60" :max="200" placeholder="110-160" style="width: 100%" />
        </div>
        <div class="form-hint-text">正常范围：110-160 bpm</div>
        <div class="qf-group">
          <label>当天备注（可选）</label>
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
      title="记录便便"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetStoolForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="stoolForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
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
          <label>当天备注（可选）</label>
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
      title="记录心情"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetMoodForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="moodForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
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

    <!-- 症状弹窗 -->
    <n-modal
      v-model:show="showSymptomModal"
      preset="card"
      title="记录症状"
      style="max-width: 440px; width: 94vw;"
      :mask-closable="true"
      @after-leave="resetSymptomForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="symptomForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
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
      title="临时补记 · 营养补充"
      style="max-width: 440px; width: 94vw;"
      :mask-closable="true"
      @after-leave="resetSupplementForm"
    >
      <div class="quick-form">
        <!-- 长期按医嘱吃的走「用药/补充」计划页：那里到点会提醒、吃完打卡，
             打完卡当天就不再推；这里只负责偶尔的临时补记。 -->
        <div class="qf-dose-hint">
          长期按医嘱吃的（如叶酸、钙片）请到<router-link to="/dose-plan">「用药/补充」</router-link>建计划 —— 到点自动提醒、吃完打卡。这里只做临时补记。
        </div>
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="supplementForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
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
      title="好习惯打卡"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetHabitForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="habitForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
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

    <!-- 用药弹窗 -->
    <!-- ⚠️ 这个入口曾经整个丢失：`medication` 有列、有大弹窗保存分支、有导出标签，
         但顶部「＋」菜单、记录列表、openQuickAdd 三处都没有它 —— 于是用户根本没法记录用药。
         成因是「＋」从「通用大弹窗」改成「每类专属小弹窗」时漏掉了这一类。 -->
    <n-modal
      v-model:show="showMedicationModal"
      preset="card"
      title="临时补记 · 用药"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetMedicationForm"
    >
      <div class="quick-form">
        <div class="qf-dose-hint">
          长期按医嘱吃的（如优甲乐）请到<router-link to="/dose-plan">「用药/补充」</router-link>建计划 —— 到点自动提醒、吃完打卡。这里只做临时补记。
        </div>
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="medForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>药品名称</label>
          <n-input v-model:value="medForm.name" placeholder="如：叶酸片、对乙酰氨基酚" />
        </div>
        <div class="qf-group">
          <label>剂量</label>
          <n-input v-model:value="medForm.dosage" placeholder="如：500mg、1 片" />
        </div>
        <div class="qf-group">
          <label>服用频次</label>
          <n-input v-model:value="medForm.frequency" placeholder="如：一日三次、按需" />
        </div>
        <div class="form-hint-text">孕期用药前请先咨询医生或药师；已确诊疾病需长期服药的，不要自行停药或减量</div>
        <div class="qf-group">
          <label>当天备注（可选）</label>
          <n-input v-model:value="medForm.note" placeholder="如：医生开的、饭后服用" />
        </div>
      </div>
      <template #action>
        <n-button @click="showMedicationModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveMedication">保存</n-button>
      </template>
    </n-modal>

    <!-- 体温弹窗 -->
    <n-modal v-model:show="showTempModal" preset="card" title="记录体温" style="max-width:400px;width:92vw;" :mask-closable="true" @after-leave="resetTempForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="tempForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-group"><label>体温 (°C)</label><n-input-number v-model:value="tempForm.value" :min="35" :max="42" :step="0.1" placeholder="36.5" style="width:100%" /></div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="tempForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showTempModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveTemp">保存</n-button></template>
    </n-modal>

    <!-- 睡眠弹窗 -->
    <n-modal v-model:show="showSleepModal" preset="card" title="记录睡眠" style="max-width:420px;width:92vw;" :mask-closable="true" @after-leave="resetSleepForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="sleepForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>入睡时间</label><n-select v-model:value="sleepForm.bedtime" :options="timeOptions" placeholder="选择" filterable style="width:100%" /></div>
          <div class="qf-group flex1"><label>起床时间</label><n-select v-model:value="sleepForm.waketime" :options="timeOptions" placeholder="选择" filterable style="width:100%" /></div>
        </div>
        <div class="qf-group"><label>睡眠质量</label><n-radio-group v-model:value="sleepForm.quality" size="small"><n-radio-button v-for="q in sleepQualityOptions" :key="q.value" :value="q.value">{{ q.label }}</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="sleepForm.note" placeholder="如：起夜几次、做梦等" /></div>
      </div>
      <template #action><n-button @click="showSleepModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveSleep">保存</n-button></template>
    </n-modal>

    <!-- 饮水弹窗 -->
    <n-modal v-model:show="showWaterModal" preset="card" title="记录饮水" style="max-width:400px;width:92vw;" :mask-closable="true" @after-leave="resetWaterForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="waterForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-group"><label>饮水量 (ml)</label><n-input-number v-model:value="waterForm.value" :min="0" :max="5000" :step="50" placeholder="今日总饮水量" style="width:100%" /></div>
        <div class="form-hint-text">建议孕期每日饮水 1700-2300ml</div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="waterForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showWaterModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveWater">保存</n-button></template>
    </n-modal>

    <!-- 饮食弹窗 -->
    <n-modal v-model:show="showDietModal" preset="card" title="记录饮食" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetDietForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="dietForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-group"><label>餐次</label><n-radio-group v-model:value="dietForm.meal" size="small"><n-radio-button value="早餐">早餐</n-radio-button><n-radio-button value="午餐">午餐</n-radio-button><n-radio-button value="晚餐">晚餐</n-radio-button><n-radio-button value="加餐">加餐</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>饮食内容</label><n-input v-model:value="dietForm.content" type="textarea" :rows="3" placeholder="记录吃了什么..." /></div>
      </div>
      <template #action><n-button @click="showDietModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveDiet">保存</n-button></template>
    </n-modal>

    <!-- 运动弹窗 -->
    <n-modal v-model:show="showExerciseModal" preset="card" title="记录运动" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetExerciseForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="exerciseForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>运动类型</label><n-select v-model:value="exerciseForm.type" :options="exerciseTypeOptions" placeholder="选择运动类型" style="width:100%" /></div>
          <div class="qf-group flex1"><label>时长(分钟)</label><n-input-number v-model:value="exerciseForm.duration" :min="0" :max="300" :step="5" placeholder="分钟" style="width:100%" /></div>
        </div>
        <div class="qf-group"><label>强度感受（可选）</label><n-radio-group v-model:value="exerciseForm.intensity" size="small"><n-radio-button v-for="o in exerciseIntensityOptions" :key="o.value" :value="o.value">{{ o.label }}</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="exerciseForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showExerciseModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveExercise">保存</n-button></template>
    </n-modal>

    <!-- 胎动 / 宫缩小弹窗：已抽成共享组件（首页也要用同一份，避免两处实现漂移） -->
    <QuickLogDialog
      v-model:show="showFmModal"
      type="fetal_movement"
      :pregnancy-id="pregnancyStore.currentPregnancy?.id"
      :date="selectedDate"
      :note="quickLogNote"
    />
    <QuickLogDialog
      v-model:show="showContrModal"
      type="contraction"
      :pregnancy-id="pregnancyStore.currentPregnancy?.id"
      :date="selectedDate"
      :note="quickLogNote"
    />

    <!-- 点「胎动」「宫缩」条目 → 看每次会话明细（替代此前页面上铺开的明细块） -->
    <SessionDetailDialog
      v-model:show="showSessionDetail"
      :type="sessionDetailType"
      :pregnancy-id="pregnancyStore.currentPregnancy?.id"
      :date="selectedDate"
    />

    <!-- 计划弹窗 -->
    <n-modal v-model:show="showPlanModal" preset="card" title="添加计划" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetPlanForm">
      <div class="quick-form">
        <div class="qf-group"><label>计划日期</label><n-date-picker v-model:formatted-value="planForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-group"><label>几点执行（可选）</label><n-time-picker v-model:formatted-value="planForm.time" format="HH:mm" placeholder="不填则只按日期提醒" style="width:100%" /></div>
        <div class="qf-group"><label>计划内容</label><n-input v-model:value="planForm.text" type="textarea" :rows="3" placeholder="例如：做四维彩超 / 下午去散步" /></div>
        <div class="form-hint-text">日期是今天 ⇒ 归入「今日计划」；之后 ⇒ 归入「孕期计划」。到点会按你配置的渠道推送提醒。</div>
      </div>
      <template #action><n-button @click="showPlanModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="savePlan">保存</n-button></template>
    </n-modal>

    <!-- 爱爱弹窗 -->
    <n-modal v-model:show="showIntimacyModal" preset="card" title="记录爱爱" style="max-width:420px;width:94vw;" :mask-closable="true" @after-leave="resetIntimacyForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="intimacyForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-group"><label>次数</label><n-input-number v-model:value="intimacyForm.count" :min="0" :max="10" placeholder="次数" style="width:100%" /></div>
        <div class="qf-group"><label>是否有避孕措施</label><n-radio-group v-model:value="intimacyForm.hasProtection" size="small"><n-radio-button value="yes">有措施</n-radio-button><n-radio-button value="no">无措施</n-radio-button></n-radio-group></div>
        <div class="qf-group" v-if="intimacyForm.hasProtection === 'yes'"><label>措施类型</label><n-radio-group v-model:value="intimacyForm.protectionType" size="small"><n-radio-button value="condom">避孕套</n-radio-button><n-radio-button value="pill">口服避孕药</n-radio-button><n-radio-button value="other">其他</n-radio-button></n-radio-group></div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="intimacyForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showIntimacyModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveIntimacy">保存</n-button></template>
    </n-modal>

    <!-- HCG 专业记录弹窗 -->
    <n-modal v-model:show="showHcgModal" preset="card" title="HCG记录" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetHcgForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="hcgForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-group"><label>HCG 值 (mIU/mL)</label><n-input-number v-model:value="hcgForm.value" :min="0" :max="1000000" :step="100" placeholder="如：50000" style="width:100%" /></div>
        <div class="qf-group"><label>孕周（可选，用于参考范围）</label><n-input-number v-model:value="hcgForm.weeks" :min="3" :max="15" :step="1" placeholder="如：6" style="width:100%" /></div>
        <div class="form-hint-text">孕3-4周: 50-500 | 孕4-5周: 100-5000 | 孕5-6周: 1000-50000 | 孕6-8周达峰值后逐渐下降</div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="hcgForm.note" placeholder="如：翻倍情况、医生建议等" /></div>
      </div>
      <template #action><n-button @click="showHcgModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveHcg">保存</n-button></template>
    </n-modal>

    <!-- 尿酸专业记录弹窗 -->
    <n-modal v-model:show="showUaModal" preset="card" title="尿酸记录" style="max-width:440px;width:94vw;" :mask-closable="true" @after-leave="resetUaForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="uaForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-row">
          <div class="qf-group flex1"><label>尿酸值 (μmol/L)</label><n-input-number v-model:value="uaForm.value" :min="100" :max="800" :step="10" placeholder="如：350" style="width:100%" /></div>
          <div class="qf-group flex1"><label>测量时段</label><n-select v-model:value="uaForm.period" :options="uaPeriodOptions" placeholder="选择" style="width:100%" /></div>
        </div>
        <div class="form-hint-text">正常参考值：非孕期 150-360 μmol/L；孕期可能略高，>420需关注</div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="uaForm.note" placeholder="如：是否空腹、医生建议等" /></div>
      </div>
      <template #action><n-button @click="showUaModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveUa">保存</n-button></template>
    </n-modal>

    <!-- 三围弹窗（胸围 / 腰围 / 臀围，可只填其中一两项） -->
    <n-modal v-model:show="showWaistModal" preset="card" title="📏 记录三围" style="max-width:400px;width:92vw;" :mask-closable="true" @after-leave="resetWaistForm">
      <div class="quick-form">
        <div class="qf-group"><label>日期</label><n-date-picker v-model:formatted-value="waistForm.date" type="date" value-format="yyyy-MM-dd" style="width:100%" /></div>
        <div class="qf-group"><label>胸围 (cm)</label><n-input-number v-model:value="waistForm.bust" :min="50" :max="220" :step="0.1" placeholder="如：92" style="width:100%" /></div>
        <div class="qf-group"><label>腰围 (cm)</label><n-input-number v-model:value="waistForm.value" :min="40" :max="200" :step="0.1" placeholder="如：85" style="width:100%" /></div>
        <div class="qf-group"><label>臀围 (cm)</label><n-input-number v-model:value="waistForm.hip" :min="60" :max="230" :step="0.1" placeholder="如：95" style="width:100%" /></div>
        <div class="form-hint-text">只填其中一两项也可以；建议固定时间（如晨起空腹）测量，便于前后对比</div>
        <div class="qf-group"><label>当天备注（可选）</label><n-input v-model:value="waistForm.note" placeholder="可选" /></div>
      </div>
      <template #action><n-button @click="showWaistModal=false">取消</n-button><n-button type="primary" :loading="saving" @click="saveWaist">保存</n-button></template>
    </n-modal>

    <!-- 水肿弹窗 -->
    <n-modal
      v-model:show="showEdemaModal"
      preset="card"
      title="记录水肿"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetEdemaForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="edemaForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>水肿程度</label>
          <n-radio-group v-model:value="edemaForm.level" size="small">
            <n-radio-button value="none">无</n-radio-button>
            <n-radio-button value="mild">轻度</n-radio-button>
            <n-radio-button value="moderate">中度</n-radio-button>
            <n-radio-button value="severe">重度</n-radio-button>
          </n-radio-group>
        </div>
        <div class="form-hint-text">孕晚期轻微水肿较常见，可抬高下肢、少盐饮食；若短期内明显加重，或伴头痛、视物模糊、血压升高，请立即就医</div>
        <div class="qf-group">
          <label>当天备注（可选）</label>
          <n-input v-model:value="edemaForm.note" placeholder="如：部位（脚踝/小腿/手）、休息后是否消退" />
        </div>
      </div>
      <template #action>
        <n-button @click="showEdemaModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveEdema">保存</n-button>
      </template>
    </n-modal>

    <!-- 分泌物弹窗 -->
    <n-modal
      v-model:show="showDischargeModal"
      preset="card"
      title="记录分泌物"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetDischargeForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="dischargeForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>分泌物情况</label>
          <n-radio-group v-model:value="dischargeForm.value" size="small">
            <n-radio-button value="normal">正常</n-radio-button>
            <n-radio-button value="more">偏多</n-radio-button>
            <n-radio-button value="abnormal">异常</n-radio-button>
          </n-radio-group>
        </div>
        <div class="form-hint-text">孕期分泌物增多多为正常；若出现异味、颜色异常、豆腐渣样，或伴瘙痒灼痛，请就医检查</div>
        <div class="qf-group">
          <label>当天备注（可选）</label>
          <n-input v-model:value="dischargeForm.note" placeholder="如：颜色、性状、有无异味或瘙痒" />
        </div>
      </div>
      <template #action>
        <n-button @click="showDischargeModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveDischarge">保存</n-button>
      </template>
    </n-modal>

    <!-- 皮肤状况弹窗 -->
    <n-modal
      v-model:show="showSkinModal"
      preset="card"
      title="记录皮肤状况"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetSkinForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="skinForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>皮肤状况</label>
          <n-radio-group v-model:value="skinForm.value" size="small">
            <n-radio-button value="normal">正常</n-radio-button>
            <n-radio-button value="stretch_marks">妊娠纹</n-radio-button>
            <n-radio-button value="itchy">瘙痒</n-radio-button>
            <n-radio-button value="melasma">色素沉着</n-radio-button>
          </n-radio-group>
        </div>
        <div class="form-hint-text">妊娠纹多出现在腹部与大腿，控制体重增速有帮助；若全身瘙痒（尤其手心脚心）请尽快就医排查胆汁淤积</div>
        <div class="qf-group">
          <label>当天备注（可选）</label>
          <n-input v-model:value="skinForm.note" placeholder="如：出现部位、是否瘙痒" />
        </div>
      </div>
      <template #action>
        <n-button @click="showSkinModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveSkin">保存</n-button>
      </template>
    </n-modal>

    <!-- 排尿情况弹窗 -->
    <n-modal
      v-model:show="showUrinationModal"
      preset="card"
      title="记录排尿情况"
      style="max-width: 420px; width: 92vw;"
      :mask-closable="true"
      @after-leave="resetUrinationForm"
    >
      <div class="quick-form">
        <div class="qf-group">
          <label>日期</label>
          <n-date-picker v-model:formatted-value="urinationForm.date" type="date" value-format="yyyy-MM-dd" style="width: 100%" />
        </div>
        <div class="qf-group">
          <label>排尿情况</label>
          <n-radio-group v-model:value="urinationForm.value" size="small">
            <n-radio-button value="normal">正常</n-radio-button>
            <n-radio-button value="frequent">尿频</n-radio-button>
            <n-radio-button value="painful">尿痛</n-radio-button>
          </n-radio-group>
        </div>
        <div class="form-hint-text">孕早期与孕晚期尿频多为正常（子宫压迫膀胱）；若伴尿痛、尿急或发热，可能是尿路感染，需就医</div>
        <div class="qf-group">
          <label>当天备注（可选）</label>
          <n-input v-model:value="urinationForm.note" placeholder="如：白天/夜间次数、有无尿急" />
        </div>
      </div>
      <template #action>
        <n-button @click="showUrinationModal = false">取消</n-button>
        <n-button type="primary" :loading="saving" @click="saveUrination">保存</n-button>
      </template>
    </n-modal>

    <!-- 编辑/添加通用大弹窗
         ⚠️ 现在快捷菜单里每个类型都有自己的专属小弹窗，这里主要承担「编辑已有记录」；
         openQuickAdd 的 default 分支保留为兜底（将来新增类型漏接小弹窗时仍能录进去）。 -->
    <AddRecordDialog :show="showAddDialog" :date="selectedDate" :pregnancy-id="pregnancyStore.currentPregnancy?.id" :default-type="addDialogType" :edit-record="addDialogRecord" @update:show="showAddDialog = $event" @saved="onRecordSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  NButton, NModal, NInput, NInputNumber, NDatePicker, NTimePicker,
  NRadioGroup, NRadioButton, NPopover, NSelect,
  useMessage,
} from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useResize } from '@/composables/useResize'
import { useRoute } from 'vue-router'
import { dailyRecordApi } from '@/api/daily-record'
import { reminderApi } from '@/api/reminder'
import dayjs from 'dayjs'
import MiniCalendar from '@/components/record/MiniCalendar.vue'
import RecordList from '@/components/record/RecordList.vue'
import AddRecordDialog from '@/components/record/AddRecordDialog.vue'
import QuickLogDialog from '@/components/record/QuickLogDialog.vue'
import SessionDetailDialog from '@/components/record/SessionDetailDialog.vue'
import { getMoodEmoji as moodEmojiOf, MOOD_OPTIONS as moodOptions, SLEEP_QUALITY_OPTIONS as sleepQualityOptions, EXERCISE_INTENSITY_OPTIONS as exerciseIntensityOptions, type SleepQuality, type ExerciseIntensity, isValidDateStr } from '@/utils/format'
import StatsPanel from './StatsView/StatsPanel.vue'
import AppIcon from '@/components/common/AppIcon.vue'

const pregnancyStore = usePregnancyStore()
const { isMobile } = useResize()
const message = useMessage()
const route = useRoute()

/**
 * 初始选中日期。
 *
 * ⚠️ 首页「今日记录」板块的「查看详情 →」一直带着 `?date=YYYY-MM-DD` 跳过来
 * （`/record?date=...`），但本页**从不读 route.query** ⇒ 那个参数一直是**死的**。
 * 平时看不出来（首页传的就是今天，与本页默认值相同），一旦从别处带日期进来就会静默落到今天，
 * 用户以为在看 A 那天、实际看到的是今天 —— 正是本项目最忌讳的"静默错位"。
 * 现在：带过来且合法就用它，否则（非法 / 没带）回退今天。
 * 校验用共享的 `isValidDateStr()`，不要用 dayjs 严格模式（本项目未 extend customParseFormat，不生效）。
 */
const selectedDate = ref(
  (() => {
    const q = route.query && route.query.date
    const s = typeof q === 'string' ? q : ''
    return isValidDateStr(s) ? s : dayjs().format('YYYY-MM-DD')
  })()
)
// 已经在记录页时再带新日期跳进来（同一路由不同 query 不会重新挂载）也要跟着切
watch(
  () => (route.query ? route.query.date : ''),
  (q) => {
    const s = typeof q === 'string' ? q : ''
    if (isValidDateStr(s) && s !== selectedDate.value) selectedDate.value = s
  }
)
const saving = ref(false)
const currentRecords = ref<any[]>([])

/**
 * 传给共享组件 QuickLogDialog 的「当天备注」预填值。
 * `daily_record.note` 是**按天共享的一列**（一天一行、所有类型共用），所以要预填，
 * 否则用户只在胎动弹窗里写备注、保存时会把当天其它类型写的备注覆盖掉（纯静默丢数据）。
 */
const quickLogNote = computed(() => (currentRecords.value[0] && currentRecords.value[0].note) || '')

// ====== 子级 Tab 切换 ======
const activeSubTab = ref<'record' | 'stats'>('record')

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
const showSymptomModal = ref(false)
const showSupplementModal = ref(false)
const showHabitModal = ref(false)
const showMedicationModal = ref(false)
const showTempModal = ref(false)
const showSleepModal = ref(false)
const showWaterModal = ref(false)
const showDietModal = ref(false)
const showExerciseModal = ref(false)
const showFmModal = ref(false)
const showContrModal = ref(false)
// 会话明细弹窗（点记录列表里的「胎动」「宫缩」条目打开）
const showSessionDetail = ref(false)
const sessionDetailType = ref<'fetal_movement' | 'contraction'>('fetal_movement')
function openSessionDetail(type: string) {
  sessionDetailType.value = type === 'contraction' ? 'contraction' : 'fetal_movement'
  showSessionDetail.value = true
}
const showPlanModal = ref(false)
const showIntimacyModal = ref(false)
const showHcgModal = ref(false)
const showUaModal = ref(false)
const showWaistModal = ref(false)
const showEdemaModal = ref(false)
const showDischargeModal = ref(false)
const showSkinModal = ref(false)
const showUrinationModal = ref(false)

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
// 心情选项统一取自 utils/format 的共享常量
const moodForm = ref({ date: dayjs().format('YYYY-MM-DD'), value: 3, note: '' })
// 症状
const symptomOptions = ['恶心', '呕吐', '头痛', '头晕', '水肿', '腰痛', '胃灼热', '便秘', '腹泻', '尿频', '失眠', '焦虑', '乏力', '气短', '心悸', '背痛', '腿抽筋']
const symptomForm = ref({ date: '', items: [] as string[] })
// 补充剂
const supplementOptions = ['叶酸', '铁剂', '钙片', 'DHA', '复合维生素', '维生素D', '维生素B6', '益生菌']
const supplementForm = ref({ date: '', items: [] as string[] })
// 好习惯
const habitForm = ref({ date: '', text: '' })
// 用药（存 JSON 数组 [{name,dosage,frequency}]，与大弹窗、记录列表的解析口径一致）
const medForm = ref({ date: '', name: '', dosage: '', frequency: '', note: '' })
// 体温
const tempForm = ref({ date: '', value: null as number | null, note: '' })
// 睡眠
// ⚠️ 质量存**规范英文值**（good/fair/poor），与「添加记录」大弹窗一致。
//    以前这里写中文（好/一般/差），导致同一个字段两套取值域、编辑一次就被静默改域。
//    文案与取值都取自 utils/format 的唯一真源。
const sleepForm = ref({ date: '', bedtime: '' as string, waketime: '' as string, quality: 'fair' as SleepQuality, note: '' })

// 时间选项（每30分钟一个，00:00 ~ 23:30）
const timeOptions = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = (i % 2) * 30
  const v = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
  return { value: v, label: v }
})
// 饮水
const waterForm = ref({ date: '', value: null as number | null, note: '' })
// 饮食
const dietForm = ref({ date: '', meal: '早餐' as '早餐' | '午餐' | '晚餐' | '加餐', content: '' })
// 运动
const exerciseTypeOptions = [
  { label: '散步', value: '散步' }, { label: '瑜伽', value: '瑜伽' }, { label: '游泳', value: '游泳' },
  { label: '孕妇操', value: '孕妇操' }, { label: '骑行', value: '骑行' }, { label: '其他', value: '其他' },
]
const exerciseForm = ref({ date: '', type: '散步', duration: null as number | null, intensity: '' as '' | ExerciseIntensity, note: '' })
// 胎动 / 宫缩的表单、校验与保存逻辑已移入共享组件 components/record/QuickLogDialog.vue
// （首页也要能快捷记录同一件事，两处共用一份实现，避免日后再写一遍）
// 计划
// 🔴 time 的初值必须是 **null**，不能是空字符串：
//    n-time-picker 绑的是 formatted-value，收到 '' 会在内部解析时抛
//    `RangeError: Invalid time value`，被 App.vue 错误边界接住 ⇒ 整页「这个页面出错了」。
//    项目里已踩过两次（宫缩的开始/结束时间、计划的日期），见 MEMORY.md 铁律 #47。
const planForm = ref({ date: '', time: null as string | null, text: '' })
// 爱爱
const intimacyForm = ref({ date: '', count: null as number | null, hasProtection: 'no' as 'yes' | 'no', protectionType: '' as string, note: '' })
// HCG
const hcgForm = ref({ date: '', value: null as number | null, weeks: null as number | null, note: '' })
// 尿酸
// ⚠️ 取值域必须与「添加记录」大弹窗一致（那边原来是「空腹/餐后2小时」）——
//    同一个字段两套取值，统计表和导出里就会冒出一个两边都不认的值。这里取并集。
const uaPeriodOptions = [
  { label: '空腹', value: '空腹' }, { label: '餐后2小时', value: '餐后2小时' },
  { label: '随机', value: '随机' },
]
const uaForm = ref({ date: '', value: null as number | null, period: '空腹', note: '' })
// 腰围
const waistForm = ref({ date: '', bust: null as number | null, value: null as number | null, hip: null as number | null, note: '' })
// 水肿 / 分泌物 / 皮肤状况 / 排尿情况
// ⚠️ 这四类以前没有专属小弹窗，点下去会掉进 26 个类型的选择器大弹窗，
//    与其它所有类型的交互都不一样（用户会以为功能没做）。
const edemaForm = ref({ date: '', level: 'none' as 'none' | 'mild' | 'moderate' | 'severe', note: '' })
const dischargeForm = ref({ date: '', value: 'normal' as 'normal' | 'more' | 'abnormal', note: '' })
const skinForm = ref({ date: '', value: 'normal' as 'normal' | 'stretch_marks' | 'itchy' | 'melasma', note: '' })
const urinationForm = ref({ date: '', value: 'normal' as 'normal' | 'frequent' | 'painful', note: '' })

// ====== 类型菜单定义 ======
const quickTypes = [
  { value: 'weight', icon: 'weight', label: '体重' },
  { value: 'blood_pressure', icon: '🩺', label: '血压' },
  { value: 'fetal_movement', icon: '🦶', label: '胎动' },
  { value: 'contraction', icon: 'timer', label: '宫缩' },
  { value: 'fetal_heart_rate', icon: 'heart', label: '胎心' },
  { value: 'temperature', icon: 'thermometer', label: '体温' },
  { value: 'waist', icon: '📏', label: '三围' },
  { value: 'edema', icon: '🦵', label: '水肿' },
  { value: 'symptoms', icon: 'clipboard', label: '症状' },
  { value: 'discharge', icon: '💧', label: '分泌物' },
  { value: 'skin', icon: '✨', label: '皮肤状况' },
  { value: 'urination', icon: '🚻', label: '排尿情况' },
  { value: 'stool', icon: '💩', label: '便便' },
  { value: 'sleep', icon: '😴', label: '睡眠' },
  { value: 'water', icon: '💧', label: '饮水' },
  { value: 'diet', icon: '🍎', label: '饮食' },
  { value: 'exercise', icon: '🏃', label: '运动' },
  { value: 'supplement', icon: '💊', label: '补充剂' },
  { value: 'medication', icon: '💊', label: '用药' },
  { value: 'habit', icon: '✅', label: '好习惯' },
  { value: 'blood_glucose', icon: '🩸', label: '血糖' },
  // ⚠️ hCG / 尿酸 此前**只差这一行**：openQuickAdd 分支、小弹窗、表单、NOTE_FORMS 登记、
  //    记录列表条目全都在（首页「今日记录」宫格也会显示它们），唯独「＋」快捷菜单里没有 ⇒
  //    用户在记录页的 ＋ 里根本找不到，只能碰运气点列表里的条目。属"入口漏接"（铁律 #10 那类）。
  //    位置与记录列表保持一致（孕期血糖 → hCG → 尿酸 → 心情），有三处顺序一致性断言守着。
  { value: 'hcg', icon: '🧬', label: 'hCG' },
  { value: 'uric_acid', icon: '🧪', label: '尿酸' },
  { value: 'mood', icon: '😊', label: '心情' },
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

  if (r.weight) items.push({ type: 'weight', icon: 'weight', label: '体重', value: r.weight + ' kg', color: '#a78bfa' })
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
  if (r.fetal_heart_rate) items.push({ type: 'fetal_heart_rate', icon: 'heart', label: '胎心', value: r.fetal_heart_rate + ' bpm', color: '#f472b6' })
  // 三围合并成一张预览卡（预览位有限，最多 6 张），只显示已填的那些
  {
    const parts: string[] = []
    if (r.bust) parts.push('胸' + r.bust)
    if (r.waist) parts.push('腰' + r.waist)
    if (r.hip) parts.push('臀' + r.hip)
    if (parts.length) items.push({ type: 'waist', icon: '📏', label: '三围', value: parts.join(' ') + ' cm', color: '#14b8a6' })
  }
  {
    const edemaMap: Record<string, string> = { none: '无', mild: '轻度', moderate: '中度', severe: '重度' }
    if (r.edema_level) items.push({ type: 'edema', icon: '🦵', label: '水肿', value: edemaMap[r.edema_level] || r.edema_level, color: '#0ea5e9' })
  }
  {
    const dMap: Record<string, string> = { normal: '正常', more: '偏多', abnormal: '异常' }
    if (r.vaginal_discharge) items.push({ type: 'discharge', icon: '💧', label: '分泌物', value: dMap[r.vaginal_discharge] || r.vaginal_discharge, color: '#06b6d4' })
  }
  {
    const sMap: Record<string, string> = { normal: '正常', stretch_marks: '妊娠纹', itchy: '瘙痒', melasma: '色素沉着' }
    if (r.skin_condition) items.push({ type: 'skin', icon: '✨', label: '皮肤', value: sMap[r.skin_condition] || r.skin_condition, color: '#d946ef' })
  }
  {
    const uMap: Record<string, string> = { normal: '正常', frequent: '尿频', painful: '尿痛' }
    if (r.urination_frequency) items.push({ type: 'urination', icon: '🚻', label: '排尿', value: uMap[r.urination_frequency] || r.urination_frequency, color: '#22d3ee' })
  }
  if (r.mood) {
    // 心情 emoji 取自 utils/format 的唯一真源，兜底沿用本页原有的 '😐'
    items.push({ type: 'mood', icon: '😊', label: '心情', value: (moodEmojiOf(r.mood, '😐')) + (r.mood_note ? ' ' + r.mood_note.slice(0, 8) : ''), color: '#f87171' })
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
  if (date && pid) { fetchRecords(); loadPlans() }
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

function onEditRecord(payload: { type: string; record: any }) {
  // 编辑模式使用原有的大弹窗
  addDialogType.value = payload.type
  addDialogRecord.value = payload.record
  showAddDialog.value = true
}

/**
 * 「当天备注」预填表：type → 该类型的快捷表单。
 *
 * ⚠️ `daily_record.note` 是**按天共享的一列**（一天一行、所有类型共用），**不是每类型一列**。
 *    换言之二十几个小弹窗里的「备注」写的其实是同一格。
 *    以前这里是"直接覆盖"⇒ 先给体重写备注、再给睡眠写备注，前一个就被悄悄抹掉了；
 *    而记录列表和预览卡都不显示 note，用户完全看不出来（纯静默丢数据）。
 *    现在打开弹窗时把当天已有的备注预填进去 —— 用户看得见自己在改什么，不会再盲写覆盖。
 *    （心情是唯一例外：它有自己的 `mood_note` 列，不参与共享。）
 */
const NOTE_FORMS: Record<string, any> = {
  weight: weightForm, waist: waistForm, blood_pressure: bpForm, blood_glucose: glucoseForm,
  fetal_heart_rate: fhrForm, stool: stoolForm, temperature: tempForm, sleep: sleepForm,
  water: waterForm, exercise: exerciseForm,
  intimacy: intimacyForm, hcg: hcgForm, uric_acid: uaForm, edema: edemaForm,
  discharge: dischargeForm, skin: skinForm, urination: urinationForm, medication: medForm,
}
// 胎动 / 宫缩不在这里：它们的表单在共享组件里，备注由组件通过 :note 预填（见 quickLogNote）

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
    case 'medication': resetMedicationForm(); medForm.value.date = d; showMedicationModal.value = true; break
    case 'temperature': resetTempForm(); tempForm.value.date = d; showTempModal.value = true; break
    case 'sleep': resetSleepForm(); sleepForm.value.date = d; showSleepModal.value = true; break
    case 'water': resetWaterForm(); waterForm.value.date = d; showWaterModal.value = true; break
    case 'diet': resetDietForm(); dietForm.value.date = d; showDietModal.value = true; break
    case 'exercise': resetExerciseForm(); exerciseForm.value.date = d; showExerciseModal.value = true; break
    case 'fetal_movement': showFmModal.value = true; break
    case 'contraction': showContrModal.value = true; break
    case 'plan': resetPlanForm(); planForm.value.date = d; showPlanModal.value = true; break
    case 'intimacy': resetIntimacyForm(); intimacyForm.value.date = d; showIntimacyModal.value = true; break
    case 'hcg': resetHcgForm(); hcgForm.value.date = d; showHcgModal.value = true; break
    case 'uric_acid': resetUaForm(); uaForm.value.date = d; showUaModal.value = true; break
    case 'waist': resetWaistForm(); waistForm.value.date = d; showWaistModal.value = true; break
    case 'edema': resetEdemaForm(); edemaForm.value.date = d; showEdemaModal.value = true; break
    case 'discharge': resetDischargeForm(); dischargeForm.value.date = d; showDischargeModal.value = true; break
    case 'skin': resetSkinForm(); skinForm.value.date = d; showSkinModal.value = true; break
    case 'urination': resetUrinationForm(); urinationForm.value.date = d; showUrinationModal.value = true; break
  // 兜底：将来新加的类型若忘了接专属小弹窗，仍能打开通用大弹窗录入。
  // ⚠️ 这里以前只弹一句「未知类型」警告 —— 于是新加的记录类型点下去等于没反应，
  // 用户会以为「这个功能根本没做」。所以默认分支必须能真的打开录入界面。
  default:
    addDialogType.value = type
    addDialogRecord.value = null
    showAddDialog.value = true
    break
  }
  // 把当天已有的备注预填进「当天备注」（原因见 NOTE_FORMS 上方说明）
  const nf = NOTE_FORMS[type]
  if (nf && 'note' in nf.value) {
    nf.value.note = (currentRecords.value[0] && currentRecords.value[0].note) || ''
  }
  // 心情是唯一例外：它有自己的 mood_note 列，不参与共享，得单独预填，
  // 否则用户只想换个心情、保存时就会把之前写的心情备注清成空串（现在 note 是显式写入）。
  if (type === 'mood') {
    moodForm.value.note = (currentRecords.value[0] && currentRecords.value[0].mood_note) || ''
  }
}

// ====== 通用保存辅助 ======
async function doUpsert(data: any) {
  if (!pregnancyStore.currentPregnancy?.id) {
    message.error('缺少孕期信息')
    return false
  }
  // record_date 必须是有效日期。
  // ⚠️ 这里以前是「非法就默默改成今天」—— 用户选错日期时数据会悄悄落到**今天**，
  //    记录页看不到问题（今天确实多了一条），但那条记录根本不在用户以为的那天。
  //    现在：传了日期但不合法 ⇒ 直接报错中止，让他重选。
  // 🔴 校验必须用共享的 `isValidDateStr()`：全项目没有 `dayjs.extend(customParseFormat)`，
  //    `dayjs(x,'YYYY-MM-DD',true)` 的严格模式**不生效**（会溢出进位成另一个日期）。见 utils/format。
  const rawDate = data.record_date
  if (rawDate != null && rawDate !== '' && !isValidDateStr(rawDate)) {
    message.error('日期无效，请重新选择日期')
    return false
  }
  // 已通过校验 ⇒ 字符串本身就是标准的 YYYY-MM-DD，无需再交给 dayjs 格式化一遍
  data.record_date = rawDate ? String(rawDate) : dayjs().format('YYYY-MM-DD')
  saving.value = true
  try {
    data.pregnancy_id = pregnancyStore.currentPregnancy.id
    const res: any = await dailyRecordApi.upsert(data)
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
    note: weightForm.value.note,
  })
  if (ok) showWeightModal.value = false
}

async function saveBp() {
  if (!bpForm.value.systolic || !bpForm.value.diastolic) { message.warning('请输入血压值'); return }
  const ok = await doUpsert({
    record_date: bpForm.value.date,
    blood_pressure_systolic: String(bpForm.value.systolic),
    blood_pressure_diastolic: String(bpForm.value.diastolic),
    note: bpForm.value.note,
  })
  if (ok) showBpModal.value = false
}

async function saveGlucose() {
  if (!glucoseForm.value.value) { message.warning('请输入血糖值'); return }
  const data: any = {
    record_date: glucoseForm.value.date,
    note: glucoseForm.value.note,
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
    note: fhrForm.value.note,
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
    note: stoolForm.value.note,
  })
  if (ok) showStoolModal.value = false
}

async function saveMood() {
  const date = moodForm.value.date || dayjs().format('YYYY-MM-DD')
  const ok = await doUpsert({
    record_date: date,
    mood: String(moodForm.value.value ?? 3),
    mood_note: moodForm.value.note,
  })
  if (ok) {
    showMoodModal.value = false
    message.success('心情已保存')
  }
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
  const ok = await doUpsert({
    record_date: habitForm.value.date,
    habit_text: habitForm.value.text,
  })
  if (ok) showHabitModal.value = false
}

async function saveMedication() {
  if (!medForm.value.name.trim()) { message.warning('请输入药品名称'); return }
  const ok = await doUpsert({
    record_date: medForm.value.date,
    // 与大弹窗（AddRecordDialog）写的是同一形状，记录列表也按这个形状解析
    medication: JSON.stringify([{
      name: medForm.value.name.trim(),
      dosage: medForm.value.dosage.trim(),
      frequency: medForm.value.frequency.trim(),
    }]),
    note: medForm.value.note,
  })
  if (ok) showMedicationModal.value = false
}

// ====== 重置表单函数 ======
function resetWeightForm() { weightForm.value = { date: '', value: null, note: '' } }
function resetBpForm() { bpForm.value = { date: '', systolic: null, diastolic: null, note: '' } }
function resetGlucoseForm() { glucoseForm.value = { date: '', period: 'fasting', value: null, note: '' } }
function resetFhrForm() { fhrForm.value = { date: '', value: null, note: '' } }
function resetStoolForm() { stoolForm.value = { date: '', count: null, consistency: 'normal', note: '' } }
function resetMoodForm() { moodForm.value = { date: dayjs().format('YYYY-MM-DD'), value: 3, note: '' } }
function resetSymptomForm() { symptomForm.value = { date: '', items: [] } }
function resetSupplementForm() { supplementForm.value = { date: '', items: [] } }
function resetHabitForm() { habitForm.value = { date: '', text: '' } }
function resetMedicationForm() { medForm.value = { date: '', name: '', dosage: '', frequency: '', note: '' } }
function resetTempForm() { tempForm.value = { date: '', value: null, note: '' } }
function resetSleepForm() { sleepForm.value = { date: '', bedtime: '', waketime: '', quality: 'fair', note: '' } }
function resetWaterForm() { waterForm.value = { date: '', value: null, note: '' } }
function resetDietForm() { dietForm.value = { date: '', meal: '早餐', content: '' } }
function resetExerciseForm() { exerciseForm.value = { date: '', type: '散步', duration: null, intensity: '', note: '' } }
// resetFmForm / resetContrForm 已随胎动·宫缩弹窗移入共享组件（组件每次打开自己重置）
function resetPlanForm() { planForm.value = { date: '', time: null, text: '' } }
function resetIntimacyForm() { intimacyForm.value = { date: '', count: null, hasProtection: 'no', protectionType: '', note: '' } }

// ====== 新增类型保存函数 ======
async function saveTemp() {
  if (!tempForm.value.value) { message.warning('请输入体温'); return }
  const ok = await doUpsert({ record_date: tempForm.value.date, body_temperature: tempForm.value.value, note: tempForm.value.note, })
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
  const ok = await doUpsert({
    record_date: sleepForm.value.date,
    sleep_hours: hours,
    sleep_quality: sleepForm.value.quality || undefined,
    note: sleepForm.value.note,
  })
  if (ok) showSleepModal.value = false
}

async function saveWater() {
  if (!waterForm.value.value) { message.warning('请输入饮水量'); return }
  const ok = await doUpsert({ record_date: waterForm.value.date, water_intake: waterForm.value.value, note: waterForm.value.note, })
  if (ok) showWaterModal.value = false
}

async function saveDiet() {
  if (!dietForm.value.content.trim()) { message.warning('请输入饮食内容'); return }
  // ⚠️ 统一用 JSON 数组存储（`[{type,content}]`）——「添加记录」大弹窗就是这个格式，
  //    这里以前存纯文本 ⇒ 用大弹窗开一次就被改写成 JSON，格式漂移。
  //    读侧（记录列表 / 大弹窗）两种都能认，所以老数据不受影响。
  const ok = await doUpsert({
    record_date: dietForm.value.date,
    diet_note: JSON.stringify([{ type: dietForm.value.meal, content: dietForm.value.content }]),
  })
  if (ok) showDietModal.value = false
}

async function saveExercise() {
  if (!exerciseForm.value.duration) { message.warning('请输入运动时长'); return }
  const ok = await doUpsert({
    record_date: exerciseForm.value.date,
    exercise_type: exerciseForm.value.type,
    exercise_duration: exerciseForm.value.duration,
    // 强度是可选：没选就不提交（后端按 `!== undefined` 判更新，不提交即保持原值，不会被清掉）
    exercise_intensity: exerciseForm.value.intensity || undefined,
    note: exerciseForm.value.note,
  })
  if (ok) showExerciseModal.value = false
}

// saveFm / saveContr 已移入共享组件 QuickLogDialog.vue（首页用同一份）

/**
 * 保存计划。
 *
 * 🔴 计划**不再写进当天记录**（daily_record.plan_text），而是作为一条「待办」（reminder）保存：
 *    · 记录是**一天一条**，同一天多个时间点的安排根本放不下（写了 9 点产检就写不下下午 3 点散步）；
 *    · 待办天然**一条一记录**，支持任意多条、带具体时间；
 *    · 且待办**本来就在推送链路里**（push-engine 会扫 reminder 表做今日/未来提醒），
 *      存进去就自动获得「到点提醒」，不用为计划再单独做一套推送。
 *    历史数据（老记录里的 plan_text）仍照旧显示，见 RecordList 的计划行。
 */
async function savePlan() {
  const text = planForm.value.text.trim()
  if (!text) { message.warning('请输入计划内容'); return }
  const pid = pregnancyStore.currentPregnancy?.id
  if (!pid) { message.error('缺少孕期信息，请先完成初始设置'); return }

  const date = planForm.value.date || dayjs().format('YYYY-MM-DD')
  if (!isValidDateStr(date)) { message.error('日期无效，请重新选择日期'); return }

  saving.value = true
  try {
    const res: any = await reminderApi.create({
      pregnancy_id: pid,
      title: text,
      trigger_date: date,
      trigger_time: planForm.value.time || null,   // 空则只按日期提醒
      reminder_type: 'plan',
      priority: 'medium',
      is_enabled: 1,
    })
    if (res.code !== 0) { message.error(res.message || '保存失败，请重试'); return }
    const isToday = date === dayjs().format('YYYY-MM-DD')
    message.success(isToday ? '已加入今日计划' : `已加入孕期计划（${date.slice(5)}${planForm.value.time ? ' ' + planForm.value.time : ''}）`)
    showPlanModal.value = false
    await loadPlans()
  } catch (e: any) {
    message.error('保存失败：' + (e?.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

/** 记录页要展示的计划：全部「计划」类型的待办（含今日与孕期），供列表与首页共用。 */
const todayPlans = ref<any[]>([])

async function loadPlans() {
  const pid = pregnancyStore.currentPregnancy?.id
  if (!pid) { todayPlans.value = []; return }
  try {
    const res: any = await reminderApi.list(pid)
    const rows = res && res.code === 0 && Array.isArray(res.data) ? res.data : []
    // 只取计划类；历史「手动待办」不混进来
    todayPlans.value = rows.filter((p: any) => p.reminder_type === 'plan')
  } catch (e) {
    todayPlans.value = []
  }
}

async function saveIntimacy() {
  const ok = await doUpsert({
    record_date: intimacyForm.value.date,
    intimacy_record: JSON.stringify({ count: intimacyForm.value.count, has_protection: intimacyForm.value.hasProtection, protection_type: intimacyForm.value.protectionType }),
    note: intimacyForm.value.note,
  })
  if (ok) showIntimacyModal.value = false
}

// ====== HCG & 尿酸 ======
function resetHcgForm() { hcgForm.value = { date: '', value: null, weeks: null, note: '' } }
function resetUaForm() { uaForm.value = { date: '', value: null, period: '空腹', note: '' } }
function resetWaistForm() { waistForm.value = { date: '', bust: null, value: null, hip: null, note: '' } }
function resetEdemaForm() { edemaForm.value = { date: '', level: 'none', note: '' } }
function resetDischargeForm() { dischargeForm.value = { date: '', value: 'normal', note: '' } }
function resetSkinForm() { skinForm.value = { date: '', value: 'normal', note: '' } }
function resetUrinationForm() { urinationForm.value = { date: '', value: 'normal', note: '' } }

async function saveHcg() {
  if (!hcgForm.value.value) { message.warning('请输入HCG值'); return }
  const ok = await doUpsert({
    record_date: hcgForm.value.date,
    hcg_value: hcgForm.value.value,
    hcg_weeks: hcgForm.value.weeks || undefined,
    note: hcgForm.value.note,
  })
  if (ok) showHcgModal.value = false
}

async function saveUa() {
  if (!uaForm.value.value) { message.warning('请输入尿酸值'); return }
  const ok = await doUpsert({
    record_date: uaForm.value.date,
    uric_acid: uaForm.value.value,
    uric_acid_period: uaForm.value.period || undefined,
    note: uaForm.value.note,
  })
  if (ok) showUaModal.value = false
}

async function saveWaist() {
  const { bust, value, hip } = waistForm.value
  // 三围允许只填一两项，但一项都不填就没意义
  if (bust == null && value == null && hip == null) {
    message.warning('请至少填写胸围 / 腰围 / 臀围中的一项')
    return
  }
  const payload: any = {
    record_date: waistForm.value.date,
    note: waistForm.value.note,
  }
  // 只提交真正填了的项，避免把用户没量的一项写成空值
  if (bust != null) payload.bust = bust
  if (value != null) payload.waist = value
  if (hip != null) payload.hip = hip
  const ok = await doUpsert(payload)
  if (ok) showWaistModal.value = false
}

// 水肿 / 分泌物 / 皮肤状况 / 排尿情况
// 四类都是「单选 + 备注」，备注统一走 daily_record.note（与体重/血压/便便等完全同一字段），
// 后端 POST 只更新请求里出现过的字段，所以大弹窗编辑这四类时不会把备注抹掉。
async function saveEdema() {
  const ok = await doUpsert({
    record_date: edemaForm.value.date,
    edema_level: edemaForm.value.level || 'none',
    note: edemaForm.value.note,
  })
  if (ok) showEdemaModal.value = false
}

async function saveDischarge() {
  const ok = await doUpsert({
    record_date: dischargeForm.value.date,
    vaginal_discharge: dischargeForm.value.value || 'normal',
    note: dischargeForm.value.note,
  })
  if (ok) showDischargeModal.value = false
}

async function saveSkin() {
  const ok = await doUpsert({
    record_date: skinForm.value.date,
    skin_condition: skinForm.value.value || 'normal',
    note: skinForm.value.note,
  })
  if (ok) showSkinModal.value = false
}

async function saveUrination() {
  const ok = await doUpsert({
    record_date: urinationForm.value.date,
    urination_frequency: urinationForm.value.value || 'normal',
    note: urinationForm.value.note,
  })
  if (ok) showUrinationModal.value = false
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

// 统计面板已抽成共享组件 views/StatsView/StatsPanel.vue（本页与「统计」页共用，避免两份实现漂移）
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

/* ====== 小弹窗表单通用样式 ======
   .quick-form / .qf-group / .qf-row / .flex1 / .form-hint-text 已移到
   styles/global.css（共享组件 QuickLogDialog 也要用，scoped 样式跨不过组件边界）。
   改那里的定义即可，本页二十多个小弹窗与共享组件同步生效。 */

/* 「临时补记」提示条：把长期按医嘱吃的引导到 /dose-plan 计划页。
   ⚠️ 文字用 ink（≥4.5:1），底色用 tint（浅色），不用 --info-color 那种填充色写字。 */
.qf-dose-hint {
  background: var(--bg-tint-blue, #f4f8ff);
  border-left: 3px solid var(--info-color, #4fb6e8);
  border-radius: var(--radius-sm, 8px);
  padding: 8px 10px;
  margin-bottom: 12px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--info-ink, #17709b);
}
.qf-dose-hint a {
  color: var(--primary-color, #c44680);
  font-weight: 600;
  text-decoration: none;
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

/* ====== 子级 Tab 切换 ====== */
.sub-tab-bar {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.sub-tab-btn {
  padding: 5px 16px;
  border: 1.5px solid #e2e8f0;
  border-radius: 20px;
  background: white;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  transition: all .2s;
  white-space: nowrap;
}
.sub-tab-btn:hover { border-color: #c44680; color: #c44680; }
.sub-tab-btn.active {
  background: linear-gradient(135deg, #e879a0, #c44680);
  color: white;
  border-color: transparent;
}

/* 统计面板样式随组件走：见 views/StatsView/StatsPanel.vue */
</style>
