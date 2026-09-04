<template>
  <div class="diet-view">
    <n-tabs v-model:value="activeTab" type="line" animated>
      <!-- ===== 原有：今日吃什么 ===== -->
      <n-tab-pane name="spin" tab="🎲 今日吃什么">
        <div class="spin-section">
          <div class="random-area">
            <div class="random-icon">🍳</div>
            <div class="random-title">不知道吃啥？</div>
            <n-button type="primary" size="large" round @click="doPick">
              🎲 推荐今日三餐
            </n-button>
          </div>

          <div v-if="recipesLoading" class="loading-hint">
            <n-spin size="small" />
            <span>食谱数据加载中...</span>
          </div>
          <div v-else-if="!hasMeals" class="no-meals-hint">
            点击按钮推荐今日三餐
          </div>
          <div v-else class="meals-result">
            <div v-for="m in mealList" :key="m.key" class="meal-card">
              <div class="meal-label">{{ m.label }}</div>
              <div class="meal-combo">
                <template v-for="slot in m.slots" :key="slot.type">
                  <div v-if="slot.recipe" class="combo-item">
                    <span class="combo-tag">{{ slot.icon }}{{ slot.type }}</span>
                    <span class="combo-name">{{ slot.recipe.name }}</span>
                    <span class="combo-desc">{{ slot.recipe.description }}</span>
                  </div>
                </template>
              </div>
            </div>
            <n-button block tertiary round @click="doPick" class="refresh-btn">
              🔄 换一组推荐
            </n-button>
          </div>
        </div>
      </n-tab-pane>

      <!-- ===== 原有：能不能吃 ===== -->
      <n-tab-pane name="safety" tab="🔍 能不能吃">
        <div class="safety-section">
          <div v-if="safetyLoading" class="loading-hint-center">
            <n-spin size="large" />
            <p>食物安全数据加载中...</p>
          </div>
          <template v-else>
          <n-input
            v-model:value="searchKeyword"
            placeholder="搜索 1000+ 种食物（如：螃蟹、咖啡、山楂）"
            clearable
            @keyup.enter="doSearch"
            @clear="clearSearch"
          >
            <template #prefix>🔍</template>
            <template #suffix>
              <span v-if="searchKeyword" class="search-hint" @click="doSearch">搜索</span>
            </template>
          </n-input>

          <div class="category-tabs">
            <div
              v-for="cat in categoryList"
              :key="cat.name"
              class="category-tab"
              :class="{ active: activeCategory === cat.name }"
              @click="selectCategory(cat.name)"
            >
              {{ cat.icon }} {{ cat.name }}
            </div>
          </div>

          <div v-if="searchResults.length > 0" class="food-list">
            <div class="food-list-title">搜索结果</div>
            <FoodSafetyCard
              v-for="item in searchResults"
              :key="item.name"
              :item="item"
              :current-stage="currentStage"
            />
          </div>

          <div v-else-if="activeCategoryData" class="food-list">
            <div class="food-list-title">{{ activeCategoryData.icon }} {{ activeCategoryData.name }}</div>
            <FoodSafetyCard
              v-for="item in activeCategoryData.items"
              :key="item.name"
              :item="item"
              :current-stage="currentStage"
            />
          </div>

          <div v-else class="empty-state">
            <div class="empty-text">请选择分类或搜索食物</div>
          </div>
          </template>
        </div>
      </n-tab-pane>

      <!-- ===== 新增：孕期食谱 ===== -->
      <n-tab-pane name="pregnancy-diet" tab="📖 孕期食谱">
        <div class="guide-body">

          <!-- 智能推荐卡片 -->
          <div class="stage-banner" :class="'stage-' + dietStageKey">
            <h3>{{ currentDietStage.name }}</h3>
            <p>{{ currentDietStage.desc }}</p>
            <div class="stage-tags">
              <n-tag v-for="t in currentDietStage.nutrients" :key="t" size="small" round>{{ t }}</n-tag>
            </div>
          </div>

          <n-collapse :default-expanded-names="[dietStageKey]" accordion>
            <!-- 备孕期 -->
            <n-collapse-item name="preconception" title="🌱 备孕期 · 为宝宝准备最好的土壤">
              <div class="dg-tip dg-tip-pink">
                <span class="tip-icon">💡</span>
                <span><strong>重点：</strong>孕前3-6个月开始调整饮食，叶酸是第一优先级。</span>
              </div>

              <div class="nutrient-grid">
                <div class="nut-item"><strong>叶酸</strong><small>每日0.4-1mg，预防神经管畸形</small></div>
                <div class="nut-item"><strong>铁</strong><small>每日15-20mg，动物肝脏/瘦肉</small></div>
                <div class="nut-item"><strong>蛋白质</strong><small>鱼蛋奶瘦肉豆制品</small></div>
                <div class="nut-item"><strong>黑豆</strong><small>植物雌激素，调节内分泌</small></div>
                <div class="nut-item"><strong>酸奶</strong><small>调节肠道菌群</small></div>
                <div class="nut-item"><strong>维生素C</strong><small>鲜枣猕猴桃，助铁吸收</small></div>
              </div>

              <h4 class="sec-title">女性推荐食物</h4>
              <div class="food-table">
                <div class="ft-row ft-head"><span>类别</span><span>推荐</span><span>作用</span></div>
                <div class="ft-row"><span>叶酸来源</span><span>动物肝脏、菠菜、芦笋、豆类、柑橘</span><span>预防神经管畸形</span></div>
                <div class="ft-row"><span>补铁</span><span>猪肝、菠菜、胡萝卜、南瓜</span><span>预防贫血</span></div>
                <div class="ft-row"><span>蛋白质</span><span>鱼、蛋、奶、瘦肉、豆腐</span><span>调节激素</span></div>
                <div class="ft-row"><span>植物雌激素</span><span>黑豆豆浆、黄豆</span><span>提高受孕率</span></div>
              </div>

              <div class="dg-tip dg-tip-yellow">
                <span class="tip-icon">⚠️</span>
                <span>男性也需补叶酸——提高精子浓度和活力。戒烟戒酒，避免熬夜。</span>
              </div>
            </n-collapse-item>

            <!-- 孕早期 -->
            <n-collapse-item name="early" title="🌸 孕早期（1-12周）· 安胎固本">
              <div class="dg-tip dg-tip-pink">
                <span class="tip-icon">💡</span>
                <span><strong>核心原则：</strong>不需要过度进补，正常均衡饮食即可。少食多餐应对孕吐。</span>
              </div>

              <div class="nutrient-grid">
                <div class="nut-item"><strong>叶酸</strong><small>持续至孕3月</small></div>
                <div class="nut-item"><strong>DHA</strong><small>"脑黄金"，深海鱼核桃</small></div>
                <div class="nut-item"><strong>碘</strong><small>海带紫菜促脑发育</small></div>
                <div class="nut-item"><strong>碳水</strong><small>基础能量，缓解疲劳</small></div>
              </div>

              <h4 class="sec-title">推荐食谱</h4>
              <div class="recipe-grid">
                <div class="rcp-card" v-for="r in earlyRecipes" :key="r.name">
                  <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                  <n-tag size="tiny" :type="r.tagType || 'default'" round>{{ r.tag }}</n-tag>
                  <p class="rcp-desc">{{ r.desc }}</p>
                </div>
              </div>

              <h4 class="sec-title">一日参考</h4>
              <div class="food-table">
                <div class="ft-row ft-head"><span>时间</span><span>内容</span><span>说明</span></div>
                <div class="ft-row"><span>早餐</span><span>小米粥/面条 + 蛋 + 菜</span><span>易消化主食</span></div>
                <div class="ft-row"><span>加餐</span><span>酸奶/水果/坚果</span><span>少量补充能量</span></div>
                <div class="ft-row"><span>午餐</span><span>米饭 + 瘦肉/鱼 + 2种蔬菜</span><span>均衡营养</span></div>
                <div class="ft-row"><span>晚餐</span><span>粥/汤面 + 豆腐 + 菜</span><span>清淡易消化</span></div>
                <div class="ft-row"><span>睡前</span><span>温牛奶一杯</span><span>帮助睡眠</span></div>
              </div>
            </n-collapse-item>

            <!-- 孕中期 -->
            <n-collapse-item name="mid" title="🌿 孕中期（13-28周）· 快速增长期">
              <div class="dg-tip dg-tip-green">
                <span class="tip-icon">✅</span>
                <span>胎儿骨骼肌肉大脑快速发育期。重点：补铁防贫血、补钙强骨骼、优质蛋白+DHA。</span>
              </div>

              <div class="nutrient-grid">
                <div class="nut-item"><strong>铁</strong><small>猪血肝脏红肉</small></div>
                <div class="nut-item"><strong>钙</strong><small>牛奶豆制品虾皮</small></div>
                <div class="nut-item"><strong>DHA</strong><small>深海鱼核桃蛋黄</small></div>
                <div class="nut-item"><strong>膳食纤维</strong><small>红薯油菜土豆</small></div>
                <div class="nut-item"><strong>B族维生素</strong><small>全谷物瘦肉</small></div>
                <div class="nut-item"><strong>卵磷脂</strong><small>蛋黄大豆</small></div>
              </div>

              <h4 class="sec-title">推荐食谱</h4>
              <div class="recipe-grid">
                <div class="rcp-card" v-for="r in midRecipes" :key="r.name">
                  <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                  <n-tag size="tiny" :type="r.tagType || 'default'" round>{{ r.tag }}</n-tag>
                  <p class="rcp-desc">{{ r.desc }}</p>
                </div>
              </div>

              <h4 class="sec-title">一日参考</h4>
              <div class="food-table">
                <div class="ft-row ft-head"><span>时间</span><span>内容</span><span>说明</span></div>
                <div class="ft-row"><span>早餐</span><span>牛奶小米粥 + 全麦面包 + 蛋 + 水果</span><span>补钙蛋白</span></div>
                <div class="ft-row"><span>加餐</span><span>核桃/红枣 + 酸奶</span><span>健脑零食</span></div>
                <div class="ft-row"><span>午餐</span><span>米饭 + 猪血炖豆腐 + 菜 + 鲜奶玉米汤</span><span>补铁补钙</span></div>
                <div class="ft-row"><span>晚餐</span><span>杂粮饭 + 清蒸鱼/虾仁 + 菜</span><span>补DHA</span></div>
                <div class="ft-row"><span>睡前</span><span>红枣山药粥/温牛奶</span><span>安神助眠</span></div>
              </div>
            </n-collapse-item>

            <!-- 孕晚期 -->
            <n-collapse-item name="late" title="🍂 孕晚期（29-40周）· 冲刺待产">
              <div class="dg-tip dg-tip-yellow">
                <span class="tip-icon">⚠️</span>
                <span>胎儿迅速增重，为分娩储备能量。控制盐分防水肿，多吃高锌食物助自然分娩。</span>
              </div>

              <div class="nutrient-grid">
                <div class="nut-item"><strong>钙</strong><small>牛奶最佳来源</small></div>
                <div class="nut-item"><strong>维生素K</strong><small>绿叶蔬菜防产后出血</small></div>
                <div class="nut-item"><strong>锌</strong><small>坚果瘦肉助力分娩</small></div>
                <div class="nut-item"><strong>铜</strong><small>动物肝脏防早产</small></div>
                <div class="nut-item"><strong>纤维</strong><small>防便秘</small></div>
                <div class="nut-item"><strong>亚油酸</strong><small>植物油坚果促脑发育</small></div>
              </div>

              <h4 class="sec-title">推荐食谱</h4>
              <div class="recipe-grid">
                <div class="rcp-card" v-for="r in lateRecipes" :key="r.name">
                  <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                  <n-tag size="tiny" :type="r.tagType || 'default'" round>{{ r.tag }}</n-tag>
                  <p class="rcp-desc">{{ r.desc }}</p>
                </div>
              </div>

              <div class="dg-tip dg-tip-warn">
                <span class="tip-icon">⚠️</span>
                <span><strong>禁忌：</strong>高盐饮食（防水肿和高血压）、含咖啡因饮料、禁烟禁酒、暴饮暴食。</span>
              </div>
            </n-collapse-item>

            <!-- 月子餐 -->
            <n-collapse-item name="postpartum" title="🍲 月子餐 · 42天科学调理">
              <div class="dg-tip dg-tip-blue">
                <span class="tip-icon">📅</span>
                <span>四阶段调理：<strong>排毒修复(1-7天)</strong> → 净化(8-14天) → 基础进补(15-30天) → 强化(30-42天)</span>
              </div>

              <n-collapse>
                <n-collapse-item name="s1" title="第一阶段：1-7天 排毒与修复">
                  <div class="food-table">
                    <div class="ft-row ft-head"><span>时间</span><span>内容</span><span>说明</span></div>
                    <div class="ft-row"><span>空腹</span><span>生化汤 50ml</span><span>子宫收缩排恶露</span></div>
                    <div class="ft-row"><span>早餐</span><span>红豆汤 + 海带粥/芝麻小米粥</span><span>利尿消肿养胃</span></div>
                    <div class="ft-row"><span>午餐/晚餐</span><span>四神粥 + 四神猪肝/猪腰汤</span><span>健脾养胃补血</span></div>
                    <div class="ft-row"><span>点心</span><span>养肝汤 + 生化汤</span><span>养肝解毒</span></div>
                  </div>
                  <div class="dg-tip dg-tip-yellow">
                    <span class="tip-icon">💡</span>
                    <span>产前三天喝红枣养肝汤；产后米酒水代替普通水烹饪；老姜必须用胡麻油爆透至起皱皮。</span>
                  </div>
                </n-collapse-item>

                <n-collapse-item name="s2" title="第二阶段：8-14天 净化与调整">
                  <div class="food-table">
                    <div class="ft-row ft-head"><span>时间</span><span>内容</span><span>说明</span></div>
                    <div class="ft-row"><span>早餐</span><span>麻油猪肝 + 薏仁米饭/黑白饭</span><span>补血养气</span></div>
                    <div class="ft-row"><span>午餐</span><span>海带汤/乌鸡汤 + 素菜 + 杂粮饭</span><span>加入高蛋白食材</span></div>
                    <div class="ft-row"><span>晚餐</span><span>腐竹山药百合瘦肉汤 + 素菜 + 杂粮饭</span><span>增加滋补汤品</span></div>
                    <div class="ft-row"><span>晚上</span><span>水果 + 热鲜牛奶</span><span>补充维C钙质</span></div>
                  </div>
                  <div class="dg-tip dg-tip-pink">
                    <span class="tip-icon">⚠️</span>
                    <span>每餐配合生化汤吃杜仲粉一钱，有助于腰肾功能恢复。</span>
                  </div>
                </n-collapse-item>

                <n-collapse-item name="s3" title="第三阶段：15-30天 基础进补">
                  <div class="food-table">
                    <div class="ft-row ft-head"><span>时间</span><span>内容</span></div>
                    <div class="ft-row"><span>早餐</span><span>杂粮粥 + 鱼汤/猪肚汤/鸡汤（任选）</span></div>
                    <div class="ft-row"><span>午餐</span><span>麻油杜仲猪腰/排骨汤 + 荤素搭配 + 五谷饭</span></div>
                    <div class="ft-row"><span>晚餐</span><span>清蒸鲈鱼/莲藕汤 + 荤素搭配 + 杂粮饭</span></div>
                    <div class="ft-row"><span>点心</span><span>红豆汤 + 姜丝麻油煎蛋 + 红枣燕窝</span></div>
                  </div>
                  <div class="dg-tip dg-tip-green">
                    <span class="tip-icon">✅</span>
                    <span>水果可吃哈密瓜、猕猴桃、葡萄。鸡汤可用黄芪当归党参等烹饪。</span>
                  </div>
                </n-collapse-item>

                <n-collapse-item name="s4" title="第四阶段：30-42天 强化进补">
                  <p style="color:#888;font-size:13px;margin-bottom:10px;">与第三阶段基本相同，保持高营养高蛋白摄入，逐步过渡到正常饮食。</p>
                  <div class="dg-tip dg-tip-blue">
                    <span class="tip-icon">📋</span>
                    <span><strong>月子餐总体原则：</strong>忌放盐酱油醋；忌韭菜辣椒大蒜胡椒凉水；绑缚带产后4-7天24小时绑。</span>
                  </div>
                </n-collapse-item>
              </n-collapse>

              <h4 class="sec-title">核心月子食谱做法</h4>
              <div class="recipe-grid">
                <div class="rcp-card" v-for="r in postpartumRecipes" :key="r.name">
                  <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                  <n-tag size="tiny" :type="r.tagType || 'default'" round>{{ r.tag }}</n-tag>
                  <p class="rcp-ingr">{{ r.ingredients }}</p>
                  <p class="rcp-desc">{{ r.desc }}</p>
                </div>
              </div>
            </n-collapse-item>
          </n-collapse>
        </div>
      </n-tab-pane>

      <!-- ===== 新增：婴儿喂养 ===== -->
      <n-tab-pane name="baby-feed" tab="👶 婴儿喂养">
        <div class="guide-body baby-theme">

          <n-collapse :default-expanded-names="['b-newborn']" accordion>
            <!-- 新生儿 -->
            <n-collapse-item name="b-newborn" title="👶 新生儿（0-1月）· 初乳与开奶">
              <div class="dg-tip dg-tip-blue">
                <span class="tip-icon">🌟</span>
                <span><strong>初乳 = 液体黄金</strong> — 产后前3天的乳汁呈水样黄色，富含蛋白质和酶类，极大提高宝宝免疫能力！千万不要错过。</span>
              </div>

              <h4 class="sec-title">开奶要点</h4>
              <ul class="plain-list">
                <li><strong>产后30分钟内</strong>即可开奶，让新生儿尽早吸吮</li>
                <li>同室同床，<strong>按需喂养</strong>原则哺乳</li>
                <li>健康足月儿一般<strong>2-3小时喂一次</strong>，每天约<strong>10-12次</strong></li>
                <li>即使乳房不胀也要及早让宝宝吸吮</li>
              </ul>

              <h4 class="sec-title">三种哺乳姿势</h4>
              <div class="pos-grid">
                <div class="pos-card"><span class="pos-icon">🤗</span><strong>摇篮式</strong><p>坐直抱宝宝，后背靠前臂手掌托头颈，U形手托乳房。公开场合最理想。</p></div>
                <div class="pos-card"><span class="pos-icon">😴</span><strong>侧卧式</strong><p>侧卧床上，宝宝面对乳房。适合疲倦时、剖宫产妈妈。</p></div>
                <div class="pos-card"><span class="pos-icon">⚽</span><strong>足球式</strong><p>宝宝抱在身体一侧面对乳房。适合剖宫产、乳房较大妈妈。</p></div>
              </div>

              <h4 class="sec-title">判断母乳充足（五点法）</h4>
              <div class="food-table">
                <div class="ft-row ft-head"><span>#</span><span>判断标准</span></div>
                <div class="ft-row"><span>1</span><span>涨奶感 —— 妈妈要有涨奶的感觉</span></div>
                <div class="ft-row"><span>2</span><span>吞咽声 —— 听到咕咚咕咚吞咽声</span></div>
                <div class="ft-row"><span>3</span><span>睡眠时长 —— 吃饱能睡约2小时</span></div>
                <div class="ft-row"><span>4</span><span>尿量 —— 一天5-6次纸尿裤，约300ml</span></div>
                <div class="ft-row"><span>5</span><span>体重增长 —— 一周增150-250克</span></div>
              </div>

              <div class="dg-tip dg-tip-info">
                <span class="tip-icon">💡</span>
                <span>喂完奶后将宝宝趴在肩上轻拍后背打嗝，避免吐奶溢奶。</span>
              </div>
            </n-collapse-item>

            <!-- 1-3月 -->
            <n-collapse-item name="b-early" title="🍼 1-3月 · 哺乳进阶">
              <h4 class="sec-title">各月龄喂养频率</h4>
              <div class="food-table">
                <div class="ft-row ft-head"><span>月龄</span><span>次数</span><span>间隔</span><span>每次时长</span></div>
                <div class="ft-row"><span>新生儿</span><span>10-12次</span><span>2-3h</span><span>5-15min</span></div>
                <div class="ft-row"><span>1-2月</span><span>8-10次</span><span>2.5-3h</span><span>10-20min</span></div>
                <div class="ft-row"><span>2-3月</span><span>6-8次</span><span>3-4h</span><span>15-20min</span></div>
                <div class="ft-row"><span>6月+</span><span>约5次</span><span>4-5h</span><span>20-30min</span></div>
              </div>

              <h4 class="sec-title">优质母乳怎么来</h4>
              <div class="two-col-box">
                <div class="col-box col-pink">
                  <strong>🥗 吃出来</strong>
                  <ul><li>充足碳水：米面杂粮土豆番薯</li><li>优质蛋白：鱼禽肉蛋奶豆</li><li>足够矿物质：瘦肉补铁、牛奶补钙</li><li>深色蔬果补维A，晒太阳补维D</li></ul>
                </div>
                <div class="col-box col-blue">
                  <strong>😊 笑出来</strong>
                  <ul><li>情绪直接影响乳汁质量和产量</li><li>压力焦虑抑郁会减少泌乳</li><li>适量运动提高乳糖和脂肪质量</li></ul>
                </div>
              </div>

              <div class="dg-tip dg-tip-warn">
                <span class="tip-icon">⚠️</span>
                <span><strong>奶水不足信号：</strong>乳房空空、听不到连续吞咽声、睡不沉总哭闹找乳头、大小便次数少量少、体重不增。<strong>补救：</strong>24小时内喂12次以上，坚持3天见效。</span>
              </div>
            </n-collapse-item>

            <!-- 辅食初添 4-6月 -->
            <n-collapse-item name="b-transition" title="🥄 4-6月 · 辅食初添">
              <div class="dg-tip dg-tip-blue">
                <span class="tip-icon">📌</span>
                <span><strong>添加信号：</strong>宝宝能靠坐、对大人吃饭感兴趣、推舌反射消失、体重达出生2倍以上（约6kg）。最早不早于4月，最晚不晚于6月。</span>
              </div>

              <h4 class="sec-title">辅食添加时间表</h4>
              <div class="food-table">
                <div class="ft-row ft-head"><span>月龄</span><span>奶量</span><span>辅食</span></div>
                <div class="ft-row"><span>4月</span><span>800-1000ml / 5-6次</span><span>初尝可选，稀糊状</span></div>
                <div class="ft-row"><span>5月</span><span>800-1000ml / 5次</span><span>米粉/菜泥 1次/天</span></div>
                <div class="ft-row"><span>6月</span><span>700-900ml / 4-5次</span><span>1-2次/天 泥糊状</span></div>
              </div>

              <h4 class="sec-title">推荐辅食</h4>
              <div class="recipe-grid">
                <div class="rcp-card" v-for="r in transitionRecipes" :key="r.name">
                  <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                  <n-tag size="tiny" round>{{ r.tag }}</n-tag>
                  <p class="rcp-ingr">{{ r.ingredients }}</p>
                  <p class="rcp-desc">{{ r.desc }}</p>
                </div>
              </div>

              <div class="dg-tip dg-tip-green">
                <span class="tip-icon">✅</span>
                <span>每次只添加一种新食物，观察3-5天无过敏再换下一种。第一口辅食用米粉糊。</span>
              </div>
            </n-collapse-item>

            <!-- 7-8月 -->
            <n-collapse-item name="b-growing" title="🥣 7-8月 · 辅食丰富">
              <div class="food-table">
                <div class="ft-row ft-head"><span>月龄</span><span>奶量</span><span>辅食</span></div>
                <div class="ft-row"><span>7月</span><span>600-800ml / 4次</span><span>2次/天 泥糊→碎末</span></div>
                <div class="ft-row"><span>8月</span><span>600-700ml / 3-4次</span><span>2-3次/天 碎末状</span></div>
              </div>
              <div class="dg-tip dg-tip-info">
                <span class="tip-icon">📌</span>
                <span>可开始添加<strong>蛋黄、鱼泥、肉泥、肝泥</strong>，质地从泥糊向碎末过渡。</span>
              </div>

              <h4 class="sec-title">推荐食谱</h4>
              <div class="recipe-grid">
                <div class="rcp-card" v-for="r in growingRecipes" :key="r.name">
                  <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                  <n-tag size="tiny" round>{{ r.tag }}</n-tag>
                  <p class="rcp-ingr">{{ r.ingredients }}</p>
                  <p class="rcp-desc">{{ r.desc }}</p>
                </div>
              </div>
            </n-collapse-item>

            <!-- 9-12月 -->
            <n-collapse-item name="b-advanced" title="🍗 9-12月 · 辅食升级">
              <div class="food-table">
                <div class="ft-row ft-head"><span>月龄</span><span>奶量</span><span>辅食</span></div>
                <div class="ft-row"><span>9-10月</span><span>500-600ml / 3次</span><span>3次/天 碎丁状</span></div>
                <div class="ft-row"><span>11-12月</span><span>400-500ml / 2-3次</span><span>3餐+点心 小块状</span></div>
              </div>
              <div class="dg-tip dg-tip-blue">
                <span class="tip-icon">📌</span>
                <span>辅食逐渐成为主食。可尝试<strong>手指食物</strong>（蒸软的胡萝卜条、西兰花等），锻炼自主进食。</span>
              </div>

              <h4 class="sec-title">推荐食谱</h4>
              <div class="recipe-grid">
                <div class="rcp-card" v-for="r in advancedRecipes" :key="r.name">
                  <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                  <n-tag size="tiny" round>{{ r.tag }}</n-tag>
                  <p class="rcp-ingr">{{ r.ingredients }}</p>
                  <p class="rcp-desc">{{ r.desc }}</p>
                </div>
              </div>
            </n-collapse-item>

            <!-- 催奶食谱 -->
            <n-collapse-item name="b-boost" title="🥘 催奶食谱大全">
              <div class="boost-cats">
                <n-radio-group v-model="boostCat" size="small">
                  <n-radio-button value="pig">🐷 猪蹄系列</n-radio-button>
                  <n-radio-button value="fish">🐟 鱼类系列</n-radio-button>
                  <n-radio-button value="chicken">🐔 禽肉类</n-radio-button>
                  <n-radio-button value="veg">🥜 素食谷物</n-radio-button>
                  <n-radio-button value="tips">📋 宜忌速查</n-radio-button>
                </n-radio-group>
              </div>

              <!-- 猪蹄 -->
              <template v-if="boostCat === 'pig'">
                <div class="recipe-grid">
                  <div class="rcp-card" v-for="r in pigRecipes" :key="r.name">
                    <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                    <n-tag size="tiny" type="warning" round>{{ r.tag }}</n-tag>
                    <p class="rcp-ingr">{{ r.ingredients }}</p>
                    <p class="rcp-desc">{{ r.desc }}</p>
                  </div>
                </div>
              </template>

              <!-- 鱼类 -->
              <template v-if="boostCat === 'fish'">
                <div class="recipe-grid">
                  <div class="rcp-card" v-for="r in fishRecipes" :key="r.name">
                    <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                    <n-tag size="tiny" type="info" round>{{ r.tag }}</n-tag>
                    <p class="rcp-ingr">{{ r.ingredients }}</p>
                    <p class="rcp-desc">{{ r.desc }}</p>
                  </div>
                </div>
              </template>

              <!-- 禽肉 -->
              <template v-if="boostCat === 'chicken'">
                <div class="recipe-grid">
                  <div class="rcp-card" v-for="r in chickenRecipes" :key="r.name">
                    <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                    <n-tag size="tiny" type="success" round>{{ r.tag }}</n-tag>
                    <p class="rcp-ingr">{{ r.ingredients }}</p>
                    <p class="rcp-desc">{{ r.desc }}</p>
                  </div>
                </div>
              </template>

              <!-- 素食 -->
              <template v-if="boostCat === 'veg'">
                <div class="recipe-grid">
                  <div class="rcp-card" v-for="r in vegRecipes" :key="r.name">
                    <div class="rcp-name">{{ r.emoji }} {{ r.name }}</div>
                    <n-tag size="tiny" type="default" round>{{ r.tag }}</n-tag>
                    <p class="rcp-ingr">{{ r.ingredients }}</p>
                    <p class="rcp-desc">{{ r.desc }}</p>
                  </div>
                </div>
              </template>

              <!-- 宜忌 -->
              <template v-if="boostCat === 'tips'">
                <div class="two-col-box">
                  <div class="col-box col-green">
                    <strong>✅ 宜食物品</strong>
                    <ul><li>猪蹄、羊肉、鲫鱼、鲇鱼、虾子、泥鳅</li><li>鸡肉、牛乳、鸡蛋、猪瘦肉</li><li>花生、黑芝麻、豌豆、赤小豆、豆腐</li><li>茭白、莴苣、丝瓜、木瓜、桂圆、大枣</li><li>党参、黄芪、当归、通草</li></ul>
                  </div>
                  <div class="col-box col-red">
                    <strong>❌ 忌食物品</strong>
                    <ul><li><strong>大麦芽</strong>：有回乳作用</li><li>韭菜、辣椒、桂皮、大蒜、花椒等刺激性食物</li><li>香烟、烈酒、咖啡、浓茶</li><li>冰镇冷饮、苦瓜、西瓜、生黄瓜</li><li>柿子、螃蟹、田螺等寒性食物</li></ul>
                  </div>
                </div>
              </template>
            </n-collapse-item>
          </n-collapse>
        </div>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  NTabs, NTabPane, NButton, NInput, NSpin, NCollapse, NCollapseItem,
  NTag, NRadioGroup, NRadioButton, useMessage,
} from 'naive-ui'
import { usePregnancyStore } from '@/stores/pregnancy'
import { getAllRecipes, getFoodSafety, searchFood } from '@/api/diet'
import FoodSafetyCard from '@/components/FoodSafetyCard.vue'

