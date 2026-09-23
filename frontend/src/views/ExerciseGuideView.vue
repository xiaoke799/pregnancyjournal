<template>
  <div class="exercise-guide">
    <!-- 顶部介绍 -->
    <div class="eg-header">
      <span class="eg-icon">🤸</span>
      <div class="eg-title">
        <h2>孕期运动指南</h2>
        <p>科学运动，助力顺产 · 根据孕周自动推荐</p>
      </div>
    </div>

    <!-- 当前阶段推荐卡片 -->
    <div class="eg-current-stage" :class="'stage-' + stageKey">
      <div class="stage-label">当前阶段</div>
      <h3>{{ currentStage.name }}</h3>
      <p class="stage-desc">{{ currentStage.desc }}</p>
      <div class="stage-tags">
        <n-tag v-for="ex in currentStage.exercises" :key="ex" size="small" :type="currentStage.tagType" round>{{ ex }}</n-tag>
      </div>
    </div>

    <!-- 各阶段详情 -->
    <n-collapse :default-expanded-names="[stageKey]" accordion>
      <!-- 孕早期 -->
      <n-collapse-item name="early" title="🌱 孕早期（1~3个月）">
        <div class="eg-tip eg-tip-info">
          <span class="tip-icon">💡</span>
          <span><strong>原则</strong>胚胎着床未稳，以"缓慢、低强度"为主，避免腹部震动。</span>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🚶</span><strong>散步</strong> <n-tag size="tiny" type="warning">首选</n-tag></div>
          <p>最安全的运动方式。步伐放缓，每次15~30分钟，饭后稍作休息再进行。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🎵</span><strong>运动胎教</strong> <n-tag size="tiny" type="default">胎教同步</n-tag></div>
          <p>从孕8周开始，轻柔活动身体，通过羊水传递运动感刺激胎儿感官发育。可结合音乐胎教。</p>
        </div>

        <div class="eg-tip eg-tip-warn">
          <span class="tip-icon">⚠️</span>
          <span><strong>注意</strong>避免剧烈跑跳、仰卧起坐、腹部用力；若有出血、腹痛立即停止并就医。</span>
        </div>
        <div class="eg-tip eg-tip-good">
          <span class="tip-icon">⚖️</span>
          <span><strong>体重管理</strong>整个孕期增重12~14kg为宜，孕早期即开始控制。</span>
        </div>
      </n-collapse-item>

      <!-- 孕中期 -->
      <n-collapse-item name="mid" title="🏊 孕中期（4~7个月）">
        <div class="eg-tip eg-tip-good">
          <span class="tip-icon">✅</span>
          <span><strong>运动黄金期</strong>胎儿状况稳定，可主动参加适度运动——控制体重、提高抵抗力、改善妊娠不适、加强骨盆腰部肌肉。</span>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🏊</span><strong>游泳</strong> <n-tag size="tiny" type="info">最佳全身运动</n-tag></div>
          <p>锻炼全身，减轻关节负担，缓解水肿和腰痛，放松子宫，强化心肺功能，可提高顺产概率。</p>
          <ul class="card-steps">
            <li>下水前淋浴热身，做基础体操放松身体</li>
            <li>分腿弯曲练习 + 分娩呼吸法（呼、哈）</li>
            <li>自由行走或轻跳使脉搏渐快</li>
            <li>结束后伸展胳膊肩膀跟腱收尾</li>
          </ul>
          <div class="eg-tip eg-tip-danger" style="margin-top:8px">
            <span class="tip-icon">🚫</span>
            <span><strong>禁止蝶泳</strong>会使后背下部严重拱起，拉伤肩膀。</span>
          </div>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🌿</span><strong>散步</strong> <n-tag size="tiny" type="success">每日必做</n-tag></div>
          <p>每天坚持，预防静脉曲张。<strong>下午4~5点</strong>最佳，阳光适宜草木释氧最强。中后期多走动利于顺产。外出需家人陪同。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">💃</span><strong>有氧操</strong> <n-tag size="tiny" type="warning">改善情绪</n-tag></div>
          <p>释放压力促进血清素分泌，动作以舒展为主，不要大幅度跳跃。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🤸</span><strong>背肩缓解运动</strong> <n-tag size="tiny" type="default">对症运动</n-tag></div>
          <p>韧带疼痛、背肩不适时通过专项拉伸缓解腰背酸胀，保持身体灵活性。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🧘</span><strong>普拉提 — 伸展四肢</strong> <n-tag size="tiny" type="info">核心锻炼</n-tag></div>
          <p>平躺配合腹式呼吸，交替互换四肢姿势，重复5~10次：</p>
          <ol class="card-steps">
            <li>平躺，左腿伸直右腿屈膝，右臂上伸左臂放体侧</li>
            <li>腹式深吸气</li>
            <li>呼气时互换双臂双腿姿势</li>
            <li>重复5~10次</li>
          </ol>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🌸</span><strong>孕妇瑜伽 / 太极拳</strong> <n-tag size="tiny" type="success">降压放松</n-tag></div>
          <p>使全身肌肉放松，对妊娠期高血压尤其有益，也缓解紧张情绪改善睡眠。</p>
        </div>
      </n-collapse-item>

      <!-- 孕晚期 -->
      <n-collapse-item name="late" title="🧘 孕晚期（8~9个月）">
        <div class="eg-tip eg-tip-warn">
          <span class="tip-icon">⚠️</span>
          <span><strong>原则</strong>不走太远、不站太久。"不疲劳、不剧烈"为前提，头晕气短立即停止就医。</span>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🦵</span><strong>普拉提 — 减轻水肿</strong> <n-tag size="tiny" type="default">推荐</n-tag></div>
          <p>呼吸不畅或手脚腕水肿时推荐：</p>
          <div class="step-grid">
            <div class="step-block">
              <strong>靠墙抬腿</strong>
              <ol>
                <li>垫高头部，臀部贴近墙壁</li>
                <li>双腿伸至墙上端，保持5分钟</li>
                <li>双腿分开至有拉伸感，再保持5分钟</li>
              </ol>
            </div>
            <div class="step-block">
              <strong>抬腿拉伸</strong>
              <ol>
                <li>靠墙坐，两腿前伸，右腿下垫枕头</li>
                <li>左脚贴地屈膝，慢慢伸直右腿</li>
                <li>脚趾向上对脚后跟用力，重复10次后换腿</li>
              </ol>
            </div>
            <div class="step-block">
              <strong>骨盆转动</strong>
              <ol>
                <li>呼气时弯曲双膝放松关节</li>
                <li>吸气时髋关节由右向左转动6~10圈</li>
                <li>反方向同样练习</li>
              </ol>
            </div>
          </div>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">💪</span><strong>凯格尔运动（盆底肌）</strong> <n-tag size="tiny" type="error">改善漏尿</n-tag></div>
          <p>规律盆底肌锻炼，减少痔疮不适、预防漏尿，需长期坚持：</p>
          <ol class="card-steps">
            <li>全身放松，夹紧臀部和大腿</li>
            <li>深呼吸：吸气时提收肛门</li>
            <li>呼气时放松，一提一松为一次</li>
            <li>每次20~30次，每日3~5次</li>
          </ol>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🤱</span><strong>缩紧阴道 + 分腿助产</strong> <n-tag size="tiny" type="warning">临产助力</n-tag></div>
          <p>降低尿失禁发生概率：</p>
          <div class="step-grid">
            <div class="step-block">
              <strong>缩紧阴道</strong>
              <ol>
                <li>平躺吸气，从肛门尽量紧缩阴道</li>
                <li>力量不要分散到其他部位</li>
                <li>呼气慢慢放松，吸气数到8</li>
                <li>重复5次后侧躺休息</li>
              </ol>
            </div>
            <div class="step-block">
              <strong>分腿运动</strong>
              <ol>
                <li>平躺将膝盖向上举</li>
                <li>呼气同时按住膝盖抬起上半身</li>
                <li>动作缓慢，不要用力过猛</li>
              </ol>
            </div>
          </div>
        </div>

        <div class="eg-card">
          <div class="card-head"><span class="card-icon">🌳</span><strong>散步 + 瑜伽</strong></div>
          <p>白天适当运动促进血液循环，避免站太久走太多。职场孕妈每工作1小时活动5分钟，双脚抬高缓解疲劳。</p>
        </div>
      </n-collapse-item>

      <!-- 临产前 -->
      <n-collapse-item name="prepartum" title="🏃 临产前（孕10月）">
        <div class="eg-tip eg-tip-good">
          <span class="tip-icon">🎯</span>
          <span><strong>尚未入盆？多运动！</strong>在医生建议下多运动有利于胎儿入盆。</span>
        </div>

        <div class="phase-grid">
          <div class="phase-item orange">
            <strong>🏗️ 爬楼梯</strong>
            <p>锻炼大腿臀肌群，帮助入盆，促第一产程到来</p>
          </div>
          <div class="phase-item green">
            <strong>⛰️ 爬小山包</strong>
            <p>午后14~16点氧气最强，借爬山充氧，累了就休息</p>
          </div>
          <div class="phase-item blue">
            <strong>🚶 散步+上下楼梯</strong>
            <p>过了预产期仍可促进分娩，催产素分泌</p>
          </div>
          <div class="phase-item purple">
            <strong>🌬️ 腹式呼吸法</strong>
            <p>脊背挺直，鼻吸腹鼓，呼气更慢更用力</p>
          </div>
          <div class="phase-item pink">
            <strong>🤲 拉梅兹呼吸法</strong>
            <p>胸部→浅喘→喘息→哈气四阶段应对产程</p>
          </div>
          <div class="phase-item yellow">
            <strong>⚽ 分娩球操</strong>
            <p>弓步举球+挺胸落球，打开盆腔空间</p>
          </div>
        </div>

        <div class="eg-tip eg-tip-warn">
          <span class="tip-icon">👨</span>
          <span><strong>必须有家人陪同</strong>外出爬楼梯/爬山/散步时确保安全，紧急情况立即送医。</span>
        </div>
      </n-collapse-item>

      <!-- 运动禁忌 -->
      <n-collapse-item name="forbid" title="🚫 运动禁忌 & 停止信号">
        <div style="font-weight:600;margin-bottom:8px;color:#e8627a;">出现以下症状，立即停止运动并就医：</div>
        <div class="signal-list">
          <n-tag v-for="s in stopSignals" :key="s" type="error" size="small" round bordered>{{ s }}</n-tag>
        </div>

        <div style="font-weight:600;margin:16px 0 8px;">需要完全卧床避免运动的情况：</div>
        <div class="forbid-grid">
          <div class="forbid-item" v-for="f in forbidItems" :key="f.icon">
            <span class="fi-icon">{{ f.icon }}</span>
            <strong>{{ f.title }}</strong>
            <small>{{ f.desc }}</small>
          </div>
        </div>

        <div class="eg-tip eg-tip-info" style="margin-top:12px">
          <span class="tip-icon">💡</span>
          <span><strong>养胎不必整天卧床</strong>长期卧床会导致抑郁、便秘、下肢血液不畅甚至静脉血栓。除非有明确禁忌，否则都应适量运动。</span>
        </div>
      </n-collapse-item>

      <!-- 特殊场景 -->
      <n-collapse-item name="special" title="🏙️ 特殊场景建议">
        <div class="phase-grid">
          <div class="phase-item blue">
            <strong>🏢 住高楼</strong>
            <p>电梯与楼梯结合使用，孕晚期爬楼梯助入盆</p>
          </div>
          <div class="phase-item green">
            <strong>💼 职场孕妈</strong>
            <p>每1小时活动5分钟，双脚抬高，避免交叠双腿</p>
          </div>
          <div class="phase-item orange">
            <strong>❤️‍🩹 妊娠高血压</strong>
            <p>散步太极孕妇瑜伽降压，避免激烈导致血压波动</p>
          </div>
          <div class="phase-item pink">
            <strong>🌿 预防便秘</strong>
            <p>户外运动促进肠道蠕动，配合高纤维饮食</p>
          </div>
        </div>
      </n-collapse-item>
    </n-collapse>

    <!-- 底部声明 -->
    <div class="eg-footer">
      <p>内容来源：《协和医院产科专家·备孕怀孕营养胎教全书》马良坤 著</p>
      <p>仅供参考，具体方案请遵医嘱 · 不适请立即停止并就医</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCollapse, NCollapseItem, NTag } from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { useGestationalAge } from '@/composables/useGestationalAge'

