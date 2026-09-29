<template>
  <div class="wdc-card">
    <div class="wdc-header">
      <h3>本周变化</h3>
      <div class="wdc-week-nav">
        <button class="wdc-nav-btn" @click="shiftWeek(-1)" :disabled="displayWeek <= MIN_WEEK" aria-label="上一周">‹</button>
        <span class="wdc-week-label">第 {{ displayWeek }} 周</span>
        <button class="wdc-nav-btn" @click="shiftWeek(1)" :disabled="displayWeek >= MAX_WEEK" aria-label="下一周">›</button>
        <button v-if="!isCurrentWeek" class="wdc-back-btn" @click="goCurrentWeek">回到本周</button>
      </div>
    </div>

    <div v-if="!hasGestationalAge && isCurrentWeek" class="wdc-hint">
      设置孕周后将自动定位到当前周 · 可先用左右按钮浏览
    </div>

    <div class="wdc-body">
      <!-- 宝宝变化 -->
      <div class="wdc-block baby">
        <div class="wdc-block-title">
          <span class="wdc-block-icon">👶</span>
          <strong>宝宝变化</strong>
        </div>
        <div class="wdc-stats">
          <div class="wdc-stat">
            <span class="wdc-stat-value">{{ current.size }}</span>
            <span class="wdc-stat-label">大小类比（仅供趣味）</span>
          </div>
          <div class="wdc-stat">
            <span class="wdc-stat-value">{{ current.lengthText }}</span>
            <span class="wdc-stat-label">{{ current.lengthLabel }}</span>
          </div>
          <div class="wdc-stat" v-if="current.weightText">
            <span class="wdc-stat-value">{{ current.weightText }}</span>
            <span class="wdc-stat-label">平均体重</span>
          </div>
        </div>
        <p class="wdc-text">{{ current.baby }}</p>
      </div>

      <!-- 妈妈变化 -->
      <div class="wdc-block mom">
        <div class="wdc-block-title">
          <span class="wdc-block-icon">🤰</span>
          <strong>妈妈变化</strong>
        </div>
        <p class="wdc-text">{{ current.mom }}</p>
      </div>
    </div>

    <div class="wdc-footnote">
      身长体重为人群平均值，个体差异较大（孕20周前为头臀长、20周起为头脚长）；发育进度以产检超声评估为准。
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGestationalAge } from '@/composables/useGestationalAge'

const MIN_WEEK = 4
const MAX_WEEK = 40

const { age } = useGestationalAge()
const hasGestationalAge = computed(() => !!age.value && !age.value.isPrePregnancy && !age.value.isOverdue)

/** 当前实际孕周（钳制在 4~40）；浏览用的周数，默认跟随实际孕周 */
const currentRealWeek = computed(() => {
  const w = age.value?.weeks ?? 0
  return Math.min(Math.max(w, MIN_WEEK), MAX_WEEK)
})
const browsingWeek = ref<number | null>(null)
const displayWeek = computed(() => browsingWeek.value ?? currentRealWeek.value)
const isCurrentWeek = computed(() => browsingWeek.value === null)

// 孕周变化时（跨天/数据加载）清掉浏览态，回到本周
watch(currentRealWeek, () => { browsingWeek.value = null })

function shiftWeek(delta: number) {
  const next = displayWeek.value + delta
  if (next < MIN_WEEK || next > MAX_WEEK) return
  browsingWeek.value = next
}
function goCurrentWeek() { browsingWeek.value = null }

interface WeekEntry {
  size: string          // 大小类比
  lengthText: string    // 身长显示
  lengthLabel: string   // 测量口径
  weightText?: string   // 体重显示（8 周起有）
  baby: string          // 宝宝变化
  mom: string           // 妈妈变化
}