const pregnancyStore = usePregnancyStore()
const message = useMessage()

const activeTab = ref('spin')

// ─── 原有逻辑 ───
interface Recipe {
  id: string; name: string; category: string; suitable_weeks: number[]
  suitable_stage: string[]; ingredients: string[]; nutrition: string
  image: string | null; description: string
}
interface ComboSlot { type: string; icon: string; recipe: Recipe | null }
interface MealCombo { staple: Recipe|null; meat: Recipe|null; veggie: Recipe|null;
  soup: Recipe|null; drink: Recipe|null; dessert: Recipe|null }

const allRecipes = ref<Recipe[]>([])
const recipesLoading = ref(false)
const meals = ref<{breakfast:MealCombo;lunch:MealCombo;dinner:MealCombo}>({
  breakfast:{staple:null,meat:null,veggie:null,soup:null,drink:null,dessert:null},
  lunch:{staple:null,meat:null,veggie:null,soup:null,drink:null,dessert:null},
  dinner:{staple:null,meat:null,veggie:null,soup:null,drink:null,dessert:null},
})
const recentUsedIds = ref<Set<string>>(new Set())
const MAX_RECENT = 12

function clearRecentUsed() { recentUsedIds.value.clear() }
const hasMeals = computed(() => {
  const b=meals.value.breakfast,l=meals.value.lunch,d=meals.value.dinner
  return !!(b.staple||b.drink||l.staple||l.meat||d.staple||d.soup)
})
function buildSlots(combo:MealCombo):ComboSlot[] {
  const s:ComboSlot[]=[]
  if(combo.staple) s.push({type:'主食',icon:'🍚',recipe:combo.staple})
  if(combo.meat) s.push({type:'荤菜',icon:'🥩',recipe:combo.meat})
  if(combo.veggie) s.push({type:'素菜',icon:'🥬',recipe:combo.veggie})
  if(combo.soup) s.push({type:'汤品',icon:'🍲',recipe:combo.soup})
  if(combo.drink) s.push({type:'饮品',icon:'🥤',recipe:combo.drink})
  if(combo.dessert) s.push({type:'甜品',icon:'🍮',recipe:combo.dessert})
  return s
}
const mealList = computed(() => [
  { key:'breakfast',label:'🌅 早餐',combo:meals.value.breakfast,slots:buildSlots(meals.value.breakfast) },
  { key:'lunch',label:'☀️ 午餐',combo:meals.value.lunch,slots:buildSlots(meals.value.lunch) },
  { key:'dinner',label:'🌙 晚餐',combo:meals.value.dinner,slots:buildSlots(meals.value.dinner) },
].filter(m=>m.slots.length>0))