const pregnancyStore = usePregnancyStore()
const { stageKey: rawStageKey } = useGestationalAge()

// 映射到折叠面板的 key
const stageKey = computed(() => {
  const key = rawStageKey.value
  if (key === 'preparing') return 'early'
  if (key === 'mid') return 'mid'
  return 'late' // late + nursing → late
})

const currentStage = computed(() => {
  const map: Record<string, any> = {
    early: {
      name: '孕早期（1~3月）',
      desc: '以缓慢为主，打好基础',
      exercises: ['缓慢散步', '运动胎教'],
      tagType: 'warning' as const,
    },
    mid: {
      name: '孕中期（4~7月）',
      desc: '胎儿稳定，运动黄金期',
      exercises: ['游泳', '散步', '普拉提', '有氧操', '瑜伽'],
      tagType: 'info' as const,
    },
    late: {
      name: '孕晚期（8~9月+）',
      desc: '减轻水肿，锻炼盆底，备战分娩',
      exercises: ['普拉提', '凯格尔', '散步', '提肛练习'],
      tagType: 'error' as const,
    },
  }
  return map[stageKey.value] || map.mid
})

const stopSignals = [
  '头晕', '气短', '腹部疼痛', '阴道出血', '羊水破裂', '胸痛', '肌肉无力', '小腿肿胀',
]

