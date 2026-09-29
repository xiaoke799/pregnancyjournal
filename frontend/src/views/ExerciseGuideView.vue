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
      <p class="stage-goal">🎯 {{ currentStage.goal }}</p>
      <div class="stage-tags">
        <n-tag v-for="ex in currentStage.exercises" :key="ex" size="small" :type="currentStage.tagType" round>{{ ex }}</n-tag>
      </div>
    </div>

    <!-- 各阶段详情 -->
    <n-collapse :default-expanded-names="[stageKey]" accordion>
      <!-- 运动量标准 -->
      <n-collapse-item name="basics" title="先看这个：多少算合适？">
        <div class="eg-tip eg-tip-good">
          <span><strong>一句话标准</strong>健康孕妇每周累计 <strong>150 分钟中等强度</strong>运动，分摊到 3~5 天完成即可 —— 大约是"每天 30 分钟、每周 5 天"。这是 ACOG（美国妇产科学会）等主流孕期运动指南的共同建议。</span>
        </div>

        <div class="step-grid">
          <div class="step-block">
            <strong>每周</strong>
            <ol>
              <li>累计 <strong>150 分钟</strong>中等强度</li>
              <li>分摊到 3~5 天，不要"平时不动、周末猛练"</li>
              <li>体力好的可加到 300 分钟</li>
            </ol>
          </div>
          <div class="step-block">
            <strong>每次</strong>
            <ol>
              <li>从 <strong>10~15 分钟</strong>起步</li>
              <li>适应后加到 <strong>20~30 分钟</strong>（最易坚持）</li>
              <li>连续中等强度不宜超过 45 分钟</li>
            </ol>
          </div>
          <div class="step-block">
            <strong>怎么加量</strong>
            <ol>
              <li>孕前不运动的：从每天 5~10 分钟开始</li>
              <li>每周只比上周多 5 分钟，宁慢勿快</li>
              <li>出现不适就退回上一档，别硬撑</li>
            </ol>
          </div>
        </div>

        <div class="eg-tip eg-tip-warn" style="margin-top:12px">
          <span><strong>别把运动当成减肥手段</strong>孕期运动的目标是<strong>维持体能、控制增重速度、改善腰背不适与水肿、为分娩储备体力</strong>，而不是掉秤。体重增长目标是"长在合理区间"，不是越少越好。</span>
        </div>

        <div class="eg-tip eg-tip-info">
          <span><strong>增重参考（按孕前 BMI）</strong>偏瘦约 12.5~18 kg ｜ 正常体重约 11.5~16 kg ｜ 超重约 7~11.5 kg ｜ 肥胖约 5~9 kg。这只是参考区间，<strong>以产检医生的具体建议为准</strong>。</span>
        </div>
      </n-collapse-item>

      <!-- 强度自测 -->
      <n-collapse-item name="intensity" title="怎么判断强度？一个动作就够">
        <div class="eg-tip eg-tip-info">
          <span><strong>谈话测试（最实用）</strong>运动时<strong>能正常说话、但不能唱歌</strong>，就是合适的中等强度。不用买设备、不用算心率，随时能自测。</span>
        </div>

        <div class="phase-grid">
          <div class="phase-item green">
            <strong>🟢 偏轻松</strong>
            <p>能边动边流畅聊天、甚至唱歌。强度偏低，可适当加快一点。</p>
          </div>
          <div class="phase-item yellow">
            <strong>🟡 刚刚好（保持）</strong>
            <p>能说完整句子，但唱歌会喘；微微出汗、心跳加快、呼吸略急。这就是目标区间。</p>
          </div>
          <div class="phase-item pink">
            <strong>🔴 过头了（立刻减量）</strong>
            <p>说不出完整一句话、喘不上气、头晕胸闷。马上减速或停下休息。</p>
          </div>
        </div>

        <div class="eg-tip eg-tip-warn" style="margin-top:12px">
          <span><strong>关于"心率不超 140"</strong>这是很多年前的旧说法，现在已经不用单一心率数字来判断了 —— 每个人的基础心率差别很大。用上面的<strong>谈话测试</strong>更准也更省事。如果戴着手表，只要看趋势有没有比平时异常飙高即可，不必死磕某个数值。</span>
        </div>
      </n-collapse-item>

      <!-- 孕早期 -->
      <n-collapse-item name="early" title="孕早期（1~3个月）">
        <div class="eg-tip eg-tip-info">
          <span><strong>原则</strong>胚胎着床未稳，以"缓慢、低强度"为主，避免腹部震动与体温升高。</span>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>散步</strong> <n-tag size="tiny" type="warning">首选</n-tag></div>
          <p>最安全的运动方式。步伐放缓，每次15~30分钟，饭后稍作休息再进行。不必追求速度，走到身体微微发热、呼吸略快即可。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>孕妇瑜伽（温和版）</strong> <n-tag size="tiny" type="info">呼吸与放松</n-tag></div>
          <p>以呼吸练习和轻柔伸展为主，帮助身体提前适应，也能缓解早孕的紧张与焦虑。</p>
          <ul class="card-steps">
            <li>从孕期专门的入门动作开始，每次 15~20 分钟</li>
            <li>避开深度扭转、挤压腹部的体式，也不要长时间平躺</li>
            <li>有瑜伽基础的也要降一档强度；孕前没练过的先从教练带课开始</li>
          </ul>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>凯格尔运动（盆底肌）</strong> <n-tag size="tiny" type="success">越早越好</n-tag></div>
          <p>盆底肌锻炼<strong>孕早期就能开始</strong>，是整个孕期投入产出比最高的一项：防漏尿、减轻痔疮、为分娩和产后恢复打底。</p>
          <ol class="card-steps">
            <li>排空小便，全身放松，只收缩盆底肌（不要夹大腿或收腹）</li>
            <li>吸气时提收肛门与阴道，像"憋住尿"的感觉，保持 3~5 秒</li>
            <li>呼气放松，同样休息 3~5 秒</li>
            <li>每次 20~30 下，每天 3 次，坐着站着都能练</li>
          </ol>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>踝泵 + 抬腿</strong> <n-tag size="tiny" type="default">防血栓</n-tag></div>
          <p>孕早期就开始预防下肢水肿和静脉血栓，久坐久站的人尤其需要。</p>
          <div class="step-grid">
            <div class="step-block">
              <strong>踝泵（随时做）</strong>
              <ol>
                <li>坐着或躺着，脚尖用力向上勾，停 2 秒</li>
                <li>再用力向下绷，停 2 秒</li>
                <li>一小时做 20 次，办公时每小时提醒自己一轮</li>
              </ol>
            </div>
            <div class="step-block">
              <strong>靠墙抬腿（睡前）</strong>
              <ol>
                <li>臀部贴近墙壁，双腿搭在墙面上</li>
                <li>保持 5~10 分钟，让腿部血液回流</li>
                <li>起来时先侧身慢起，别直接坐起</li>
              </ol>
            </div>
          </div>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>靠墙站立 / 猫式伸展</strong> <n-tag size="tiny" type="default">缓解腰背</n-tag></div>
          <p>早孕就开始腰酸的人可以每天做：靠墙站立 3 分钟（后脑、肩胛、臀部贴墙，收紧小腹）；四肢着地做猫式伸展，吸气塌腰、呼气拱背，各 5~8 次。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>运动胎教</strong> <n-tag size="tiny" type="default">胎教同步</n-tag></div>
          <p>从孕8周开始，轻柔活动身体，通过羊水传递运动感刺激胎儿感官发育。可结合音乐胎教。</p>
        </div>

        <div class="eg-tip eg-tip-warn">
          <span><strong>注意</strong>避免剧烈跑跳、仰卧起坐、腹部用力；<strong>不要平躺过久</strong>（子宫压迫下腔静脉，容易头晕心慌）；<strong>远离热瑜伽、高温汗蒸</strong>——孕早期核心体温升高有风险。若有出血、腹痛立即停止并就医。</span>
        </div>
        <div class="eg-tip eg-tip-good">
          <span><strong>体重管理</strong>孕早期热量需求几乎不用增加，重点是别因为"一人吃两人补"而提前放量。具体增重区间见本文开头「先看这个」。</span>
        </div>
      </n-collapse-item>

      <!-- 孕中期 -->
      <n-collapse-item name="mid" title="孕中期（4~7个月）">
        <div class="eg-tip eg-tip-good">
          <span><strong>运动黄金期</strong>胎儿状况稳定，可主动参加适度运动——控制体重、提高抵抗力、改善妊娠不适、加强骨盆腰部肌肉。</span>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>游泳</strong> <n-tag size="tiny" type="info">最佳全身运动</n-tag></div>
          <p>锻炼全身，减轻关节负担，缓解水肿和腰痛，放松子宫，强化心肺功能，可提高顺产概率。</p>
          <ul class="card-steps">
            <li>下水前淋浴热身，做基础体操放松身体</li>
            <li>分腿弯曲练习 + 分娩呼吸法（呼、哈）</li>
            <li>自由行走或轻跳使脉搏渐快</li>
            <li>结束后伸展胳膊肩膀跟腱收尾</li>
          </ul>
          <div class="eg-tip eg-tip-danger" style="margin-top:8px">
            <span><strong>禁止蝶泳</strong>会使后背下部严重拱起，拉伤肩膀。</span>
          </div>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>散步</strong> <n-tag size="tiny" type="success">每日必做</n-tag></div>
          <p>每天坚持，预防静脉曲张。<strong>下午4~5点</strong>最佳，阳光适宜草木释氧最强。中后期多走动利于顺产。外出需家人陪同。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>有氧操</strong> <n-tag size="tiny" type="warning">改善情绪</n-tag></div>
          <p>释放压力促进血清素分泌，动作以舒展为主，不要大幅度跳跃。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>背肩缓解运动</strong> <n-tag size="tiny" type="default">对症运动</n-tag></div>
          <p>韧带疼痛、背肩不适时通过专项拉伸缓解腰背酸胀，保持身体灵活性。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>普拉提 — 伸展四肢</strong> <n-tag size="tiny" type="info">核心锻炼</n-tag></div>
          <p>平躺配合腹式呼吸，交替互换四肢姿势，重复5~10次：</p>
          <ol class="card-steps">
            <li>平躺，左腿伸直右腿屈膝，右臂上伸左臂放体侧</li>
            <li>腹式深吸气</li>
            <li>呼气时互换双臂双腿姿势</li>
            <li>重复5~10次</li>
          </ol>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>孕妇瑜伽 / 太极拳</strong> <n-tag size="tiny" type="success">降压放松</n-tag></div>
          <p>使全身肌肉放松，对妊娠期高血压尤其有益，也缓解紧张情绪改善睡眠。</p>
        </div>
      </n-collapse-item>

      <!-- 孕晚期 -->
      <n-collapse-item name="late" title="孕晚期（8~9个月）">
        <div class="eg-tip eg-tip-warn">
          <span><strong>原则</strong>不走太远、不站太久。"不疲劳、不剧烈"为前提，头晕气短立即停止就医。</span>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>普拉提 — 减轻水肿</strong> <n-tag size="tiny" type="default">推荐</n-tag></div>
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
          <div class="card-head"><strong>凯格尔运动（盆底肌）</strong> <n-tag size="tiny" type="error">改善漏尿</n-tag></div>
          <p>规律盆底肌锻炼，减少痔疮不适、预防漏尿，需长期坚持：</p>
          <ol class="card-steps">
            <li>全身放松，夹紧臀部和大腿</li>
            <li>深呼吸：吸气时提收肛门</li>
            <li>呼气时放松，一提一松为一次</li>
            <li>每次20~30次，每日3~5次</li>
          </ol>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>缩紧阴道 + 分腿助产</strong> <n-tag size="tiny" type="warning">临产助力</n-tag></div>
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
          <div class="card-head"><strong>散步 + 瑜伽</strong></div>
          <p>白天适当运动促进血液循环，避免站太久走太多。职场孕妈每工作1小时活动5分钟，双脚抬高缓解疲劳。</p>
        </div>
      </n-collapse-item>

      <!-- 临产前 -->
      <n-collapse-item name="prepartum" title="临产前（孕10月）">
        <div class="eg-tip eg-tip-good">
          <span><strong>尚未入盆？多运动！</strong>在医生建议下多运动有利于胎儿入盆。</span>
        </div>

        <div class="phase-grid">
          <div class="phase-item orange">
            <strong>爬楼梯</strong>
            <p>锻炼大腿臀肌群，帮助入盆，促第一产程到来</p>
          </div>
          <div class="phase-item green">
            <strong>爬小山包</strong>
            <p>午后14~16点氧气最强，借爬山充氧，累了就休息</p>
          </div>
          <div class="phase-item blue">
            <strong>散步+上下楼梯</strong>
            <p>过了预产期仍可促进分娩，催产素分泌</p>
          </div>
          <div class="phase-item purple">
            <strong>腹式呼吸法</strong>
            <p>脊背挺直，鼻吸腹鼓，呼气更慢更用力</p>
          </div>
          <div class="phase-item pink">
            <strong>拉梅兹呼吸法</strong>
            <p>胸部→浅喘→喘息→哈气四阶段应对产程</p>
          </div>
          <div class="phase-item yellow">
            <strong>分娩球操</strong>
            <p>弓步举球+挺胸落球，打开盆腔空间</p>
          </div>
        </div>

        <div class="eg-tip eg-tip-warn">
          <span><strong>必须有家人陪同</strong>外出爬楼梯/爬山/散步时确保安全，紧急情况立即送医。</span>
        </div>
      </n-collapse-item>

      <!-- 运动前后 -->
      <n-collapse-item name="routine" title="运动前后怎么安排">
        <div class="step-grid">
          <div class="step-block">
            <strong>开始前：热身 5~10 分钟</strong>
            <ol>
              <li>原地踏步 / 慢走，让心率缓慢升上来</li>
              <li>肩颈绕环、手臂前后绕圈各 10 次</li>
              <li>踝关节、膝关节各绕环 10 次</li>
              <li>不要一上来就做主要动作</li>
            </ol>
          </div>
          <div class="step-block">
            <strong>结束后：放松 5~10 分钟</strong>
            <ol>
              <li>先慢走 2~3 分钟让心率平复</li>
              <li>小腿、大腿后侧、髋部、肩背依次静态拉伸</li>
              <li>每个动作保持 15~30 秒，<strong>缓慢拉伸不要弹振</strong></li>
              <li>不要突然坐下或躺下</li>
            </ol>
          </div>
        </div>

        <div class="eg-tip eg-tip-info" style="margin-top:12px">
          <span><strong>喝水</strong>运动前 1 杯温水；运动中每 15~20 分钟补几口（别一次灌太多）；运动后再补足。出汗多、天热时可在水里加一点点盐。</span>
        </div>

        <div class="eg-tip eg-tip-warn">
          <span><strong>时间怎么挑</strong>饭后至少 <strong>1 小时</strong>再运动；避开正午高温与刚起床的空腹时段；户外散步以下午 4~5 点最舒服（阳光温和、草木释氧多）。晚上运动别太晚，以免影响睡眠。</span>
        </div>

        <div class="eg-tip eg-tip-danger">
          <span><strong>运动完别马上洗澡</strong>先休息 10~15 分钟，等心率平复、汗落了再用<strong>温水</strong>冲洗。水温过高容易头晕，孕晚期尤其要避免长时间泡热水澡。</span>
        </div>

        <div class="eg-tip eg-tip-good">
          <span><strong>穿什么</strong>合脚防滑的运动鞋（孕期脚会变大，别穿旧的挤脚鞋）；透气吸汗的衣物；孕中晚期可加托腹带减轻腰腹负担；内衣选承托好的运动款。</span>
        </div>
      </n-collapse-item>

      <!-- 常见疑问 -->
      <n-collapse-item name="faq" title="常见疑问">
        <div class="eg-card">
          <div class="card-head"><strong>孕前从不运动，现在开始来得及吗？</strong></div>
          <p>来得及。从每天散步 10 分钟开始，每周只加 5 分钟，慢慢过渡到 30 分钟。孕期开始运动永远不晚，但"从零直接上强度"最容易受伤。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>怀孕前一直跑步，还能继续跑吗？</strong></div>
          <p>如果孕前有规律跑步习惯、且医生没有禁忌，可以继续慢跑，但要把配速降到<strong>能正常说话</strong>的程度，并缩短距离。孕中晚期肚子变大后，建议换成快走或游泳。孕前不跑步的人，孕期不要新开始跑。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>能做力量训练 / 举铁吗？</strong></div>
          <p>可以，但原则不同：用<strong>轻重量、多次数</strong>；<strong>绝对不要憋气发力</strong>（憋气会让血压瞬间升高）；避免仰卧推举和弯腰负重；孕晚期不要尝试大重量和新动作。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>孕妇瑜伽和普通瑜伽一样吗？</strong></div>
          <p>不一样。要避开深度扭转、腹部挤压、倒立体式，以及<strong>热瑜伽</strong>（高温环境全程禁止）。孕中期以后避免长时间平躺。建议找有孕期资质的教练，或跟专门的孕期课程。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>游泳要注意什么？</strong></div>
          <p>孕中期是最合适的阶段，水的浮力能明显减轻关节和腰背负担。但<strong>破水后、有出血或医生诊断宫颈机能不全时禁止</strong>。水温别太低（低于 28℃ 容易抽筋），上下池注意防滑，最好有人陪同。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>做家务算运动吗？</strong></div>
          <p>日常活动量算，但不能替代规律运动。而且拖地、擦窗、搬重物这类<strong>弯腰用力的家务反而容易伤腰</strong>，孕晚期建议交给家人。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>运动完肚子发紧、有点坠胀，正常吗？</strong></div>
          <p>运动后短暂出现、休息就能缓解的肚子发紧，多是<strong>假性宫缩</strong>，可以继续观察。但如果<strong>越来越规律、越来越密、休息也不缓解</strong>，或伴有出血、流水、持续腹痛，<strong>立即停止并就医</strong>。</p>
        </div>

        <div class="eg-card">
          <div class="card-head"><strong>一天里什么时间运动最好？</strong></div>
          <p>没有硬性规定，关键是<strong>固定下来、形成习惯</strong>。避开饭后立刻、正午高温和深夜。上班族可以拆成"午休快走 15 分钟 + 晚饭后散步 15 分钟"，同样算数。</p>
        </div>
      </n-collapse-item>

      <!-- 运动禁忌 -->
      <n-collapse-item name="forbid" title="运动禁忌&停止信号">
        <div style="font-weight:600;margin-bottom:8px;color:var(--error-ink,#b32d2d);">出现以下症状，立即停止运动并就医：</div>
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
          <span><strong>养胎不必整天卧床</strong>长期卧床会导致抑郁、便秘、下肢血液不畅甚至静脉血栓。除非有明确禁忌，否则都应适量运动。</span>
        </div>
      </n-collapse-item>

      <!-- 特殊场景 -->
      <n-collapse-item name="special" title="特殊场景建议">
        <div class="phase-grid">
          <div class="phase-item blue">
            <strong>住高楼</strong>
            <p>电梯与楼梯结合使用，孕晚期爬楼梯助入盆</p>
          </div>
          <div class="phase-item green">
            <strong>职场孕妈</strong>
            <p>每1小时活动5分钟，双脚抬高，避免交叠双腿</p>
          </div>
          <div class="phase-item orange">
            <strong>妊娠高血压</strong>
            <p>散步太极孕妇瑜伽降压，避免激烈导致血压波动</p>
          </div>
          <div class="phase-item pink">
            <strong>预防便秘</strong>
            <p>户外运动促进肠道蠕动，配合高纤维饮食</p>
          </div>
        </div>
      </n-collapse-item>
    </n-collapse>

    <!-- 底部声明 -->
    <div class="eg-footer">
      <p>内容来源：《协和医院产科专家·备孕怀孕营养胎教全书》马良坤 著</p>
      <p>运动量标准参考 ACOG（美国妇产科学会）孕期运动建议：健康孕妇每周至少 150 分钟中等强度有氧运动</p>
      <p>仅供参考，具体运动方案请遵医嘱 · 不适请立即停止并就医</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { NCollapse, NCollapseItem, NTag } from 'naive-ui'
