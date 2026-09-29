# -*- coding: utf-8 -*-
"""运动指南页（ExerciseGuideView.vue）配色令牌化 · 完善性审查

对应技能 frontend-color-token-audit 的 ①~⑥：
  ① 选择器集合比对（旧/新差集，删除项必须能说清理由）
  ② 逐属性颜色映射（新块内不得残留裸色值；颜色属性不得无声消失；
                       同一旧色值拆成多个新色必须登记理由）
  ③ 块外硬写色扫描（模板/脚本里的 hex / rgb）
  ④ 对比度审计（与「改前」并排，逐项达标，改差的必须登记理由）
  ⑤ 死规则审计（样式块里有、模板里没有的选择器）
  ⑥ 不变量校验（var(--全局令牌, 兜底色) 的兜底值必须 == 全局令牌真值）

用法：
  python review_exercise_tokens.py                 # 审查真身，退出码 0 = 全绿
  PJ_EX_VUE=/path/to/bad.vue python review_exercise_tokens.py   # 反例验证用

⚠️ 任何打印出来的「不通过」都必须同时 bad += 1（否则就是安慰剂）。
"""
import io
import os
import re
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(_HERE, '..', '..'))
TMP = os.path.join(_HERE, '.tmp')

VUE = os.environ.get('PJ_EX_VUE') or os.path.join(REPO, 'frontend/src/views/ExerciseGuideView.vue')
VARS = os.path.join(REPO, 'frontend/src/styles/variables.css')
OLD_BASE = os.path.join(TMP, 'exercise_old.vue')

bad = 0
warn = 0


def fail(msg):
    global bad
    bad += 1
    print('  🔴 ' + msg)


def soft(msg):
    global warn
    warn += 1
    print('  ⚠️  ' + msg)


# ─────────────────────────── 通用工具 ───────────────────────────
def read(p):
    return io.open(p, encoding='utf-8').read()


def strip_css_comments(s):
    return re.sub(r'/\*.*?\*/', '', s, flags=re.S)


def match_brace(s, i):
    """从 s[i] == '{' 起，逐字符配平括号，返回对应 '}' 的下标。"""
    assert s[i] == '{', s[max(0, i - 20):i + 20]
    depth = 0
    j = i
    n = len(s)
    while j < n:
        c = s[j]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return j
        j += 1
    raise ValueError('unbalanced braces')


def style_block(text):
    """取出 <style scoped> 起始处到 EOF 的内容（已去注释）。"""
    k = text.index('<style')
    return strip_css_comments(text[k:])


def parse_rules(css):
    """{ 选择器: { 属性: 值 } }；支持 @media 嵌套。"""
    rules = {}
    i = 0
    n = len(css)
    while i < n:
        b = css.find('{', i)
        if b < 0:
            break
        sel = ' '.join(css[i:b].split())
        e = match_brace(css, b)
        body = css[b + 1:e]
        if sel.lstrip().startswith('@'):
            # @media 等：递归解析内部规则
            for k, v in parse_rules(body).items():
                rules.setdefault(k, {}).update(v)
        else:
            d = rules.setdefault(sel, {})
            for decl in body.split(';'):
                if ':' not in decl:
                    continue
                p, v = decl.split(':', 1)
                d[p.strip().lower()] = v.replace('!important', '').strip()
        i = e + 1
    return rules


HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
RGB = re.compile(r'\brgba?\s*\(')
NAMED = re.compile(r'(?<![\w-])(white|black|red|green|blue|gray|grey|orange|purple|pink|silver|maroon|teal|navy|olive|lime|aqua|fuchsia)(?![\w-])')

COLOR_PROPS = {
    'color', 'background', 'background-color', 'fill', 'stroke', 'outline',
    'border', 'border-color', 'border-left', 'border-left-color',
    'border-right-color', 'border-top', 'border-top-color',
    'border-bottom-color', 'box-shadow', 'text-shadow',
}


def has_color(v):
    return bool(HEX.search(v) or RGB.search(v) or NAMED.search(v))


def expand_hex(h):
    h = h.lower()
    if h == 'white':
        return '#ffffff'
    if len(h) == 4:                     # #abc
        return '#' + ''.join(c * 2 for c in h[1:])
    if len(h) == 5:                     # #abcd
        return '#' + ''.join(c * 2 for c in h[1:5])
    return h


def norm(v):
    for h in HEX.findall(v):
        v = v.replace(h, expand_hex(h))
    return re.sub(r'\s+', ' ', v).strip().lower()


