/**
 * Rebuild food_safety_v3.json with multi-category structure.
 * Preserves existing 155 vegetable items, adds 9 more categories with common pregnancy-related foods.
 *
 * Run: node build-food-safety.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'food_safety_v3.json');
const OUT = SRC;

const raw = JSON.parse(fs.readFileSync(SRC, 'utf-8'));

const vegItems = [];
(raw.categories || []).forEach(c => {
  if (c.items && Array.isArray(c.items)) c.items.forEach(it => vegItems.push(it));
  else if (c.name) vegItems.push(c);
});

function stage(p, e, m, l, n) {
  return { preparing: p, early: e, mid: m, late: l, nursing: n };
}

function mk(name, safety, note, stages) {
  return { name, safety, note, safety_by_stage: stages };
}

const S_ALL_SAFE = stage('safe', 'safe', 'safe', 'safe', 'safe');
const S_EARLY_CAUTION = stage('safe', 'caution', 'safe', 'safe', 'safe');
const S_ALL_CAUTION = stage('caution', 'caution', 'caution', 'caution', 'caution');
const S_LIMIT_ALL = stage('limit', 'limit', 'limit', 'limit', 'limit');
const S_UNSAFE_PREG = stage('caution', 'unsafe', 'unsafe', 'unsafe', 'caution');
const S_LATE_CAUTION = stage('safe', 'safe', 'safe', 'caution', 'safe');

const fruits = [
  mk('苹果', 'safe', '富含膳食纤维和维生素C，全孕期可食', S_ALL_SAFE),
  mk('梨', 'safe', '润肺止咳，注意性凉孕早期适量', S_EARLY_CAUTION),
  mk('桃子', 'safe', '富含铁和维生素，注意去皮防过敏', S_ALL_SAFE),
  mk('葡萄', 'safe', '补铁补血，糖分较高需控量', S_ALL_SAFE),
  mk('西瓜', 'safe', '利尿解暑，性寒孕早期及晚期适量', stage('safe', 'caution', 'safe', 'caution', 'safe')),
  mk('香蕉', 'safe', '富含钾和镁，缓解腿抽筋和便秘', S_ALL_SAFE),
  mk('橙子', 'safe', '富含维生素C，促进铁吸收', S_ALL_SAFE),
  mk('柚子', 'safe', '富含叶酸和维生素C', S_ALL_SAFE),
  mk('橘子', 'safe', '富含维生素C，注意不要过量上火', S_ALL_SAFE),
  mk('柠檬', 'safe', '泡水饮用缓解孕吐效果好', S_ALL_SAFE),
  mk('草莓', 'safe', '富含维生素C和叶酸，注意清洗干净', S_ALL_SAFE),
  mk('樱桃', 'safe', '补铁佳品，适量食用', S_ALL_SAFE),
  mk('蓝莓', 'safe', '抗氧化作用强，富含花青素', S_ALL_SAFE),
  mk('芒果', 'caution', '热性水果，过敏体质慎食，孕早期适量', stage('safe', 'caution', 'caution', 'caution', 'safe')),
  mk('菠萝', 'caution', '含蛋白酶易过敏，建议盐水浸泡后少量食用', S_ALL_CAUTION),
  mk('火龙果', 'safe', '富含膳食纤维，缓解便秘', S_ALL_SAFE),
  mk('猕猴桃', 'safe', '维生素C之王，注意过敏', S_ALL_SAFE),
  mk('木瓜', 'avoid', '青木瓜含番木瓜碱可能引起宫缩，孕期建议避免', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'caution')),
  mk('山楂', 'avoid', '可能引起子宫收缩，孕早期及有先兆流产者禁食', stage('caution', 'unsafe', 'caution', 'caution', 'caution')),
  mk('桂圆', 'avoid', '性温热易上火助胎热，孕期不宜食用', stage('caution', 'unsafe', 'caution', 'caution', 'safe')),
  mk('荔枝', 'caution', '性温热，过量易上火，每天不超过5颗', stage('safe', 'caution', 'caution', 'caution', 'caution')),
  mk('榴莲', 'limit', '热量极高糖分大，妊娠糖尿病慎食', S_LIMIT_ALL),
  mk('椰子', 'safe', '椰子水补充电解质，椰肉适量食用', S_ALL_SAFE),
  mk('杏', 'safe', '富含胡萝卜素，适量食用', S_ALL_SAFE),
  mk('李子', 'safe', '适量食用，胃酸者注意', S_ALL_SAFE),
  mk('红枣', 'safe', '补铁补血佳品，每天不超过5颗', S_ALL_SAFE),
  mk('柿子', 'caution', '勿空腹食用，不与高蛋白食物同食', S_ALL_CAUTION),
  mk('石榴', 'safe', '富含维生素C和抗氧化物质', S_ALL_SAFE),
  mk('无花果', 'safe', '富含膳食纤维，缓解便秘', S_ALL_SAFE),
  mk('哈密瓜', 'safe', '富含维生素A和C', S_ALL_SAFE),
  mk('甜瓜', 'safe', '解渴生津，适量食用', S_EARLY_CAUTION),
  mk('杨梅', 'caution', '酸性较强，胃酸者少食', S_ALL_CAUTION),
  mk('百香果', 'safe', '富含维生素，可制饮品', S_ALL_SAFE),
];

const meats = [
  mk('猪肉', 'safe', '优质蛋白来源，选择瘦肉为佳', S_ALL_SAFE),
  mk('牛肉', 'safe', '富含铁和锌，预防孕期贫血', S_ALL_SAFE),
  mk('羊肉', 'safe', '性温补气血，冬季适宜', S_ALL_SAFE),
  mk('鸡肉', 'safe', '高蛋白低脂肪，孕期理想肉类', S_ALL_SAFE),
  mk('鸭肉', 'safe', '性凉适合孕期燥热，富含B族维生素', S_ALL_SAFE),
  mk('鹅肉', 'safe', '蛋白质含量高，适量食用', S_ALL_SAFE),
  mk('兔肉', 'safe', '高蛋白低脂肪低胆固醇', S_ALL_SAFE),
  mk('火鸡肉', 'safe', '低脂高蛋白', S_ALL_SAFE),
  mk('排骨', 'safe', '补钙佳品，可炖汤食用', S_ALL_SAFE),
  mk('猪蹄', 'safe', '富含胶原蛋白，孕晚期适量食用', S_ALL_SAFE),
  mk('猪肝', 'limit', '富铁富叶酸但维生素A极高，每周不超过50g', S_LIMIT_ALL),
  mk('鸡肝', 'limit', '维生素A含量高，每周不超过1次', S_LIMIT_ALL),
  mk('鹅肝', 'limit', '维生素A过量风险，孕期严格限量', S_LIMIT_ALL),
  mk('鸭肝', 'limit', '维生素A较高，孕期限量食用', S_LIMIT_ALL),
  mk('猪腰', 'caution', '可能含激素残留，孕期慎食', S_ALL_CAUTION),
  mk('猪血', 'safe', '补铁效果好，注意来源卫生', S_ALL_SAFE),
  mk('鸭血', 'safe', '补铁佳品，需充分煮熟', S_ALL_SAFE),
  mk('香肠', 'limit', '含亚硝酸盐和盐分高，限量食用', S_LIMIT_ALL),
  mk('火腿', 'limit', '加工肉制品，钠和添加剂多', S_LIMIT_ALL),
  mk('培根', 'caution', '李斯特菌风险，需彻底煮熟食用', S_ALL_CAUTION),
  mk('热狗', 'caution', '加工肉制品，需充分加热', S_ALL_CAUTION),
  mk('腊肉', 'limit', '高盐高亚硝酸盐，严格限量', S_LIMIT_ALL),
  mk('腊肠', 'limit', '加工腌制品，少食为宜', S_LIMIT_ALL),
  mk('烟熏肉', 'caution', '可能含致癌物，孕期慎食', S_ALL_CAUTION),
  mk('罐头肉', 'caution', '添加剂多，新鲜肉更佳', S_ALL_CAUTION),
];

const seafood = [
  mk('鲈鱼', 'safe', '高蛋白富含DHA，孕期推荐', S_ALL_SAFE),
  mk('鲫鱼', 'safe', '低汞优质蛋白，催乳佳品', S_ALL_SAFE),
  mk('鲤鱼', 'safe', '安胎催乳，孕期适宜', S_ALL_SAFE),
  mk('草鱼', 'safe', '蛋白质丰富，性温暖胃', S_ALL_SAFE),
  mk('三文鱼', 'safe', '富含DHA和Omega-3，每周2次', S_ALL_SAFE),
  mk('鳕鱼', 'safe', '优质蛋白低脂肪，DHA含量高', S_ALL_SAFE),
  mk('龙利鱼', 'safe', '刺少肉嫩，适合孕期食用', S_ALL_SAFE),
  mk('带鱼', 'safe', '富含DHA和卵磷脂', S_ALL_SAFE),
  mk('黄花鱼', 'safe', '富含蛋白质和微量元素', S_ALL_SAFE),
  mk('比目鱼', 'safe', '低汞鱼类，富含蛋白质', S_ALL_SAFE),
  mk('金枪鱼', 'limit', '含汞较高，每周不超过170g', S_LIMIT_ALL),
  mk('剑鱼', 'avoid', '汞含量极高，孕期禁食', S_UNSAFE_PREG),
  mk('鲨鱼', 'avoid', '汞含量极高，孕期禁食', S_UNSAFE_PREG),
  mk('马林鱼', 'avoid', '汞含量极高，孕期禁食', S_UNSAFE_PREG),
  mk('方头鱼', 'avoid', '汞含量极高，孕期禁食', S_UNSAFE_PREG),
  mk('鲶鱼', 'safe', '低汞经济实惠的鱼类', S_ALL_SAFE),
  mk('罗非鱼', 'safe', '低汞高蛋白', S_ALL_SAFE),
  mk('鳗鱼', 'safe', '富含DHA维生素A，适量食用', S_ALL_SAFE),
  mk('虾', 'safe', '低汞高蛋白补钙佳品', S_ALL_SAFE),
  mk('基围虾', 'safe', '低汞富含蛋白质，需彻底煮熟', S_ALL_SAFE),
  mk('龙虾', 'safe', '富含蛋白质，过敏体质慎食', S_ALL_SAFE),
  mk('皮皮虾', 'safe', '富含蛋白质，注意彻底煮熟', S_ALL_SAFE),
  mk('螃蟹', 'avoid', '性寒可能引起宫缩，蟹爪尤甚，孕早期禁食', stage('caution', 'unsafe', 'caution', 'caution', 'caution')),
  mk('大闸蟹', 'avoid', '性寒易致宫缩，孕期不建议食用', stage('caution', 'unsafe', 'unsafe', 'caution', 'caution')),
  mk('蛤蜊', 'caution', '需充分煮熟，避免寄生虫', S_ALL_CAUTION),
  mk('扇贝', 'safe', '富含蛋白质和锌，需煮熟', S_ALL_SAFE),
  mk('生蚝', 'caution', '生食有诺如病毒风险，必须熟食', S_ALL_CAUTION),
  mk('牡蛎', 'caution', '富含锌但需彻底煮熟', S_ALL_CAUTION),
  mk('鲍鱼', 'safe', '富含蛋白质，价格较高适量', S_ALL_SAFE),
  mk('海参', 'safe', '富含胶原蛋白，孕中晚期适宜', S_ALL_SAFE),
  mk('墨鱼', 'safe', '富含蛋白质和铁', S_ALL_SAFE),
  mk('鱿鱼', 'safe', '低脂高蛋白，注意彻底煮熟', S_ALL_SAFE),
  mk('章鱼', 'safe', '富含蛋白质和牛磺酸', S_ALL_SAFE),
  mk('海带', 'safe', '富含碘和膳食纤维，每周2-3次', S_ALL_SAFE),
  mk('紫菜', 'safe', '富含碘和优质蛋白', S_ALL_SAFE),
  mk('海蜇', 'caution', '可能含明矾，孕期不建议多食', S_ALL_CAUTION),
  mk('生鱼片', 'avoid', '寄生虫和细菌风险，孕期禁食', S_UNSAFE_PREG),
  mk('刺身', 'avoid', '生食有李斯特菌风险，孕期禁食', S_UNSAFE_PREG),
  mk('寿司', 'caution', '熟食寿司可吃，生鱼寿司禁食', S_ALL_CAUTION),
  mk('烟熏三文鱼', 'caution', '低温加工有李斯特菌风险，建议加热后食用', S_ALL_CAUTION),
];

const eggDairy = [
  mk('鸡蛋', 'safe', '优质蛋白来源，需充分煮熟', S_ALL_SAFE),
  mk('鸭蛋', 'safe', '富含蛋白质和铁，需煮熟食用', S_ALL_SAFE),
  mk('鹅蛋', 'safe', '蛋白质含量高，适量食用', S_ALL_SAFE),
  mk('鹌鹑蛋', 'safe', '小巧营养丰富，孕期理想零食', S_ALL_SAFE),
  mk('皮蛋', 'limit', '含铅风险，孕期严格限量或不吃', S_LIMIT_ALL),
  mk('咸鸭蛋', 'limit', '钠含量极高，孕期限量食用', S_LIMIT_ALL),
  mk('生鸡蛋', 'avoid', '沙门氏菌风险，孕期禁食', S_UNSAFE_PREG),
  mk('溏心蛋', 'caution', '半熟蛋黄有细菌风险，孕期建议全熟', S_ALL_CAUTION),
  mk('牛奶', 'safe', '补钙佳品，每天300-500ml', S_ALL_SAFE),
  mk('酸奶', 'safe', '益生菌助消化，每天1-2杯', S_ALL_SAFE),
  mk('巴氏奶', 'safe', '低温灭菌保留营养，孕期推荐', S_ALL_SAFE),
  mk('生牛奶', 'avoid', '未经巴氏消毒，李斯特菌风险', S_UNSAFE_PREG),
  mk('奶粉', 'safe', '可选孕妇奶粉补充营养', S_ALL_SAFE),
  mk('奶酪', 'caution', '硬质奶酪安全，软质未消毒奶酪禁食', S_ALL_CAUTION),
  mk('软奶酪', 'caution', '布里、卡门贝尔等软奶酪需确认巴氏消毒', S_ALL_CAUTION),
  mk('奶油', 'safe', '适量食用，注意热量和糖分', S_ALL_SAFE),
  mk('黄油', 'safe', '适量食用', S_ALL_SAFE),
  mk('炼乳', 'limit', '糖分极高，限量食用', S_LIMIT_ALL),
];

const beans = [
  mk('豆腐', 'safe', '植物蛋白补钙佳品', S_ALL_SAFE),
  mk('豆浆', 'safe', '补充优质蛋白，需彻底煮沸', S_ALL_SAFE),
  mk('豆皮', 'safe', '蛋白质浓缩品，适量食用', S_ALL_SAFE),
  mk('千张', 'safe', '高蛋白食材', S_ALL_SAFE),
  mk('腐竹', 'safe', '蛋白质含量高，适量食用', S_ALL_SAFE),
  mk('豆干', 'safe', '便携高蛋白零食', S_ALL_SAFE),
  mk('纳豆', 'safe', '富含维生素K和益生菌', S_ALL_SAFE),
  mk('毛豆', 'safe', '富含蛋白质和叶酸', S_ALL_SAFE),
  mk('黄豆', 'safe', '高蛋白优质植物来源', S_ALL_SAFE),
  mk('黑豆', 'safe', '补肾益气，富含花青素', S_ALL_SAFE),
  mk('红豆', 'safe', '利水消肿，孕晚期适宜', S_ALL_SAFE),
  mk('绿豆', 'safe', '清热解暑，性凉孕早期适量', S_EARLY_CAUTION),
  mk('芸豆', 'safe', '富含蛋白质和铁', S_ALL_SAFE),
  mk('扁豆', 'caution', '必须彻底煮熟，否则有毒', S_ALL_CAUTION),
  mk('四季豆', 'caution', '必须彻底煮熟，否则含皂素中毒', S_ALL_CAUTION),
  mk('豇豆', 'safe', '富含蛋白质和维生素', S_ALL_SAFE),
];

const grains = [
  mk('大米', 'safe', '主食基础，全孕期可食', S_ALL_SAFE),
  mk('糯米', 'safe', '黏性高，消化稍慢，适量食用', S_ALL_SAFE),
  mk('小米', 'safe', '养胃健脾，孕早期缓解孕吐', S_ALL_SAFE),
  mk('燕麦', 'safe', '富含膳食纤维，预防便秘', S_ALL_SAFE),
  mk('薏米', 'avoid', '可能引起子宫收缩，孕期建议避免', stage('caution', 'unsafe', 'caution', 'caution', 'safe')),
  mk('玉米', 'safe', '富含B族维生素和膳食纤维', S_ALL_SAFE),
  mk('荞麦', 'safe', '低GI主食，适合妊娠糖尿病', S_ALL_SAFE),
  mk('藜麦', 'safe', '完全蛋白主食，营养丰富', S_ALL_SAFE),
  mk('糙米', 'safe', '富含B族维生素和膳食纤维', S_ALL_SAFE),
  mk('黑米', 'safe', '补血佳品，富含花青素', S_ALL_SAFE),
  mk('面粉', 'safe', '主食基础', S_ALL_SAFE),
  mk('面条', 'safe', '易消化的主食', S_ALL_SAFE),
  mk('馒头', 'safe', '中式主食，全孕期可食', S_ALL_SAFE),
  mk('面包', 'safe', '注意选择全麦或低糖产品', S_ALL_SAFE),
  mk('意大利面', 'safe', '低GI主食，适量食用', S_ALL_SAFE),
  mk('年糕', 'limit', '黏性大消化慢，妊娠糖尿病慎食', S_LIMIT_ALL),
  mk('粽子', 'limit', '糯米难消化，适量食用', S_LIMIT_ALL),
  mk('汤圆', 'limit', '糖油馅料高热量，限量食用', S_LIMIT_ALL),
  mk('八宝粥', 'safe', '营养均衡的孕期主食', S_ALL_SAFE),
];

const nuts = [
  mk('核桃', 'safe', 'Omega-3丰富，促进胎儿大脑发育，每天1-2个', S_ALL_SAFE),
  mk('杏仁', 'safe', '富含维生素E和健康脂肪', S_ALL_SAFE),
  mk('巴旦木', 'safe', '富含蛋白质和维生素E', S_ALL_SAFE),
  mk('腰果', 'safe', '富含锌和铁，注意过敏', S_ALL_SAFE),
  mk('开心果', 'safe', '富含蛋白质和健康脂肪', S_ALL_SAFE),
  mk('夏威夷果', 'safe', '健康脂肪含量高，每天5-6颗', S_ALL_SAFE),
  mk('松子', 'safe', '富含矿物质，适量食用', S_ALL_SAFE),
  mk('花生', 'safe', '富含蛋白质和叶酸，过敏者禁食', S_ALL_SAFE),
  mk('瓜子', 'safe', '富含维生素E，注意盐分', S_ALL_SAFE),
  mk('葵花籽', 'safe', '富含维生素E和叶酸', S_ALL_SAFE),
  mk('芝麻', 'safe', '补钙补铁佳品', S_ALL_SAFE),
  mk('栗子', 'safe', '富含淀粉和维生素，适量食用', S_ALL_SAFE),
  mk('葡萄干', 'safe', '便携补铁零食', S_ALL_SAFE),
  mk('蔓越莓干', 'safe', '预防尿路感染，适量食用', S_ALL_SAFE),
  mk('龙眼干', 'caution', '性温热易上火，孕期不宜多食', stage('safe', 'caution', 'caution', 'caution', 'safe')),
  mk('桂圆干', 'caution', '性温热助胎热，孕期慎食', stage('safe', 'caution', 'caution', 'caution', 'safe')),
];

const seasonings = [
  mk('食盐', 'safe', '每日不超过6g，妊娠高血压减半', S_ALL_SAFE),
  mk('酱油', 'safe', '适量使用调味', S_ALL_SAFE),
  mk('醋', 'safe', '开胃助消化，缓解孕吐', S_ALL_SAFE),
  mk('白糖', 'limit', '控制添加糖摄入，妊娠糖尿病严格限制', S_LIMIT_ALL),
  mk('红糖', 'safe', '富含矿物质，适量食用', S_ALL_SAFE),
  mk('冰糖', 'safe', '适量食用', S_ALL_SAFE),
  mk('蜂蜜', 'safe', '一岁以下婴儿禁食，孕妇适量', S_ALL_SAFE),
  mk('味精', 'safe', '适量使用，过量不利于钙吸收', S_ALL_SAFE),
  mk('鸡精', 'safe', '适量调味使用', S_ALL_SAFE),
  mk('料酒', 'safe', '烹饪用酒精挥发后无害', S_ALL_SAFE),
  mk('八角', 'caution', '少量调味可以，孕期避免大量', S_ALL_CAUTION),
  mk('花椒', 'caution', '少量调味，避免过量上火', S_ALL_CAUTION),
  mk('辣椒', 'caution', '少量可以，过量易便秘上火', S_ALL_CAUTION),
  mk('胡椒', 'caution', '性热少量调味', S_ALL_CAUTION),
  mk('五香粉', 'caution', '少量调味', S_ALL_CAUTION),
  mk('十三香', 'caution', '少量调味', S_ALL_CAUTION),
  mk('咖喱粉', 'caution', '少量调味，注意辛辣', S_ALL_CAUTION),
  mk('芥末', 'caution', '辛辣刺激，孕期慎食', S_ALL_CAUTION),
  mk('番茄酱', 'safe', '适量调味使用', S_ALL_SAFE),
  mk('沙拉酱', 'limit', '高热量，限量使用', S_LIMIT_ALL),
];

const drinks = [
  mk('白开水', 'safe', '孕期最佳饮品，每日1500-1700ml', S_ALL_SAFE),
  mk('矿泉水', 'safe', '补充水分和矿物质', S_ALL_SAFE),
  mk('纯净水', 'safe', '日常饮用安全', S_ALL_SAFE),
  mk('椰子水', 'safe', '天然电解质，补充水分', S_ALL_SAFE),
  mk('鲜榨果汁', 'safe', '不加糖适量饮用，最佳吃水果本身', S_ALL_SAFE),
  mk('瓶装果汁', 'limit', '含糖量高，建议少喝', S_LIMIT_ALL),
  mk('咖啡', 'caution', '每日咖啡因不超过200mg（约1杯）', stage('safe', 'caution', 'caution', 'caution', 'caution')),
  mk('浓咖啡', 'avoid', '咖啡因含量过高，孕期不建议', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'caution')),
  mk('速溶咖啡', 'caution', '每日不超过1杯', S_ALL_CAUTION),
  mk('奶茶', 'caution', '含咖啡因和高糖，每周不超过1次', S_ALL_CAUTION),
  mk('红茶', 'caution', '含咖啡因，每日不超过1杯淡茶', S_ALL_CAUTION),
  mk('绿茶', 'caution', '影响铁吸收，每日不超过1杯淡茶', S_ALL_CAUTION),
  mk('乌龙茶', 'caution', '含咖啡因，孕期少饮', S_ALL_CAUTION),
  mk('普洱茶', 'caution', '含咖啡因，孕期少量饮用', S_ALL_CAUTION),
  mk('花茶', 'caution', '部分花茶有活血作用，需咨询医生', S_ALL_CAUTION),
  mk('菊花茶', 'safe', '清热降火，适量饮用', S_ALL_SAFE),
  mk('玫瑰花茶', 'caution', '活血化瘀，孕期建议避免', S_UNSAFE_PREG),
  mk('决明子茶', 'caution', '有滑肠作用，孕期不宜', S_UNSAFE_PREG),
  mk('藏红花', 'avoid', '强活血作用，孕期严禁', stage('unsafe', 'unsafe', 'unsafe', 'unsafe', 'caution')),
  mk('薏米水', 'avoid', '可能引起宫缩，孕期不建议', S_UNSAFE_PREG),
  mk('可乐', 'caution', '含咖啡因和高糖，孕期少喝', S_ALL_CAUTION),
  mk('雪碧', 'limit', '高糖碳酸饮料，限量饮用', S_LIMIT_ALL),
  mk('汽水', 'limit', '高糖碳酸饮料，孕期少喝', S_LIMIT_ALL),
  mk('能量饮料', 'avoid', '高咖啡因高糖，孕期禁饮', S_UNSAFE_PREG),
  mk('白酒', 'avoid', '酒精致畸，孕期及哺乳期严禁', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'unsafe')),
  mk('啤酒', 'avoid', '含酒精，孕期及哺乳期严禁', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'unsafe')),
  mk('红酒', 'avoid', '含酒精，孕期及哺乳期严禁', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'unsafe')),
  mk('黄酒', 'avoid', '含酒精，孕期严禁', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'unsafe')),
  mk('米酒', 'avoid', '含酒精，孕期建议避免', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'caution')),
  mk('鸡尾酒', 'avoid', '含酒精，孕期及哺乳期严禁', stage('caution', 'unsafe', 'unsafe', 'unsafe', 'unsafe')),
  mk('热巧克力', 'caution', '含咖啡因和糖，适量饮用', S_ALL_CAUTION),
];

const processed = [
  mk('方便面', 'limit', '高钠高脂，孕期偶尔食用', S_LIMIT_ALL),
  mk('火腿肠', 'limit', '加工肉制品，限量食用', S_LIMIT_ALL),
  mk('罐头水果', 'caution', '含糖浆和防腐剂，新鲜水果更佳', S_ALL_CAUTION),
  mk('罐头肉', 'caution', '加工肉制品，孕期慎食', S_ALL_CAUTION),
  mk('咸菜', 'caution', '高盐含亚硝酸盐，少量食用', S_ALL_CAUTION),
  mk('泡菜', 'caution', '高盐发酵食品，限量食用', S_ALL_CAUTION),
  mk('酸菜', 'caution', '高盐含亚硝酸盐，限量', S_ALL_CAUTION),
  mk('腌菜', 'caution', '高盐高亚硝酸盐，孕期少食', S_ALL_CAUTION),
  mk('薯片', 'limit', '高油高盐零食，限量食用', S_LIMIT_ALL),
  mk('糖果', 'limit', '高糖空热量，妊娠糖尿病禁食', S_LIMIT_ALL),
  mk('巧克力', 'limit', '含咖啡因和糖，每天不超过30g', S_LIMIT_ALL),
  mk('冰淇淋', 'caution', '冷食过量易宫缩，慎食生奶冰淇淋', S_ALL_CAUTION),
  mk('果冻', 'caution', '含添加剂，营养价值低', S_ALL_CAUTION),
  mk('蛋糕', 'limit', '高糖高脂，限量食用', S_LIMIT_ALL),
  mk('饼干', 'safe', '选择全麦低糖产品', S_ALL_SAFE),
  mk('果脯蜜饯', 'limit', '高糖含添加剂，限量食用', S_LIMIT_ALL),
  mk('膨化食品', 'limit', '高油高盐，孕期少食', S_LIMIT_ALL),
  mk('油炸食品', 'limit', '高油高热量，孕期限量', S_LIMIT_ALL),
  mk('烧烤食品', 'caution', '可能含致癌物，孕期少食', S_ALL_CAUTION),
  mk('麻辣烫', 'caution', '辛辣刺激高盐，孕期慎食', S_ALL_CAUTION),
];

const newCategories = [
  { name: '蔬菜类',     icon: '🥬', items: vegItems },
  { name: '水果类',     icon: '🍎', items: fruits },
  { name: '肉禽类',     icon: '🥩', items: meats },
  { name: '水产海鲜',   icon: '🐟', items: seafood },
  { name: '蛋奶类',     icon: '🥛', items: eggDairy },
  { name: '豆类制品',   icon: '🫘', items: beans },
  { name: '谷物主食',   icon: '🍚', items: grains },
  { name: '坚果干果',   icon: '🥜', items: nuts },
  { name: '调味品',     icon: '🧂', items: seasonings },
  { name: '饮品类',     icon: '☕', items: drinks },
  { name: '加工食品',   icon: '🥫', items: processed },
];

const output = {
  metadata: raw.metadata || {
    version: '3.1',
    last_updated: new Date().toISOString().slice(0, 10),
    data_source: '基于权威指南综合整理',
    references: [
      '中国营养学会. 中国孕妇膳食指南（2022）. 人民卫生出版社.',
      '国家卫生健康委员会. 食品安全国家标准 孕妇及乳母膳食指南.',
      '美国FDA. Fish Choice Guide for Pregnancy. 2023.',
    ],
    disclaimer: '本数据仅供参考，具体饮食请遵医嘱。',
  },
  categories: newCategories,
};
output.metadata.version = '3.1';
output.metadata.last_updated = new Date().toISOString().slice(0, 10);

fs.writeFileSync(OUT, JSON.stringify(output, null, 2), 'utf-8');

const total = newCategories.reduce((s, c) => s + c.items.length, 0);
console.log(`Generated ${newCategories.length} categories, ${total} total items`);
newCategories.forEach(c => console.log(`  ${c.icon} ${c.name}: ${c.items.length}`));