import { useGestationalAge } from '@/composables/useGestationalAge'

const { stageKey: rawStageKey, age } = useGestationalAge()

// 映射到折叠面板的 key（原生 stageKey 取值：preparing/early/mid/late/nursing/unknown）：
//   preparing（备孕）、early（孕早期）→ early；mid → mid；
//   late 孕晚期：足月（≥37 周）后 → prepartum（临产前面板）；
//   nursing（已过预产期）→ prepartum；unknown（未设置孕周）→ early（内容最保守）
const stageKey = computed(() => {
  const key = rawStageKey.value
  if (key === 'mid') return 'mid'
  if (key === 'late') return (age.value?.weeks ?? 0) >= 37 ? 'prepartum' : 'late'
  if (key === 'nursing') return 'prepartum'
  return 'early'
})

const currentStage = computed(() => {
  const map: Record<string, any> = {
    early: {
      name: '孕早期（1~3月）',
      desc: '以缓慢为主，打好基础',
      goal: '本阶段目标：每周 3~5 次、每次 15~30 分钟，先把习惯建立起来',
      exercises: ['缓慢散步', '温和孕妇瑜伽', '凯格尔', '踝泵抬腿', '运动胎教'],
      tagType: 'warning' as const,
    },
    mid: {
      name: '孕中期（4~7月）',
      desc: '胎儿稳定，运动黄金期',
      goal: '本阶段目标：每周累计 150 分钟中等强度，约每天 30 分钟、每周 5 天',
      exercises: ['游泳', '散步', '普拉提', '有氧操', '瑜伽'],
      tagType: 'info' as const,
    },
    late: {
      name: '孕晚期（8~9月+）',
      desc: '减轻水肿，锻炼盆底，备战分娩',
      goal: '本阶段目标：每周 3~5 次、每次 20~30 分钟，以"不疲劳"为上限',
      exercises: ['普拉提', '凯格尔', '散步', '提肛练习'],
      tagType: 'error' as const,
    },
    prepartum: {
      name: '临产前（足月 · 孕10月）',
      desc: '帮助入盆，储备体力，迎接分娩',
      goal: '本阶段目标：在医生建议下坚持适量运动促进入盆，外出全程有人陪同',
      exercises: ['爬楼梯', '散步', '孕妇瑜伽', '呼吸法练习', '分娩球操'],
      tagType: 'success' as const,
    },
  }
  return map[stageKey.value] || map.early
})