const currentWeek = computed(() => pregnancyStore.gestationalAge?.weeks ?? 20)
const currentStage = computed(() => {
  const w=currentWeek.value
  if(w<=0)return 'preparing';if(w<=13)return 'early';if(w<=27)return 'mid';if(w<=42)return 'late';return'nursing'
})

function filterByStage(recipes:Recipe[],stage:string):Recipe[]{return recipes.filter(r=>(r.suitable_stage||[]).includes(stage))}
function shuffle<T>(arr:T[]):T[]{return[...arr].sort(()=>Math.random()-0.5)}
function pickOneFromPool(pool:Recipe[],usedIds:Set<string>):Recipe|null{
  const a=pool.filter(r=>!usedIds.has(r.id));return a.length? a[Math.floor(Math.random()*a.length)] : null
}

function doPick(){
  if(!pregnancyStore.currentPregnancy){message.warning('请先在设置中完善孕期信息');return}
  if(allRecipes.value.length===0){message.error('食谱数据加载中，请稍后重试');return}
  let pool=filterByStage(allRecipes.value,currentStage.value)
  if(pool.length<15){
    const stages=['preparing','early','mid','late','nursing']
    const idx=stages.indexOf(currentStage.value);const extra:string[]=[]
    if(idx>0)extra.push(stages[idx-1]);if(idx<stages.length-1)extra.push(stages[idx+1])
    const expanded=allRecipes.value.filter(r=>(r.suitable_stage||[]).includes(currentStage.value)||(r.suitable_stage||[]).includes(extra[0])||(r.suitable_stage||[]).includes(extra[1]))
    if(expanded.length>pool.length)pool=expanded
  }
  if(pool.length<10)pool=[...allRecipes.value]
  const finalPool=pool.filter(r=>!recentUsedIds.value.has(r.id)).length>=10 ? pool.filter(r=>!recentUsedIds.value.has(r.id)) : pool
  const shuffled=shuffle(finalPool);const used=new Set<string>()
  const byCat=(cat:string)=>shuffled.filter(r=>r.category===cat)
  const pick=(...lists:Recipe[][])=>{
    for(const list of lists){const avail=list.filter(r=>r&&!used.has(r.id))
      if(avail.length>0){const r=avail[Math.floor(Math.random()*avail.length)];used.add(r.id);return r}}
    return null
  }
  const stapleCat=byCat('主食品'),breakfastCat=byCat('早餐'),meatCat=byCat('荤菜')
  const veggieCat=byCat('素菜'),soupCat=byCat('汤品'),drinkCat=byCat('饮品'),dessertCat=byCat('甜品')

  meals.value={
    breakfast:{staple:pick(breakfastCat,stapleCat.filter(r=>/粥|面|糊|饭|饺|饼/.test(r.name)),stapleCat),meat:null,veggie:null,soup:null,
      drink:pick(drinkCat,breakfastCat.filter(r=>/豆浆|奶|汁|茶|水/.test(r.name))),
      dessert:pick(dessertCat.filter(r=>/羹|汤圆|奶|糕/.test(r.name)),dessertCat,stapleCat.filter(r=>/糊|粥/.test(r.name)))},
    lunch:{staple:pick(stapleCat.filter(r=>/饭|面|饺|饼|馒|包/.test(r.name)),stapleCat,breakfastCat),
      meat:pick(meatCat),veggie:pick(veggieCat),soup:pick(soupCat),drink:null,dessert:null},
    dinner:{staple:pick(stapleCat.filter(r=>/粥|面|饭|糊/.test(r.name)),stapleCat,breakfastCat),
      meat:pick(meatCat.filter(r=>r.id!==meals.value.lunch.meat?.id),meatCat),
      veggie:pick(veggieCat.filter(r=>r.id!==meals.value.lunch.veggie?.id),veggieCat),
      soup:pick(soupCat.filter(r=>r.id!==meals.value.lunch.soup?.id),soupCat),drink:null,dessert:null},
  }
  ;[meals.value.breakfast.staple,meals.value.breakfast.drink,meals.value.breakfast.dessert,
    meals.value.lunch.staple,meals.value.lunch.meat,meals.value.lunch.veggie,meals.value.lunch.soup,
    meals.value.dinner.staple,meals.value.dinner.meat,meals.value.dinner.veggie,meals.value.dinner.soup]
    .filter(Boolean).forEach(r=>{recentUsedIds.value.add(r!.id)})
  if(recentUsedIds.value.size>MAX_RECENT){const arr=Array.from(recentUsedIds.value);recentUsedIds.value=new Set(arr.slice(arr.length-MAX_RECENT))}
}