// 数据口径：
// - 身长/体重：逐周平均表（BabyCenter/Dr. Curran 表与台湾健康医疗网表互校，与人卫《妇产科学》
//   教材里程碑周值一致：12周末初具外生殖器、16周末约120g自觉胎动、20周末约320g可闻胎心、
//   24周末约630g、28周末约1000g、32周末约1700g、36周末约2500g、40周末约3400g）。
// - ≤19 周为头臀长（CRL，坐高），≥20 周为头脚长（全身）——与产检超声口径一致，逐周表通用做法。
// - 发育要点：人卫《妇产科学》第9版「胚胎/胎儿发育特征」+ 标准胚胎学事实，不做臆测。
const WEEK_DATA: Record<number, WeekEntry> = {
  4: {
    size: '一粒芝麻', lengthText: '约 0.1 cm', lengthLabel: '胚泡大小',
    baby: '受精卵已完成着床，羊膜腔开始形成。现在的"宝宝"还是一个叫胚泡的小细胞球，悄悄把自己埋进子宫内膜里。',
    mom: '月经没有如期到来——这是最早也是最容易被注意到的信号。有人会有少量着床出血，容易被误认为月经，别紧张。',
  },
  5: {
    size: '一粒芝麻', lengthText: '约 0.2 cm', lengthLabel: '胚芽大小',
    baby: '神经管开始形成——它将来会发育成大脑和脊髓。心脏的雏形也在这一周出现，是最早工作的器官。',
    mom: '乳房开始胀痛敏感、容易疲劳嗜睡。晨起恶心可能悄悄出现，很多准妈妈这周首先感觉到的是"特别困"。',
  },
  6: {
    size: '一颗扁豆', lengthText: '约 0.5 cm', lengthLabel: '胚芽大小',
    baby: '原始心管开始搏动——阴道超声已经能看到小小的心跳。小肢芽出现，大脑快速分化成几个脑泡。',
    mom: '孕吐可能开始登场（晨起恶心最典型），夜里起夜次数变多，情绪也容易起伏。少量多餐、随身备点苏打饼干能舒服些。',
  },
  7: {
    size: '一颗蓝莓', lengthText: '约 1.3 cm', lengthLabel: '头臀长（坐高）',
    baby: '大脑半球形成，面部的眼、耳、鼻开始显形，上肢的发育比下肢快，小手臂先"长"出来了。',
    mom: '孕激素让肠蠕动变慢，便秘和胀气开始常见；唾液可能变多。多喝水、多吃蔬果粗粮，比硬憋着管用。',
  },
  8: {
    size: '一颗葡萄', lengthText: '约 1.6 cm', lengthLabel: '头臀长（坐高）', weightText: '约 1 g',
    baby: '初具人形：能分辨眼、耳、鼻、口，手指和脚趾开始分岔，腕部和踝部成形。教科书上"胚胎期"到此结束。',
    mom: '子宫大约有拳头大了（肚子还看不出来）。孕吐进入高发前夜，闻到油烟味就想吐是正常现象，别怀疑自己。',
  },
  9: {
    size: '一颗樱桃', lengthText: '约 2.3 cm', lengthLabel: '头臀长（坐高）', weightText: '约 2 g',
    baby: '"小尾巴"消失了，眼睑形成并闭合，眼、耳、鼻、口五官俱全，所有主要器官的雏形都已就位。',
    mom: '情绪波动是这周的关键词——激素在坐过山车，忽喜忽悲不是矫情。部分人开始鼻塞（孕期鼻炎），睡觉垫高枕头能缓解。',
  },
  10: {
    size: '一颗杏子', lengthText: '约 3.1 cm', lengthLabel: '头臀长（坐高）', weightText: '约 4 g',
    baby: '正式从"胚胎"升级为"胎儿"。重要器官开始工作：肝脏分泌胆汁、肾脏开始产尿，指甲也从指床上冒头了。',
    mom: '乳房继续增大、乳晕颜色变深。体重变化还不大，但腰身的裤子可能悄悄变紧了——是子宫和血容量在涨。',
  },
  11: {
    size: '一颗无花果', lengthText: '约 4.1 cm', lengthLabel: '头臀长（坐高）', weightText: '约 7 g',
    baby: '头部仍约占身长的一半。骨骼从软骨开始变硬（骨化），横膈膜发育——TA 可能已经开始打嗝了。',
    mom: '早孕反应接近尾声，恶心渐渐缓解，食欲开始恢复。头发和指甲可能长得比平时快，这是好事。',
  },
  12: {
    size: '一颗李子', lengthText: '约 5.4 cm', lengthLabel: '头臀长（坐高）', weightText: '约 14 g',
    baby: '肠道回位腹腔完成，手指可以开合了，外生殖器已经发育（不过 B 超下分辨性别通常还要等几周）。宝宝会打哈欠了。',
    mom: '早孕反应明显减轻，早期流产风险显著降低——很多人选在这周公开怀孕的好消息。子宫升出骨盆，小腹开始有弧度。',
  },
  13: {
    size: '一颗桃子', lengthText: '约 7 cm', lengthLabel: '头臀长（坐高）', weightText: '约 23 g',
    baby: '指纹的独特纹路开始形成——全世界独一份。乳牙的牙胚在牙龈里就位，宝宝会吞咽羊水了。',
    mom: '进入孕中期舒适期：精力恢复、心情回稳。血容量大增，可能有轻微鼻出血或牙龈出血，别慌，用软毛牙刷。',
  },
  14: {
    size: '一颗柠檬', lengthText: '约 14.7 cm', lengthLabel: '头脚长（全身）', weightText: '约 43 g',
    baby: '从这周起量"全身长"了。面部肌肉开始做鬼脸，全身覆盖细软的毳毛，肾脏持续产尿进入羊水。',
    mom: '孕吐基本成为过去式，胃口大开——但注意是"两个人"不是"两人份"，孕中期每天只需多约 300 大卡。',
  },
  15: {
    size: '一个苹果', lengthText: '约 16.7 cm', lengthLabel: '头脚长（全身）', weightText: '约 70 g',
    baby: '隔着肚皮能感知光线了（亮光会让 TA 转身避开），骨骼继续变硬，会吸吮自己的手指。',
    mom: '腹部隆起更明显，腹部中线色素沉着可能出现（一条深色竖线，产后会淡）。部分人开始感到韧带牵拉痛，起身慢一点。',
  },
  16: {
    size: '一个牛油果', lengthText: '约 18.6 cm', lengthLabel: '头脚长（全身）', weightText: '约 100 g',
    baby: '听觉开始发育，能感知子宫外的声音（低频更敏感）。教科书节点：16 周末体重约 100~120g，不少准妈妈开始隐约感到胎动。',
    mom: '经产妇可能已经感到胎动（像小鱼吐泡、蝴蝶扇翅），初产妇多数还要等到 18~20 周。第一次感到胎动记得记下日期，产检医生会问。',
  },
  17: {
    size: '一个石榴', lengthText: '约 20.4 cm', lengthLabel: '头脚长（全身）', weightText: '约 140 g',
    baby: '脂肪开始沉积（棕色脂肪，为体温做准备），胸腔练习"呼吸"动作——让羊水进出肺部，为出生后第一口气排练。',
    mom: '食欲大增、体重增长开始加快。夜间小腿抽筋如果出现，多半和钙、镁需求上升有关——补钙请先问产检医生。',
  },
  18: {
    size: '一个甜椒', lengthText: '约 22.2 cm', lengthLabel: '头脚长（全身）', weightText: '约 190 g',
    baby: '骨骼在 X 光下已经清晰可见（骨化明显），耳廓成形立起，形成了自己的活动与睡眠节律。',
    mom: '重心前移带来腰背酸痛，站久坐久都不舒服。起身时头晕（血压变化）也可能出现——动作放慢，避免久蹲猛起。',
  },
  19: {
    size: '一个芒果', lengthText: '约 24 cm', lengthLabel: '头脚长（全身）', weightText: '约 240 g',
    baby: '大脑开始分化专职区域（嗅觉、味觉、触觉、视觉各归其位），皮肤上覆盖一层白色胎脂，像天然润肤霜保护皮肤不被羊水泡皱。',
    mom: '肚皮开始发痒（被撑开拉伸），可以涂温和的润肤霜。乳晕和腹部中线的色素沉着更明显了，都是暂时的。',
  },
  20: {
    size: '一个香蕉', lengthText: '约 25.7 cm', lengthLabel: '头脚长（全身）', weightText: '约 300 g',
    baby: '孕期过半啦！吞咽变活跃，消化系统开始工作（吞羊水、肠道里积攒胎便），听力更敏锐，产检时医生已能用听诊器听到胎心。',
    mom: '宫底大约到肚脐位置，肚子明显凸出。坐卧时留意姿势，左侧卧更利于循环（不必整夜强求，怎么舒服怎么睡）。',
  },
  21: {
    size: '一根胡萝卜', lengthText: '约 27.4 cm', lengthLabel: '头脚长（全身）', weightText: '约 360 g',
    baby: '眉毛眼睑清晰可见，动作更协调有力，小手已经能抓住自己的小脚丫玩了。',
    mom: '胎动越来越明显、越来越有规律。腿部抽筋和手部发麻（腕管综合征）在这一阶段很常见，别提重物、睡觉垫高手腕有帮助。',
  },
  22: {
    size: '一个木瓜', lengthText: '约 29 cm', lengthLabel: '头脚长（全身）', weightText: '约 430 g',
    baby: '五官轮廓分明，触觉发达——TA 会摸自己的脸和脐带。内耳的平衡器官发育完成，能感知自己在子宫里的姿势。',
    mom: '肚脐可能被顶得外凸（产后会回去），阴道分泌物增多是孕期正常现象。若分泌物颜色异常伴瘙痒，产检时告诉医生。',
  },
  23: {
    size: '一个大芒果', lengthText: '约 30.6 cm', lengthLabel: '头脚长（全身）', weightText: '约 500 g',
    baby: '听力更上一层楼——已经熟悉妈妈的心跳、肠胃蠕动声和你的说话声。肺部开始生产表面活性物质（虽然还不够）。',
    mom: '脚踝傍晚轻度水肿、痔疮风险上升（子宫压迫+便秘）。控盐、多饮水、别久站，水肿早起不退或突然加重要告诉医生。',
  },
  24: {
    size: '一个玉米棒', lengthText: '约 32.2 cm', lengthLabel: '头脚长（全身）', weightText: '约 600 g',
    baby: '教科书节点：24 周末各脏器均已发育。肺泡还在成熟（这是"存活边界期"，出生需 NICU 支持），味蕾已经形成。',
    mom: '这一两周要做糖耐量试验（24~28 周），筛查妊娠期糖尿病——按医院要求空腹去。胃灼热开始常见：少吃多餐、饭后别立刻躺。',
  },
  25: {
    size: '一个花菜', lengthText: '约 33.7 cm', lengthLabel: '头脚长（全身）', weightText: '约 660 g',
    baby: '头发开始有了颜色和质地，小手握拳很有力，脊柱的支撑力加强，在子宫里翻滚更有劲了。',
    mom: '激素让头发变得浓密有光泽（产后再脱落别慌）。睡眠开始变浅，找个好用的孕妇枕试试，侧睡夹在腿间会舒服很多。',
  },
  26: {
    size: '一颗生菜', lengthText: '约 35.1 cm', lengthLabel: '头脚长（全身）', weightText: '约 760 g',
    baby: '眼睑开始睁开，眼睛能转动了，对突然的声音会有惊跳反应。神经元连接快速加密，抓握也更熟练。',
    mom: '子宫上移顶到肋骨，呼吸偶尔变浅、肋骨发胀。稀发无痛的假性宫缩（肚子偶尔发紧）可能出现——休息后缓解就正常。',
  },
  27: {
    size: '一个甜瓜', lengthText: '约 36.6 cm', lengthLabel: '头脚长（全身）', weightText: '约 875 g',
    baby: '会吸吮大拇指了，大脑出现和新生儿类似的活跃睡眠（可能"会做梦"），肺在持续成熟中。',
    mom: '孕晚期倒计时开始。呼吸短促、腿抽筋常见；睡觉时上半身垫高一点、白天别走太久，能明显舒服一些。',
  },
  28: {
    size: '一个茄子', lengthText: '约 37.6 cm', lengthLabel: '头脚长（全身）', weightText: '约 1.0 kg',
    baby: '教科书节点：28 周末体重约 1000g。眼睛能睁能闭、会眨眼，脂肪层继续增厚，大脑沟回进入快速生长期。',
    mom: '正式进入孕晚期：产检从每月一次改为每两周一次。这阶段会查血常规盯贫血——铁的需求大增，遵医嘱补铁补钙。',
  },
  29: {
    size: '一个南瓜', lengthText: '约 39.3 cm', lengthLabel: '头脚长（全身）', weightText: '约 1.15 kg',
    baby: '骨骼完全硬化中（大量需要钙——记得每天喝奶），大脑头围增长加快，隔着肚皮强光照射时会有反应。',
    mom: '体重增长进入高峰期，烧心和便秘随行。胎动已经规律——从现在起每天数胎动是好习惯（早晚各数 1 小时）。',
  },
  30: {
    size: '一个大白菜', lengthText: '约 40.5 cm', lengthLabel: '头脚长（全身）', weightText: '约 1.3 kg',
    baby: '眼睛有了调节聚焦的能力，大脑皮层沟回明显，骨髓正式接管红细胞的制造工作。',
    mom: '胃被顶得吃几口就饱——改用少食多餐。水肿加重、可能看到静脉曲张，睡前抬高双腿 15 分钟有缓解。',
  },
  31: {
    size: '一个椰子', lengthText: '约 41.8 cm', lengthLabel: '头脚长（全身）', weightText: '约 1.5 kg',
    baby: '五官开始"协调动作"：转头、推、踢一气呵成，皮下脂肪积累让皮肤不再皱巴巴。',
    mom: '耻骨和腰骶的酸痛感加深（松弛素让骨盆韧带变松），翻身、上下床都放慢动作。夜醒频繁——趁白天补个短觉。',
  },
  32: {
    size: '一个哈密瓜', lengthText: '约 43 cm', lengthLabel: '头脚长（全身）', weightText: '约 1.7 kg',
    baby: '教科书节点：32 周末体重约 1700g、皮肤深红皱褶开始消退。大部分宝宝开始转为头朝下的姿势，"呼吸"练习更规律。',
    mom: '这次产检（30~32 周）会评估胎位——现在还不是头位也别急，多数会在 34~36 周自然转过来。假性宫缩更频繁了。',
  },
  33: {
    size: '一个菠萝', lengthText: '约 44.1 cm', lengthLabel: '头脚长（全身）', weightText: '约 1.9 kg',
    baby: '免疫系统开始通过胎盘从妈妈这里接收抗体——这份"免疫力存折"会持续到出生后。颅骨保持柔软以便分娩时变形通过。',
    mom: '手脚水肿达到小高峰，戒指先摘下来吧。容易疲劳就顺势多休息——孕晚期比拼的不是运动量，是体力管理。',
  },
  34: {
    size: '一个哈密瓜（更大）', lengthText: '约 45.3 cm', lengthLabel: '头脚长（全身）', weightText: '约 2.1 kg',
    baby: '肺部表面活性物质大量增加（出生后自主呼吸的关键），脂肪层已经厚到能自己保暖，中枢神经系统日趋成熟。',
    mom: '开始留意入盆信号：初产妇多在 36 周前后入盆——入盆后胃口和呼吸会松快些，但尿频和下坠感会加重。',
  },
  35: {
    size: '一个蜜瓜', lengthText: '约 46.3 cm', lengthLabel: '头脚长（全身）', weightText: '约 2.4 kg',
    baby: '体重进入快速增长期（每周可长 200g 以上），肾脏发育完全成熟，肝脏也能处理代谢废物了。',
    mom: '宫高接近顶点，胃灼热和呼吸短促最明显——就快熬出头了。把待产包准备好，随时可能用上。',
  },
  36: {
    size: '一颗长叶莴苣', lengthText: '约 47.3 cm', lengthLabel: '头脚长（全身）', weightText: '约 2.6 kg',
    baby: '教科书节点：36 周末体重约 2500g、指(趾)甲到达指(趾)端。胎毛和胎脂开始脱落，吞进羊水里——吸吮、吞咽、呼吸三个动作已经协调。',
    mom: '产检改为每周一次。初产妇大多这周前后入盆：呼吸和胃口突然变轻松、走路有下坠感——都是好消息。',
  },
  37: {
    size: '一捆瑞士甜菜', lengthText: '约 48.3 cm', lengthLabel: '头脚长（全身）', weightText: '约 2.9 kg',
    baby: '足月了！抓握有力，激素分泌帮助肺部做最后成熟，初产宝宝多数已经入盆，随时可以发动。',
    mom: '从现在起任何一天都可能见面。复习临产信号：规律宫缩（5~6 分钟一次）、见红、破水——破水后平躺垫高臀部立即就医。',
  },
  38: {
    size: '一根韭菜（长）', lengthText: '约 49.3 cm', lengthLabel: '头脚长（全身）', weightText: '约 3.1 kg',
    baby: '所有器官全部就绪，肠道里攒好了胎便（出生后 24 小时内的第一次排便）。大脑和肺还在持续完善——多待一天都赚。',
    mom: '进入"随时待命"模式：水肿、疲劳、睡不好都是常态。规律宫缩或破水立即出发医院；不规律宫缩休息观察即可。',
  },
  39: {
    size: '一个小西瓜', lengthText: '约 50.1 cm', lengthLabel: '头脚长（全身）', weightText: '约 3.3 kg',
    baby: '大脑仍在快速发育——研究显示在宫内多待两天，脑发育收益可观（没动静别急着催）。脂肪厚度足够维持体温。',
    mom: '留意临产三信号：见红、规律宫缩、破水。吃好睡好攒体力，每天数胎动，有异常（胎动骤减）立即就医。',
  },
  40: {
    size: '一个小西瓜（足斤）', lengthText: '约 51 cm', lengthLabel: '头脚长（全身）', weightText: '约 3.4 kg',
    baby: '发育成熟、整装待发：胎毛基本褪净，胎盘仍在源源不断供氧供营养，直到出生那一刻。',
    mom: '预产期到了——但只有约 5% 的宝宝踩点出生，推迟 1~2 周内都正常。超过 41 周医生会评估引产，遵医嘱即可。',
  },
}