const stopSignals = [
  '头晕', '气短', '腹部疼痛', '阴道出血', '羊水破裂', '胸痛', '肌肉无力', '小腿肿胀',
]

const forbidItems = [
  { icon: '🩸', title: '前置胎盘出血', desc: '必须卧床禁止任何活动' },
  { icon: '💉', title: '子痫前期', desc: '高血压危重情况需静卧' },
  { icon: '💧', title: '过早破水', desc: '立即平躺垫高臀部就医' },
  { icon: '🔒', title: '子宫颈闭锁不全', desc: '需要卧床静养' },
  { icon: '🧖', title: '热瑜伽 / 高温汗蒸', desc: '核心体温升高有风险' },
  { icon: '🤿', title: '潜水（全程）', desc: '气压变化威胁胎儿' },
  { icon: '⛷️', title: '有跌倒风险的运动', desc: '滑雪、骑马、滑冰、对抗性球类' },
  { icon: '🫁', title: '憋气用力', desc: '举重搬重物憋气会血压骤升' },
  { icon: '🦋', title: '蝶泳（全程禁止）', desc: '拉伤肩膀和后背下部' },
  { icon: '🏋️', title: '剧烈运动（全程）', desc: '造成子宫收缩流产风险' },
  { icon: '🦶', title: '脚底按摩', desc: '泡脚时禁止导致腹部不适' },
  { icon: '🤰', title: '仰卧时间过长', desc: '孕中期后压迫血管影响循环' },
]
</script>