interface FoodSafetyItem{name:string;safety_by_stage:Record<string,string>;note:string;image:string|null}
interface FoodSafetyCategory{name:string;icon:string;items:FoodSafetyItem[]}
const categoryList=ref<FoodSafetyCategory[]>([])
const safetyLoading=ref(false);const activeCategory=ref('')
const searchKeyword=ref('');const searchResults=ref<FoodSafetyItem[]>([])
const activeCategoryData=computed(()=>activeCategory.value?categoryList.value.find(c=>c.name===activeCategory.value)||null:null)
function selectCategory(n:string){activeCategory.value=n;searchResults.value=[];searchKeyword.value=''}
async function doSearch(){if(!searchKeyword.value.trim())return;try{const res:any=await searchFood(searchKeyword.value.trim());searchResults.value=res?.data||[];activeCategory.value=''}catch{message.error('搜索失败')}}
function clearSearch(){searchResults.value=[];searchKeyword.value=''}

async function loadAllRecipes(){recipesLoading.value=true;try{const res:any=await getAllRecipes();allRecipes.value=res?.data||[]}catch(e){console.error(e)}finally{recipesLoading.value=false}}
async function loadFoodSafety(){safetyLoading.value=true;try{const res:any=await getFoodSafety();categoryList.value=res?.data||[];if(categoryList.value.length>0)activeCategory.value=categoryList.value[0].name}catch(e){console.error(e);message.error('失败')}finally{safetyLoading.value=false}}