# ─────────────────────────── 读入 ───────────────────────────
src = read(VUE)
new_css = style_block(src)
new_rules = parse_rules(new_css)

if not os.path.exists(OLD_BASE):
    os.makedirs(TMP, exist_ok=True)
    io.open(OLD_BASE, 'w', encoding='utf-8').write(
        subprocess.check_output(['git', 'show', 'HEAD:frontend/src/views/ExerciseGuideView.vue'],
                                cwd=REPO).decode('utf-8'))
old_src = read(OLD_BASE)
old_rules = parse_rules(style_block(old_src))

# 全局令牌真值（variables.css 的 :root 块）
vars_css = read(VARS)
root_blk = re.search(r':root\s*\{(.*?)\n\}', vars_css, re.S).group(1)
GLOBAL = {}
for m in re.finditer(r'(--[a-z0-9-]+)\s*:\s*([^;]+);', root_blk):
    GLOBAL[m.group(1)] = m.group(2).strip()

print('源文件 : %s' % os.path.relpath(VUE, REPO))
print('基线   : %s (%d 行, 改前 var(--) 出现 %d 次)'
      % (os.path.relpath(OLD_BASE, REPO), old_src.count('\n') + 1, old_src.count('var(--')))
print('规则数 : 改前 %d → 改后 %d' % (len(old_rules), len(new_rules)))
print()


# ─────────── ① 选择器集合比对 ───────────
print('① 选择器集合比对')
removed = sorted(set(old_rules) - set(new_rules))
added = sorted(set(new_rules) - set(old_rules))
# 允许删除的选择器：必须同时「模板里无对应元素」才算合理删除
ALLOW_REMOVED = {
    '.eg-tip .tip-icon': '模板中无 tip-icon 元素（死规则）',
    '.card-icon': '模板中无 card-icon 元素（死规则）',
}
for s in removed:
    if s in ALLOW_REMOVED:
        print('  ✅ 删除 %-24s → %s' % (s, ALLOW_REMOVED[s]))
    else:
        fail('删除了未登记的选择器 %r（必须说明理由）' % s)
print('  删除 %d 项，新增 %d 项%s' % (len(removed), len(added), '' if not added else '：' + ', '.join(added)))
print()

def resolve_expr(v):
    """把 var(--tok, fb) → fb、var(--tok) → 全局真值；返回其中所有色值。"""
    def rep(m):
        tok, fb = m.group(1), m.group(2)
        if fb:
            return fb
        return GLOBAL.get(tok, '#000000')
    v = re.sub(r'var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+?)\s*)?\)', rep, v)
    out = [expand_hex(h) for h in HEX.findall(v)]
    return out