<style scoped>
.exercise-guide {
  padding: 0 0 var(--space-6);
}

/* ── 头部 ── */
.eg-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-4);
  background: linear-gradient(135deg, var(--primary-600, #a83468) 0%, var(--primary-700, #862952) 100%);
  border-radius: var(--radius-lg);
  color: var(--text-inverse);
  margin-bottom: var(--space-4);
  box-shadow: var(--glow-pink);
}
.eg-icon { font-size: 36px; }
.eg-title h2 { font-size: 20px; font-weight: 700; margin: 0 0 2px; }
.eg-title p { font-size: 13px; color: var(--primary-100, #ffe1ee); margin: 0; }

/* ── 当前阶段卡片（浅底 + 阶段色竖条，与 RecordList 阶段标签同源）── */
.eg-current-stage {
  border-radius: var(--radius-md);
  padding: 16px 18px;
  margin-bottom: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-left: 4px solid var(--primary-color);
  box-shadow: var(--shadow-sm);
}
.eg-current-stage.stage-early { background: var(--stage-early-bg, #fff5e8); border-left-color: var(--stage-early-color, #f29e51); }
.eg-current-stage.stage-mid { background: var(--stage-mid-bg, #e8f5fc); border-left-color: var(--stage-mid-color, #4fb6e8); }
.eg-current-stage.stage-late { background: var(--stage-late-bg, #fde7ed); border-left-color: var(--stage-late-color, #ec5d8a); }
.eg-current-stage.stage-prepartum { background: var(--stage-nursing-bg, #ebf7ed); border-left-color: var(--stage-nursing-color, #5bbe70); }
.stage-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-hint); }
.eg-current-stage h3 { font-size: 17px; font-weight: 700; margin: 4px 0 6px; color: var(--text-color); }
.stage-desc { font-size: 13px; color: var(--text-secondary); margin: 0 0 8px; }
.stage-goal {
  font-size: 12.5px;
  line-height: 1.5;
  margin: 0 0 10px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-color);
}
.stage-tags { display: flex; flex-wrap: wrap; gap: 6px; }

/* ── 提示框 ── */
.eg-tip {
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13.5px;
  line-height: 1.55;
  margin: 10px 0;
}
.eg-tip strong { font-size: 12.5px; }
.eg-tip-info   { background: var(--bg-tint-blue, #f4f8ff);   border-left: 3px solid var(--info-color, #4fb6e8);    color: var(--info-ink, #17709b); }
.eg-tip-warn   { background: var(--bg-tint-cream, #fff9ec);  border-left: 3px solid var(--warning-color, #f0a020); color: var(--warning-ink, #7d4f0d); }
.eg-tip-good   { background: var(--bg-tint-mint, #f1faf4);   border-left: 3px solid var(--success-color, #4ea750); color: var(--success-ink, #3f7f42); }
.eg-tip-danger { background: var(--bg-tint-danger, #fdf2f2); border-left: 3px solid var(--error-color, #e64646);   color: var(--error-ink, #b32d2d); }

/* ── 运动卡片 ── */
.eg-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  margin: 10px 0;
  box-shadow: var(--shadow-sm);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.eg-card p { font-size: 13.5px; color: var(--text-secondary); line-height: 1.65; margin: 0; }
.card-steps, .card-steps ol {
  margin: 8px 0 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-secondary);
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
  background: var(--bg-tint-blue, #f4f8ff);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 12px;
}
.step-block strong { font-size: 14px; color: var(--info-ink, #17709b); display: block; margin-bottom: 6px; }
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
  background: var(--bg-card);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  border-left: 3px solid var(--border-color);
}
.phase-item strong { font-size: 14px; color: var(--text-color); display: block; margin-bottom: 4px; }
.phase-item p { font-size: 12px; color: var(--text-secondary); margin: 0; line-height: 1.5; }
.phase-item.orange { background: var(--stage-early-bg, #fff5e8);     border-color: var(--stage-early-color, #f29e51); }
.phase-item.yellow { background: var(--bg-tint-cream, #fff9ec);      border-color: var(--warning-color, #f0a020); }
.phase-item.green  { background: var(--bg-tint-mint, #f1faf4);       border-color: var(--success-color, #4ea750); }
.phase-item.blue   { background: var(--bg-tint-blue, #f4f8ff);       border-color: var(--info-color, #4fb6e8); }
.phase-item.purple { background: var(--stage-preparing-bg, #f4f6fa); border-color: var(--accent-lilac, #b08fd6); }
.phase-item.pink   { background: var(--stage-late-bg, #fde7ed);      border-color: var(--primary-color, #c44680); }

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
  background: var(--bg-tint-danger, #fdf2f2);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  text-align: center;
}
.fi-icon { font-size: 24px; display: block; margin-bottom: 4px; }
.forbid-item strong { font-size: 13px; color: var(--error-ink, #b32d2d); display: block; }
.forbid-item small { font-size: 11.5px; color: var(--text-hint); display: block; margin-top: 2px; }

/* ── 底部声明 ── */
.eg-footer {
  text-align: center;
  padding: 20px 16px;
  margin-top: 20px;
  border-top: 1px solid var(--border-color);
  font-size: 12px;
  color: var(--text-hint);
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