import { onMounted } from 'vue'
onMounted(()=>{loadAllRecipes();loadFoodSafety()})

// ─── 新增：孕期食谱 & 婴儿喂养 数据 ───

const rawStageKey = (() => {
  // 复用 useGestationalAge 的逻辑
  try {
    const w = pregnancyStore.gestationalAge?.weeks ?? 20
    if (w <= 0) return 'preparing'
    if (w <= 13) return 'early'
    if (w <= 27) return 'mid'
    if (w <= 42) return 'late'
    return 'postpartum'
  } catch { return 'mid' }
})()
const dietStageKey = ref(rawStageKey)

const currentDietStage = computed(() => {
  const map:Record<string,{name:string;desc:string;nutrients:string[]}> = {
    preconception: { name:'备孕期', desc:'为受孕和胎儿早期发育打下坚实基础', nutrients:['叶酸','铁','蛋白质','黑豆'] },
    early: { name:'孕早期（1-12周）', desc:'器官分化关键期，重点叶酸/DHA/碘', nutrients:['叶酸','DHA','碘','碳水'] },
    mid: { name:'孕中期（13-28周）', desc:'快速增长期，重点铁/钙/DHA/蛋白质', nutrients:['铁','钙','DHA','蛋白质','纤维'] },
    late: { name:'孕晚期（29-40周）', desc:'冲刺待产，重点钙/铁/锌/维K', nutrients:['钙','铁','锌','维K','纤维'] },
    postpartum: { name:'月子期', desc:'四阶段科学调理恢复身体', nutrients:['蛋白质','钙','铁','胶原蛋白'] },
  }
  return map[dietStageKey.value] || map.mid
})