const current = computed<WeekEntry>(() => WEEK_DATA[displayWeek.value] ?? WEEK_DATA[4])
</script>

<style scoped>
.wdc-card {
  background: #fff;
  border-radius: 14px;
  padding: 16px 18px;
  margin-bottom: 16px;
  border: 1px solid #f0e6ee;
}
.wdc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.wdc-header h3 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: #1f1730;
}
.wdc-week-nav {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wdc-week-label {
  font-size: 13px;
  font-weight: 700;
  color: #c44680;
  min-width: 62px;
  text-align: center;
}
.wdc-nav-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid #e8dfe6;
  background: #faf6f9;
  color: #862952;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wdc-nav-btn:disabled { opacity: 0.35; cursor: default; }
.wdc-back-btn {
  border: none;
  background: none;
  color: #3a86c8;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
}

.wdc-hint {
  font-size: 12px;
  color: #999;
  background: #f8f4f7;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
}

.wdc-body { display: flex; flex-direction: column; gap: 10px; }
.wdc-block {
  border-radius: 10px;
  padding: 12px 14px;
}
.wdc-block.baby { background: #f4f8ff; border-left: 3px solid #3a86c8; }
.wdc-block.mom  { background: #fdf2f6; border-left: 3px solid #c44680; }
.wdc-block-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.wdc-block-title strong { font-size: 14px; color: #1f1730; }
.wdc-block-icon { font-size: 16px; }

.wdc-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.wdc-stat {
  background: #fff;
  border-radius: 8px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border: 1px solid #eef1f6;
}
.wdc-stat-value { font-size: 13px; font-weight: 700; color: #1f6aa8; }
.wdc-stat-label { font-size: 10.5px; color: #8a94a6; }
.wdc-block.mom .wdc-stat-value { color: #c44680; }

.wdc-text {
  font-size: 13.5px;
  line-height: 1.65;
  color: #444;
  margin: 0;
}

.wdc-footnote {
  margin-top: 10px;
  font-size: 11px;
  color: #aaa;
  line-height: 1.6;
}
</style>