const forbidItems = [
  { icon: '🩸', title: '前置胎盘出血', desc: '必须卧床禁止任何活动' },
  { icon: '💉', title: '子痫前期', desc: '高血压危重情况需静卧' },
  { icon: '💧', title: '过早破水', desc: '立即平躺垫高臀部就医' },
  { icon: '🔒', title: '子宫颈闭锁不全', desc: '需要卧床静养' },
  { icon: '🦋', title: '蝶泳（全程禁止）', desc: '拉伤肩膀和后背下部' },
  { icon: '🏋️', title: '剧烈运动（全程）', desc: '造成子宫收缩流产风险' },
  { icon: '🦶', title: '脚底按摩', desc: '泡脚时禁止导致腹部不适' },
  { icon: '🤰', title: '仰卧时间过长', desc: '压迫血管影响血液循环' },
]
</script>

<style scoped>
.exercise-guide {
  padding: 0 0 24px;
}

/* ── 头部 ── */
.eg-header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 18px;
  background: linear-gradient(135deg, #e8627a, #f4a261, #4a9b7f);
  border-radius: 14px;
  color: #fff;
  margin-bottom: 16px;
}
.eg-icon { font-size: 36px; }
.eg-title h2 { font-size: 20px; font-weight: 700; margin: 0 0 2px; }
.eg-title p { font-size: 13px; opacity: 0.88; margin: 0; }