// ─── 孕期食谱数据 ───
interface SimpleRcp { emoji:string; name:string; tag:string; tagType?:'info'|'success'|'warning'|'error'|'default'; desc:string; ingredients?:string }

const earlyRecipes:SimpleRcp[]=[
  { emoji:'🥣', name:'猪肚大米粥', tag:'安胎养胃', desc:'补益气血，适合食欲不振的孕妈妈' },
  { emoji:'🥬', name:'香菇油菜', tag:'增强免疫', desc:'清淡爽口，增强抵抗力' },
  { emoji:'🍜', name:'番茄鸡蛋打卤面', tag:'缓解疲劳', desc:'番茄VC+卵磷脂，面条易消化' },
  { emoji:'🥬', name:'韭菜炒绿豆芽', tag:'开胃助消', desc:'清淡爽口，缓解孕早期食欲不振' },
  { emoji:'🌰', name:'板栗烧白菜', tag:'补DHA', desc:'板栗不饱和脂肪酸+白菜清爽' },
  { emoji:'🧈', name:'海带结烧豆腐', tag:'促进脑发育', desc:'海带补碘+豆腐植物蛋白' },
  { emoji:'🐟', name:'鳕鱼豆腐羹', tag:'新陈代谢', desc:'低脂高蛋白易消化吸收' },
]

const midRecipes:SimpleRcp[]=[
  { emoji:'🩸', name:'猪血炖豆腐', tag:'补铁补蛋白', tagType:'error', desc:'猪血含铁量高且吸收率好' },
  { emoji:'🦐', name:'水晶虾仁', tag:'补DHA', tagType:'info', desc:'虾仁富含优质蛋白和DHA' },
  { emoji:'🌽', name:'鲜奶玉米汤', tag:'补钙', tagType:'success', desc:'牛奶补钙+玉米膳食纤维' },
  { emoji:'🐔', name:'竹笋炒鸡丝', tag:'低脂高蛋白', desc:'鸡肉优质蛋白+竹笋清爽' },
  { emoji:'🫘', name:'芸豆卷+红烧冬瓜', tag:'利水消肿', desc:'芸豆健脾+冬瓜消肿' },
  { emoji:'🥣', name:'牛奶小米粥', tag:'安神助眠', desc:'小米养胃+牛奶助眠' },
  { emoji:'🫒', name:'琥珀核桃', tag:'健脑益智', desc:'核桃富含卵磷脂和不饱和脂肪酸' },
  { emoji:'🍅', name:'番茄炒鸡蛋', tag:'健脑益智', desc:'经典搭配双重营养' },
  { emoji:'🥬', name:'油菜土豆粥', tag:'缓解便秘', desc:'富含膳食纤维促进肠道蠕动' },
  { emoji:'🍠', name:'红薯牛奶汁', tag:'润肠通便', desc:'红薯纤维+牛奶补钙' },
  { emoji:'🥣', name:'小米花生粥', tag:'补脑解压', desc:'小米安神+花生有益脂肪酸' },
  { emoji:'🐟', name:'清炒鳝鱼', tag:'补DHA', desc:'鳝鱼富含DHA，胎儿脑发育优质食材' },
]

const lateRecipes:SimpleRcp[]=[
  { emoji:'🫘', name:'小米黄豆粥', tag:'缓解便秘', desc:'黄豆植物蛋白+纤维' },
  { emoji:'🥐', name:'葱香花卷', tag:'储备热量', desc:'为分娩储备能量' },
  { emoji:'🧅', name:'洋葱炒鸡蛋', tag:'降血压', desc:'前列腺素A预防妊娠高血压' },
  { emoji:'🥣', name:'海带黄豆粥', tag:'抑血压', desc:'海带碘钾+黄豆蛋白' },
  { emoji:'🐟', name:'清炖鲫鱼', tag:'防早产', desc:'补虚+铜元素' },
  { emoji:'🧈', name:'滑炒豆腐', tag:'清洁肠胃', desc:'嫩滑易消化+钙含量丰富' },
  { emoji:'🎃', name:'南瓜牛奶大米粥', tag:'补钙', desc:'南瓜甜糯+牛奶温润' },
  { emoji:'🥩', name:'金针肥牛', tag:'补蛋白', desc:'肥牛铁蛋白+金针菇纤维' },
  { emoji:'🥬', name:'蒜蓉空心菜', tag:'调肠胃', desc:'清热通便+蒜蓉杀菌' },
  { emoji:'🍊', name:'金橘菠菜豆浆', tag:'补VC', desc:'金橘菠菜VC+豆浆植物蛋白' },
  { emoji:'🍤', name:'青菜虾仁粥', tag:'增免疫', desc:'清淡鲜美储备体力' },
  { emoji:'🥣', name:'莲子大米粥', tag:'静心安神', desc:'缓解产前焦虑帮助安眠' },
]

const postpartumRecipes:SimpleRcp[]=[
  { emoji:'🍵', name:'生化汤', tag:'每日份', tagType:'warning', ingredients:'当归40g 川芎30g 桃仁25g 烤老姜25g 蜜甘草25g 米酒水1050ml', desc:'砂锅大火煮沸转小火60分钟，分六次餐前饮用。顺产连服7天。' },
  { emoji:'🍵', name:'养肝汤', tag:'每日份', tagType:'warning', ingredients:'红枣7粒 热开水300ml（产后改米酒水）', desc:'红枣划口冲泡8小时后蒸1小时，汤汁当茶分数次喝完。' },
  { emoji:'🍚', name:'四神粥', tag:'月子基础', tagType:'success', ingredients:'薏仁100g 通心莲50g 茨实10g 山药50g', desc:'所有材料熬成粥，健脾养胃是月子餐的基础粥品。' },
  { emoji:'🍡', name:'甜糯米粥', tag:'每日份', tagType:'default', ingredients:'糯米50g 米酒水1220ml 桂圆5粒 红糖30g', desc:'电饭锅煮40分钟熄火加红糖。糯米粘肠但难消化不可一次多食。' },
  { emoji:'🫘', name:'红豆汤', tag:'每日份', tagType:'error', ingredients:'红豆70g 带皮老姜10g 米酒水1220ml 红糖30g', desc:'泡8小时后高压锅25-35分钟至开花，早10点和下午3点分两次吃。' },
]

// ─── 婴儿辅食数据 ───
const transitionRecipes:SimpleRcp[]=[
  { emoji:'🍚', name:'米粉糊', tag:'第一口辅食', ingredients:'婴儿米粉1勺 温水适量', desc:'温水调成稀糊状，初次从1勺开始逐渐加量' },
  { emoji:'🥕', name:'胡萝卜汁', tag:'补维A', ingredients:'胡萝卜1根', desc:'洗净切小块煮烂，纱布过滤取汁，加温水稀释' },
  { emoji:'🍎', name:'苹果汁', tag:'', ingredients:'新鲜苹果半个', desc:'去皮去核切小块榨汁，1:1加温水稀释' },
  { emoji:'🥬', name:'油菜水', tag:'', ingredients:'嫩油菜叶20g', desc:'切碎沸水煮2分钟滤出菜水温后喂食' },
  { emoji:'🥔', name:'土豆泥', tag:'5M+', ingredients:'土豆半个', desc:'去皮切块蒸熟压成细腻泥状，加少量温水或母乳' },
  { emoji:'🥚', name:'蛋黄泥', tag:'注意过敏', ingredients:'鸡蛋1个', desc:'煮熟取蛋黄碾碎调糊，初次只喂1/8个观察3天' },
]