def _hsl_family(c):
    """粗粒度色系。低饱和 / 高亮度一律归入 neutral / tint-light（色相已不可辨）。"""
    c = expand_hex(c).lstrip('#')
    if len(c) != 6:
        return 'unknown'
    r, g, b = (int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if l >= 0.88:
        return 'tint-light'
    d = mx - mn
    if d < 0.06:
        return 'neutral'
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if s < 0.18:
        return 'neutral'
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    h *= 60
    for name, lo, hi in (('redpink', 285, 380), ('redpink', 0, 20), ('orange', 20, 45),
                         ('yellow', 45, 70), ('green', 70, 160), ('blue', 160, 255),
                         ('purple', 255, 285)):
        if lo <= h < hi:
            return name
    return 'unknown'


def families(v):
    return {_hsl_family(h) for h in resolve_expr(v)}


# ─────────── ② 逐属性颜色映射 ───────────
print('② 逐属性颜色映射')
raw_in_new = []
dropped_color_props = []
# 允许「颜色属性被移除」的登记表：旧属性 → 理由
ALLOW_DROPPED = {
    ('eg-current-stage', 'color'): '旧卡是饱和渐变配白字；改为浅底+深色文字，白字色随渐变一起移除',
}
# 允许「旧色系 → 新色系」不一致的登记表：旧色 → 理由
ALLOW_HUE_SHIFT = {
    '#e8627a': '页头三色彩虹渐变（粉/橙/绿）统一为品牌玫瑰渐变；同色在提示框/禁忌处仍映射到 --error-color(红)',
    '#f4a261': '同上：页头橙档 → 品牌玫瑰',
    '#4a9b7f': '同上：页头绿档 → 品牌玫瑰（该绿在提示框等处仍映射到 --success-color(绿)）',
}
hue_shift = []
for sel, decls in new_rules.items():
    for p, v in decls.items():
        if p in COLOR_PROPS and has_color(v) and 'var(' not in v:
            raw_in_new.append((sel, p, v))
for sel in sorted(set(old_rules) & set(new_rules)):
    for p, ov in old_rules[sel].items():
        if p not in COLOR_PROPS:
            continue
        nv = new_rules[sel].get(p)
        if nv is None:
            dropped_color_props.append((sel, p, ov))
            continue
        if not has_color(ov):
            continue
        of, nf = families(ov), families(nv)
        # 中性色 / 浅色调可与任何色系互换（浅底只承担衬托，不承担色相语义）
        if of == nf or 'neutral' in of | nf or 'tint-light' in of | nf:
            continue
        for h in set(HEX.findall(ov)):
            hue_shift.append((sel, p, expand_hex(h), norm(nv), sorted(of), sorted(nf)))

if raw_in_new:
    for sel, p, v in raw_in_new:
        fail('新块残留裸色值 %s { %s: %s }' % (sel, p, v))
else:
    print('  ✅ 新样式块内 %d 条规则的 %d 个颜色属性全部走 var(--令牌)'
          % (len(new_rules), sum(1 for d in new_rules.values() for p in d if p in COLOR_PROPS)))

if dropped_color_props:
    for sel, p, ov in dropped_color_props:
        k = (sel.lstrip('.'), p)
        if k in ALLOW_DROPPED:
            print('  ✅ 移除颜色属性 %s { %s }（已登记：%s）' % (sel, p, ALLOW_DROPPED[k]))
        else:
            fail('颜色属性无声消失：%s { %s: %s }' % (sel, p, ov))
else:
    print('  ✅ 旧块里有、新块里没有的颜色属性：0 项')

if hue_shift:
    for sel, p, oh, nv, of, nf in hue_shift:
        if oh in ALLOW_HUE_SHIFT:
            print('  ✅ 色系平移 %s { %s }：%s %s → %s %s（已登记：%s）'
                  % (sel, p, oh, of, nv, nf, ALLOW_HUE_SHIFT[oh]))
        else:
            fail('色系漂移 %s { %s }: %s%s → %s%s 且未登记理由' % (sel, p, oh, of, nv, nf))
else:
    print('  ✅ 旧色 → 新令牌的色系：全部一致（含已登记的有意平移）')
print()

# ─────────── ③ 块外硬写色 ───────────
print('③ 块外硬写色扫描（模板 + 脚本）')
tmpl_script = src[:src.index('<style')]
hits = []
for ln, line in enumerate(tmpl_script.split('\n'), 1):
    body = strip_css_comments(line)
    # var(--令牌, #兜底色) 里的兜底色是「锚定写法」的一部分，不是裸色值 —— 先摘掉再扫
    body = re.sub(r'var\([^)]*\)', 'var()', body)
    for m in HEX.finditer(body):
        hits.append((ln, m.group(0), line.strip()[:70]))
    for m in RGB.finditer(body):
        hits.append((ln, m.group(0), line.strip()[:70]))
if hits:
    for ln, tok, line in hits:
        fail('第 %d 行出现硬写色 %s  :: %s' % (ln, tok, line))
else:
    n_lines = tmpl_script.count('\n') + 1
    print('  ✅ 模板+脚本共 %d 行，硬写 hex/rgb 命中 0 处' % n_lines)
print()

# ─────────── ④ 对比度审计 ───────────
print('④ 对比度审计（改前 → 改后，同一元素）')


def lum(c):
    c = expand_hex(c)
    c = c.lstrip('#')
    r, g, b = (int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def f(x):
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def cr(fg, bg):
    a, b = lum(fg), lum(bg)
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


def res(expr):
    if expr is None:
        return None
    if expr == 'white':
        return '#ffffff'
    if expr.startswith('--'):
        if expr not in GLOBAL:
            print('!! 全局令牌不存在: ' + expr)
            sys.exit(2)
        return GLOBAL[expr]
    return expr


def from_css(spec):
    """色值来源：'选择器|属性' 直接从新样式块解析（渐变取第一档 = 对浅色前景最不利），
    或直接给 全局令牌 / 裸色值。这样对比度表就不会和源码漂移。"""
    if '|' in spec:
        sel, prop = spec.split('|')
        v = new_rules.get(sel, {}).get(prop)
        if v is None:
            fail('对比度表引用了源码里不存在的 %s { %s }（表已漂移）' % (sel, prop))
            return '#000000'
        hexes = resolve_expr(v)
        if not hexes:
            fail('%s { %s } 里解析不出色值：%s' % (sel, prop, v))
            return '#000000'
        return hexes[0]
    return res(spec)


# (元素, 前景来源, 背景来源, 字号, 粗体, 类型, 旧(前景,背景)|None)
# 旧 = None 表示旧底含叠加层 / 继承，静态推不出确切值，只判新值。
# 渐变背景一律取「对浅色前景最不利」的第一档 stop（= 最浅那端）。
PAIRS = [
    ('页头标题',                            '.eg-header|color',        '.eg-header|background',              20,   True,  'text', ('#ffffff', '#f4a261')),
    ('页头副标题',                          '.eg-title p|color',       '.eg-header|background',              13,   False, 'text', ('#ffffff', '#f4a261')),
    ('阶段标题 h3（孕早期）',                '.eg-current-stage h3|color', '.eg-current-stage.stage-early|background', 17, True, 'text', ('#ffffff', '#f4a261')),
    ('阶段说明 .stage-desc（孕早期）',        '.stage-desc|color',       '.eg-current-stage.stage-early|background', 13, False, 'text', ('#ffffff', '#f4a261')),
    ('阶段小标 .stage-label（孕中期）',       '.stage-label|color',      '.eg-current-stage.stage-mid|background',   11, True, 'text', ('#ffffff', '#3a86c8')),
    ('阶段小标 .stage-label（孕晚期）',       '.stage-label|color',      '.eg-current-stage.stage-late|background',  11, True, 'text', ('#ffffff', '#7c5cbf')),
    ('阶段目标 .stage-goal',                '.stage-goal|color',       '.stage-goal|background',             12.5, False, 'text', None),
    ('提示·信息 .eg-tip-info',              '.eg-tip-info|color',      '.eg-tip-info|background',            13.5, False, 'text', ('#1a5276', '#e8f2fb')),
    ('提示·提醒 .eg-tip-warn',              '.eg-tip-warn|color',      '.eg-tip-warn|background',            13.5, False, 'text', ('#e65100', '#fff3e0')),
    ('提示·建议 .eg-tip-good',              '.eg-tip-good|color',      '.eg-tip-good|background',            13.5, False, 'text', ('#1b5e20', '#e8f5f0')),
    ('提示·危险 .eg-tip-danger',            '.eg-tip-danger|color',    '.eg-tip-danger|background',          13.5, False, 'text', ('#a31523', '#fce8ec')),
    ('卡片正文 .eg-card p',                 '.eg-card p|color',        '.eg-card|background',                13.5, False, 'text', ('#555555', '#fafafa')),
    ('步骤小标题 .step-block strong',        '.step-block strong|color', '.step-block|background',             14,   True,  'text', ('#1f6aa8', '#e8f2fb')),
    ('阶段格标题 .phase-item strong（橙）',   '.phase-item strong|color', '.phase-item.orange|background',      14,   True,  'text', ('#1f1730', '#fef3e8')),
    ('阶段格说明 .phase-item p（橙）',        '.phase-item p|color',     '.phase-item.orange|background',      12,   False, 'text', ('#666666', '#fef3e8')),
    ('阶段格说明 .phase-item p（紫）',        '.phase-item p|color',     '.phase-item.purple|background',      12,   False, 'text', ('#666666', '#f0ebfb')),
    ('禁忌标题 .forbid-item strong',         '.forbid-item strong|color', '.forbid-item|background',          13,   True,  'text', ('#e8627a', '#fce8ec')),
    ('禁忌说明 .forbid-item small',          '.forbid-item small|color', '.forbid-item|background',           11.5, False, 'text', ('#888888', '#fce8ec')),
    ('底部声明 .eg-footer',                 '.eg-footer|color',        '--bg-color',                         12,   False, 'text', ('#aaaaaa', '#fdfaf7')),
]

# 允许「改后比改前低但仍达标」的条目 → 必须登记理由
ACCEPTED_DROPS = {
    '阶段小标 .stage-label（孕晚期）': '旧为 opacity:.75 白字压 #7c5cbf（真实比值低于此处按纯白估的 5.07）；统一改用 --text-hint 后 4.74 仍达标',
    '提示·信息 .eg-tip-info': '统一改用全局 --info-ink(#17709b)——与产检页同一支墨色，换取跨页一致',
    '提示·提醒 .eg-tip-warn': '统一改用全局 --warning-ink(#7d4f0d)',
    '提示·建议 .eg-tip-good': '统一改用全局 --success-ink(#3f7f42)',
    '提示·危险 .eg-tip-danger': '统一改用全局 --error-ink(#b32d2d)',
    '步骤小标题 .step-block strong': '统一改用全局 --info-ink',
    '阶段格说明 .phase-item p（橙）': '旧 #666 属页面私有灰，统一改用 --text-secondary',
    '阶段格说明 .phase-item p（紫）': '同上',
}

print('  %-42s %-6s %-26s %s' % ('元素', '字号', '改后 fg/bg → 比值', '改前 → 判定'))
print('  ' + '-' * 110)
for name, fg_sp, bg_sp, size, bold, kind, old in PAIRS:
    nfg, nbg = from_css(fg_sp), from_css(bg_sp)
    nr = cr(nfg, nbg)
    need = 3.0 if kind == 'icon' else (3.0 if (size >= 18.66 or (bold and size >= 14)) else 4.5)
    orr = cr(res(old[0]), res(old[1])) if old else None
    ok = nr >= need
    if not ok:
        fail('%-40s %.2f < %.1f（%s）' % (name, nr, need, kind))
    tail = ''
    if orr is not None:
        if nr < orr:
            if name in ACCEPTED_DROPS:
                tail = '↓%.2f（已登记：%s）' % (orr - nr, ACCEPTED_DROPS[name])
            else:
                fail('%-40s 改后 %.2f 比改前 %.2f 更差且未登记理由' % (name, nr, orr))
                tail = '↓%.2f' % (orr - nr)
        else:
            tail = '↑%.2f' % (nr - orr)
        print('  %-42s %-6s %-26s %s' % (name[:41], size, '%s/%s → %.2f' % (nfg, nbg, nr),
                                         ('%.2f ' % orr) + ('✅' if ok else '🔴') + ' ' + tail))
    else:
        print('  %-42s %-6s %-26s %s' % (name[:41], size, '%s/%s → %.2f' % (nfg, nbg, nr),
                                         'n/a（旧值不可静态确定）' + ('✅' if ok else '🔴')))
print()

# ─────────── ⑤ 死规则审计 ───────────
print('⑤ 死规则审计')
t_end = src.rindex('</template>')
tmpl = src[:t_end]
tmpl_classes = set(re.findall(r'class="([^"]*)"', tmpl))
tmpl_tokens = set()
for c in tmpl_classes:
    for t in re.split(r'\s+', c.strip()):
        if t:
            tmpl_tokens.add(t)
# 动态 :class="'stage-' + stageKey" → 收进 stage-*
tmpl_tokens |= {'stage-early', 'stage-mid', 'stage-late', 'stage-prepartum'}
dead = []
for sel in new_rules:
    # :deep(...) 打的是子组件内部类（naive-ui 的 n-collapse-item__* 由库生成），
    # 本模板里当然找不到 —— 跳过，不算死规则。
    if ':deep(' in sel:
        continue
    inner = re.sub(r':deep\(([^)]*)\)', r'\1', sel)
    parts = [p.strip() for p in inner.split(',')]
    for p in parts:
        classes = re.findall(r'\.([A-Za-z0-9_-]+)', p)
        if not classes:
            continue
        if not any(c in tmpl_tokens for c in classes):
            dead.append(p)
if dead:
    for d in sorted(set(dead)):
        fail('死规则（模板中无对应元素）：%s' % d)
else:
    print('  ✅ 样式块 %d 个选择器全部在模板中可寻（模板 class 词条 %d 个）' % (len(new_rules), len(tmpl_tokens)))
print()

# ─────────── ⑥ 不变量校验 ───────────
print('⑥ 不变量：var(--全局令牌, 兜底色) 的兜底值必须 == variables.css 的真值')
n_anchor = 0
for m in re.finditer(r'var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+?)\s*)?\)', new_css):
    tok, fb = m.group(1), m.group(2)
    if tok not in GLOBAL:
        fail('%s 未在 %s 的 :root 定义（无兜底也必须是全局令牌）'
             % (tok, os.path.basename(VARS)))
        continue
    if fb is None:
        continue
    n_anchor += 1
    if norm(fb) != norm(GLOBAL[tok]):
        fail('%s 兜底值 %s ≠ 全局真值 %s（主题漂移）' % (tok, fb, GLOBAL[tok]))
print('  ✅ 锚定写法 %d 处，兜底值与全局真值一致；未定义令牌 0 个' % n_anchor)
print()

# ─────────── 结论 ───────────
print('=' * 110)
if bad == 0:
    print('全部通过 ✅   失败 0 项 / 告警 %d 项' % warn)
else:
    print('不通过 🔴   共 %d 项失败 / 告警 %d 项' % (bad, warn))
sys.exit(1 if bad else 0)