/* ── 当前阶段卡片 ── */
.eg-current-stage {
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 16px;
  color: #fff;
}
.eg-current-stage.stage-early { background: linear-gradient(135deg, #f4a261, #e8835a); }
.eg-current-stage.stage-mid { background: linear-gradient(135deg, #3a86c8, #1f6aa8); }
.eg-current-stage.stage-late { background: linear-gradient(135deg, #7c5cbf, #5e3d9e); }
.stage-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.75; }
.eg-current-stage h3 { font-size: 17px; font-weight: 700; margin: 4px 0 6px; }
.stage-desc { font-size: 13px; opacity: 0.9; margin: 0 0 10px; }
.stage-tags { display: flex; flex-wrap: wrap; gap: 6px; }

/* ── 提示框 ── */
.eg-tip {
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13.5px;
  line-height: 1.55;
  margin: 10px 0;
}
.eg-tip .tip-icon { font-size: 17px; flex-shrink: 0; margin-top: 1px; }
.eg-tip strong { font-size: 12.5px; }
.eg-tip-info   { background: #e8f2fb; border-left: 3px solid #3a86c8; color: #1a5276; }
.eg-tip-warn   { background: #fff3e0; border-left: 3px solid #ff9800; color: #e65100; }
.eg-tip-good   { background: #e8f5f0; border-left: 3px solid #4a9b7f; color: #1b5e20; }
.eg-tip-danger { background: #fce8ec; border-left: 3px solid #e8627a; color: #a31523; }

/* ── 运动卡片 ── */
.eg-card {
  background: #fafafa;
  border-radius: 10px;
  padding: 14px 16px;
  margin: 10px 0;
  border: 1px solid #eee;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.card-icon { font-size: 22px; }
.eg-card p { font-size: 13.5px; color: #555; line-height: 1.65; margin: 0; }
.card-steps, .card-steps ol {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 13px;
  color: #444;
  line-height: 1.7;
}
.card-steps li, .card-steps ol li { margin-bottom: 3px; }

/* ── 步骤网格 ── */
.step-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.step-block {
  background: #e8f2fb;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #c5def5;
}
.step-block strong { font-size: 14px; color: #1f6aa8; display: block; margin-bottom: 6px; }
.step-block ol { padding-left: 18px; margin: 0; font-size: 12.5px; line-height: 1.65; }
.step-block li { margin-bottom: 2px; }

/* ── 阶段网格（临产前/特殊场景）── */
.phase-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
  gap: 10px;
  margin-top: 10px;
}
.phase-item {
  border-radius: 10px;
  padding: 12px 14px;
  border-left: 3px solid;
}
.phase-item strong { font-size: 14px; display: block; margin-bottom: 4px; }
.phase-item p { font-size: 12px; color: #666; margin: 0; line-height: 1.5; }
.phase-item.orange { background: #fef3e8; border-color: #f4a261; }
.phase-item.green  { background: #e8f5f0; border-color: #4a9b7f; }
.phase-item.blue   { background: #e8f2fb; border-color: #3a86c8; }
.phase-item.purple { background: #f0ebfb; border-color: #7c5cbf; }
.phase-item.pink   { background: #fce8ec; border-color: #e8627a; }
.phase-item.yellow { background: #fff8e1; border-color: #f0b429; }

/* ── 停止信号 ── */
.signal-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* ── 禁忌网格 ── */
.forbid-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.forbid-item {
  background: #fce8ec;
  border: 1px solid #f3b8c3;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
}
.fi-icon { font-size: 24px; display: block; margin-bottom: 4px; }
.forbid-item strong { font-size: 13px; color: #e8627a; display: block; }
.forbid-item small { font-size: 11.5px; color: #888; display: block; margin-top: 2px; }

/* ── 底部声明 ── */
.eg-footer {
  text-align: center;
  padding: 20px 16px;
  margin-top: 20px;
  border-top: 1px solid #eee;
  font-size: 12px;
  color: #aaa;
  line-height: 1.7;
}
.eg-footer p { margin: 2px 0; }

/* ── Collapse 样式微调 ── */
:deep(.n-collapse-item__header) {
  font-size: 15px !important;
  font-weight: 700 !important;
  padding: 14px 4px !important;
}
:deep(.n-collapse-item__content-inner) {
  padding: 4px 0 16px !important;
}
</style>