const growingRecipes:SimpleRcp[]=[
  { emoji:'🐟', name:'鲜鱼泥', tag:'优质蛋白', ingredients:'鳕鱼/鲈鱼肉30g', desc:'隔水蒸熟压成泥，可加入少量米汤调稀' },
  { emoji:'🥩', name:'肝泥', tag:'补铁', ingredients:'新鲜猪肝/鸡肝20g', desc:'去筋膜煮熟压碎过筛拌入米粉或粥，每周≤2次' },
  { emoji:'🥬', name:'蔬菜粥', tag:'', ingredients:'大米30g 青菜叶20g', desc:'大米煮烂粥，青菜焯水切碎末拌入再煮2分钟' },
  { emoji:'🥚', name:'蛋黄羹', tag:'8M+', ingredients:'鸡蛋1个 温水适量', desc:'蛋黄打散加1.5倍温水搅匀过筛，小火蒸8-10分钟' },
  { emoji:'🍗', name:'鸡肉泥', tag:'8M+', ingredients:'鸡胸肉30g', desc:'姜片煮熟剁成肉末加少量汤调成泥状' },
  { emoji:'🥣', name:'山药红枣粥', tag:'8M+', ingredients:'山药30g 红枣3颗 大米30g', desc:'山药切丁红枣去核切碎同煮至软烂约40分钟' },
]

const advancedRecipes:SimpleRcp[]=[
  { emoji:'🍜', name:'疙瘩汤', tag:'9M+ 主食', ingredients:'面粉50g 鸡蛋1个 青菜20g', desc:'面粉搅小面疙瘩水开下锅煮3-5分钟打入蛋花加青菜' },
  { emoji:'🥬', name:'碧菠浓汤', tag:'9M+', ingredients:'菠菜50g 土豆半个', desc:'菠菜焯水去草酸切碎，土豆蒸熟压泥加水煮浓汤' },
  { emoji:'🍠', name:'红薯粥', tag:'9M+', ingredients:'红薯半个 大米30g', desc:'红薯切丁与大米同煮至软烂约40分钟' },
  { emoji:'🐟', name:'鱼丝烩粟米', tag:'10M+', ingredients:'鱼肉50g 嫩玉米30g 鸡蛋半个', desc:'鱼肉撕丝玉米煮熟，煮沸淋入蛋液搅成蛋花' },
  { emoji:'🥩', name:'豌豆牛肉粥', tag:'10M+', ingredients:'牛肉末20g 豌豌豆20g 大米30g', desc:'豌豆煮烂压泥，八成熟加牛肉末搅匀煮熟' },
  { emoji:'🐟', name:'清蒸鱼饼', tag:'11M+', ingredients:'鱼肉80g 鸡蛋半个 面粉少许', desc:'鱼肉剁泥加蛋液面粉搅拌上劲做成小饼蒸12-15分钟' },
  { emoji:'🍝', name:'番茄肉末面', tag:'11M+', ingredients:'婴儿面条30g 番茄半个 猪肉末20g', desc:'番茄去皮切碎炒散肉末加番茄汁煮开下面条' },
]

// ─── 催奶食谱 ───
const boostCat = ref('pig')

const pigRecipes:SimpleRcp[]=[
  { emoji:'🍖', name:'猪蹄黄豆汤', tag:'经典催乳', ingredients:'猪蹄1只 黄豆60g 黄花菜30g', desc:'共煮烂入油盐调味，2-3日一剂连服3剂' },
  { emoji:'🥜', name:'花生猪蹄汤', tag:'补血下奶', ingredients:'花生200g 猪蹄2只', desc:'猪蹄净毛斩块加足水花生调料小火炖2小时至酥烂' },
  { emoji:'🌿', name:'猪蹄通草汤', tag:'通乳下奶', ingredients:'猪蹄1只 通草10g 水1500ml', desc:'大火开后小火煮1-2小时，每天一次连服3-5天' },
  { emoji:'🥬', name:'酸菜猪手煲', tag:'开胃催乳', ingredients:'猪手1只 川酸菜 花生', desc:'斩开焯水5分钟捞出，大火30分钟后小火慢炖1小时' },
]

const fishRecipes:SimpleRcp[]=[
  { emoji:'🐟', name:'鲫鱼炖木瓜', tag:'催乳圣品', ingredients:'鲫鱼1条 木瓜半颗 红枣10颗', desc:'鲫鱼略煎后另起锅加木瓜红枣料酒小火煲2小时' },
  { emoji:'🥒', name:'丝瓜鲫鱼汤', tag:'清热通乳', ingredients:'活鲫鱼500g 丝瓜200g', desc:'鲫鱼略煎两面烹黄酒加姜葱小火焖炖20分钟加丝瓜旺火煮至乳白' },
  { emoji:'🔴', name:'赤豆鲫鱼汤', tag:'产前安胎产后通乳', ingredients:'鲫鱼1条 赤小豆50g', desc:'赤豆浸泡2小时煮至七成熟加鲫鱼文火煮至烂熟' },
  { emoji:'🐙', name:'乌鱼通草汤', tag:'通经下乳', ingredients:'乌鱼1条 通草3g', desc:'所有食材共炖熟，吃鱼喝汤每日一次' },
  { emoji:'🥒', name:'冬瓜鲫鱼汤', tag:'利水通乳', ingredients:'鲫鱼1-2尾 冬瓜', desc:'冷水锅大火烧开改小火慢炖至汤汁奶白下冬瓜片调味' },
]

const chickenRecipes:SimpleRcp[]=[
  { emoji:'🐔', name:'黄芪炖鸡汤', tag:'产后5-7天后', ingredients:'黄芪50g 枸杞15g 红枣10个 母鸡1只', desc:'药材放滤袋母鸡焯水切块小火炖焖1小时加盐米酒' },
  { emoji:'🐓', name:'母鸡炖山药', tag:'脾胃虚弱少乳', ingredients:'母鸡1只 黄芪30g 党参15g 山药15g', desc:'药材置入鸡肚浇黄酒隔水蒸熟1-2天内吃完' },
  { emoji:'🖤', name:'清炖乌骨鸡汤', tag:'产后虚弱', ingredients:'乌骨鸡肉1000g 党参15g 黄芪25g 枸杞15g', desc:'鸡肉切碎拌匀葱姜盐酒上铺药材隔水蒸20分钟' },
]

const vegRecipes:SimpleRcp[]=[
  { emoji:'🥭', name:'木瓜花生大枣汤', tag:'显著增加乳汁', ingredients:'木瓜750g 花生150g 大枣5粒 片糖', desc:'木瓜去皮切块加8碗水加片糖文火煲2小时' },
  { emoji:'⚫', name:'黑芝麻粥', tag:'补肝肾通乳', ingredients:'黑芝麻25g 大米适量', desc:'黑芝麻捻碎大米洗净加水煮成粥每日2-3次' },
  { emoji:'🧈', name:'豆腐煮红糖', tag:'简单有效', ingredients:'豆腐120g 红糖30g 黄酒一小杯', desc:'加水一碗半文火煮成一碗加黄酒调服5-7次有效' },
  { emoji:'🍶', name:'酒酿蛋花汤', tag:'益气活血', ingredients:'酒酿1块 鸡蛋1个', desc:'酒酿加水煮开打入鸡蛋煮成蛋花状趁热服用' },
]
</script>

<style scoped>
/* ─── 原有样式 ─── */
.diet-view { max-width: 800px; margin: 0 auto; padding: 16px; }
.spin-section { display: flex; flex-direction: column; align-items: center; padding: 20px 0; }
.random-area { text-align: center; padding: 48px 20px; background: linear-gradient(135deg,#fef3c7,#fce7f3); border-radius: 16px; margin-bottom: 24px; width: 100%; max-width: 400px; }
.random-icon { font-size: 64px; margin-bottom: 12px; }
.random-title { font-size: 18px; font-weight: 600; color: #64748b; margin-bottom: 20px; }
.meals-result { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 12px; }
.meal-card { background: white; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.05); border-left: 4px solid var(--primary-color,#c44680); }
.meal-label { font-size: 15px; font-weight: 700; color: var(--primary-color,#c44680); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px dashed #f3e8f0; }
.meal-combo { display: flex; flex-direction: column; gap: 8px; }
.combo-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
.combo-tag { flex-shrink: 0; font-size: 12px; font-weight: 600; color: white; background: #f8a4c8; padding: 2px 8px; border-radius: 10px; min-width: 52px; text-align: center; }
.combo-name { font-size: 15px; font-weight: 700; color: #1e293b; }
.combo-desc { font-size: 11px; color: #94a3b8; margin-left: 8px; flex-shrink: 1; min-width: 0; max-width: 180px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.refresh-btn { margin-top: 12px; }
.safety-section { padding-top: 8px; }
.category-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 16px 0; }
.category-tab { padding: 6px 14px; border-radius: 20px; font-size: 13px; cursor: pointer; background: var(--bg-color,#f8fafc); border: 1px solid var(--border-color,#e2e8f0); color: var(--text-secondary,#64748b); transition: all .2s; white-space: nowrap; }
.category-tab:hover { border-color: var(--stage-mid-color,#4FC3F7); color: var(--stage-mid-color,#4FC3F7); }
.category-tab.active { background: var(--stage-mid-color,#4FC3F7); border-color: var(--stage-mid-color,#4FC3F7); color: white; }
.food-list { margin-top: 8px; }
.food-list-title { font-size: 16px; font-weight: 700; margin-bottom: 12px; color: var(--text-color,#1e293b); }
.empty-state { padding: 40px 20px; text-align: center; }
.empty-text { font-size: 14px; color: var(--text-hint,#94a3b8); }
.loading-hint { display: flex; align-items: center; gap: 8px; justify-content: center; padding: 20px; color: var(--text-hint,#94a3b8); font-size: 14px; }
.loading-hint-center { padding: 60px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--text-hint,#94a3b8); }
.loading-hint-center p { margin: 0; font-size: 14px; }
.no-meals-hint { text-align: center; padding: 24px; color: var(--text-hint,#94a3b8); font-size: 14px; background: white; border-radius: 12px; margin-top: 16px; }
.search-hint { cursor: pointer; color: var(--primary-color,#c44680); font-size: 12px; }

/* ─── 新增：饮食指南样式 ─── */
.guide-body { padding: 4px 0 24px; }

/* 阶段横幅 */
.stage-banner {
  border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; color: #fff; text-align: center;
}
.stage-preconception { background: linear-gradient(135deg,#a78bfa,#8b5cf6); }
.stage-early { background: linear-gradient(135deg,#f472b6,#ec4899); }
.stage-mid { background: linear-gradient(135deg,#34d399,#10b981); }
.stage-late { background: linear-gradient(135deg,#fb923c,#ea580c); }
.stage-postpartum { background: linear-gradient(135deg,#f59e0b,#d97706); }
.stage-banner h3 { font-size: 17px; font-weight: 700; margin: 0 0 4px; }
.stage-banner p { font-size: 13px; opacity: 0.88; margin: 0 0 10px; }
.stage-tags { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; }

/* 提示框 */
.dg-tip { border-radius: 8px; padding: 10px 14px; display: flex; gap: 8px; align-items: flex-start; font-size: 13.5px; line-height: 1.55; margin: 10px 0; }
.dg-tip .tip-icon { font-size: 17px; flex-shrink: 0; }
.dg-tip strong { font-size: 12.5px; }
.dg-tip-pink   { background:#fef3f0;border-left:3px solid #ec4899;color:#9d174d; }
.dg-tip-green  { background:#f0fdf4;border-left:3px solid #22c55e;color:#166534; }
.dg-tip-yellow { background:#fffbeb;border-left:3px solid #eab308;color:#854d0e; }
.dg-tip-blue   { background:#eff6ff;border-left:3px solid #3b82f6;color:#1e40af; }
.dg-tip-warn   { background:#fff7ed;border-left:3px solid #f97316;color:#9a3412; }
.dg-tip-red    { background:#fef2f2;border-left:3px solid #ef4444;color:#991b1b; }
.dg-tip-info   { background:#f8fafc;border-left:3px solid #64748b;color:#334155; }

/* 营养网格 */
.nutrient-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(150px,1fr)); gap: 8px; margin: 12px 0; }
.nut-item { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; text-align: center; }
.nut-item strong { display: block; font-size: 14px; color: #334155; margin-bottom: 2px; }
.nut-item small { font-size: 11.5px; color: #94a3b8; }

/* 小标题 */
.sec-title { font-size: 15px; font-weight: 700; margin: 18px 0 10px; color: #334155; }

/* 食物表格 */
.food-table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 13px; }
.ft-row { display: grid; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
.ft-head { background: #f1f5f9; border-radius: 6px 6px 0 0; font-weight: 600; font-size: 12.5px; color: #475569; }
.ft-row span:nth-child(1) { font-weight: 600; color: #334155; min-width: 56px; }
.ft-row span:nth-child(3) { color: #64748b; font-size: 12px; }

/* 食谱网格 */
.recipe-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(240px,1fr)); gap: 10px; margin: 8px 0 14px; }
.rcp-card { background: #fafafa; border: 1px solid #eee; border-radius: 10px; padding: 14px 16px; transition: transform .15s; }
.rcp-card:hover { transform: translateY(-1px); box-shadow: 0 2px 8px rgba(0,0,0,.06); }
.rcp-name { font-size: 14.5px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
.rcp-desc { font-size: 12.5px; color: #64748b; line-height: 1.55; margin: 4px 0 0; }
.rcp-ingr { font-size: 11.5px; color: #94a3b8; margin: 2px 0; }

/* 哺乳姿势 */
.pos-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(180px,1fr)); gap: 10px; margin: 10px 0; }
.pos-card { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 14px; text-align: center; }
.pos-icon { font-size: 28px; display: block; margin-bottom: 6px; }
.pos-card strong { font-size: 13.5px; color: #1d4ed8; display: block; margin-bottom: 4px; }
.pos-card p { font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; }

/* 两列布局 */
.two-col-box { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
.col-box { border-radius: 8px; padding: 12px 14px; font-size: 13px; line-height: 1.65; }
.col-box strong { display: block; font-size: 14px; margin-bottom: 6px; }
.col-box ul { margin: 0; padding-left: 18px; }
.col-box li { margin-bottom: 2px; }
.col-pink { background:#fef3f0;border-left:3px solid #ec4899;color:#9d174d; }
.col-blue { background:#eff6ff;border-left:3px solid #3b82f6;color:#1e40af; }
.col-green { background:#f0fdf4;border-left:3px solid #22c55e;color:#166534; }
.col-red { background:#fef2f2;border-left:3px solid #ef4444;color:#991b1b; }

/* 简单列表 */
.plain-list { list-style: none; padding: 0; margin: 8px 0; }
.plain-list li { padding: 6px 0 6px 22px; position: relative; border-bottom: 1px solid #f1f5f9; font-size: 13.5px; color: #475569; line-height: 1.55; }
.plain-list li::before { content:'•';position:absolute;left:6px;color:#3b82f6;font-weight:700; }
.plain-list li:last-child { border-bottom: none; }
.plain-list li strong { color: #1e293b; }

/* 催奶分类 */
.boost-cats { margin: 14px 0 10px; }

/* Collapse 微调 */
:deep(.n-collapse-item__header) { font-size: 15px !important; font-weight: 700 !important; padding: 12px 4px !important; }
:deep(.n-collapse-item__content-inner) { padding: 4px 0 16px !important; }

/* Baby theme tweaks */
.baby-theme .stage-banner { background: linear-gradient(135deg,#67e8f9,#22d3ee); }
.baby-theme .stage-banner h3,.baby-theme .stage-banner p { color: #0e7490; }

@media (max-width: 600px) {
  .diet-view { padding: 12px; }
  .random-area { padding: 32px 16px; }
  .random-icon { font-size: 48px; }
  .category-tabs { gap: 6px; }
  .category-tab { padding: 4px 10px; font-size: 12px; }
  .combo-desc { display: none; }
  .recipe-grid { grid-template-columns: 1fr; }
  .nutrient-grid { grid-template-columns: repeat(2,1fr); }
  .two-col-box { grid-template-columns: 1fr; }
  .pos-grid { grid-template-columns: 1fr; }
  .food-table .ft-row span:nth-child(3) { display: none; }
}
</style>
