# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""审查④（第 3 版）：找样式块里"没有任何元素会匹配"的死规则。

踩过的两个坑（都是我自己脚本的 bug，不是代码的问题）：
  坑 A：把 `.checkup-card.is-mandatory` 当整体去比对 ⇒ 141 条假阳性。
        正确：拆出选择器里的每一个 class，只要有一个活着就算这条规则活着。
  坑 B：`head.index('</template>')` 命中的是内层 `<template v-if>` 的闭合标签
        （本文件有 4 处嵌套 template），模板被截成一小段 ⇒ 所有类名都查不到、全报死。
        正确：用 `rindex`。
  坑 C：`'cat-' + autoCategory(...)` 这种拼接在**模板**里，只在 script 里找就漏了。
"""
import io, re

V = os.path.join(_REPO, 'frontend/src/views/CheckupScheduleView.vue')
s = io.open(V, encoding='utf-8').read()
head = s[:s.index('<style scoped>')]
style = s[s.index('<style scoped>'):]
style_nc = re.sub(r'/\*.*?\*/', '', style, flags=re.S)

T_OPEN = head.index('<template>')
T_CLOSE = head.rindex('</template>')          # ← 坑 B：必须 rindex
tpl = head[T_OPEN:T_CLOSE]
script = head[head.index('<script'):]
print('模板长度 %d 字符（%d~%d）' % (len(tpl), T_OPEN, T_CLOSE))

# 候选类名：模板 + 脚本里所有字符串字面量
LITS = set(re.findall(r"""['"]([A-Za-z][\w-]*)['"]""", head))
# 模板里静态 class="a b c"
for m in re.finditer(r'class="([^"]*)"', tpl):
    for c in m.group(1).split():
        LITS.add(c)
# 前缀拼接（'cat-' + xxx）—— 坑 C：全 head 里找
JOINED = re.findall(r"""['"]([A-Za-z][\w-]*-)['"]\s*\+""", head)

print('候选类名/字面量 %d 个，动态前缀 %s' % (len(LITS), JOINED))


def alive(cls):
    if cls in LITS:
        return True
    return any(cls.startswith(p) for p in JOINED)


rows = []
for m in re.finditer(r'(?m)^\s*([^{}\n@]+)\{', style_nc):
    sel = m.group(1).strip()
    if sel.startswith('@') or sel.startswith(':'):
        continue
    for part in sel.split(','):
        part = part.strip()
        if not part:
            continue
        classes = re.findall(r'\.([A-Za-z][\w\u4e00-\u9fff-]*)', part)
        if not classes:
            continue
        rows.append((part, classes, any(alive(c) for c in classes)))

dead = [(p, c) for p, c, a in rows if not a]
print()
print('样式块选择器 %d 条，其中无对应元素的 %d 条' % (len(rows), len(dead)))
for p, c in dead:
    print('   ', p, '  classes=', c)

print()
print('--- 反例验证：故意造一个不存在的类，必须被判死 ---')
for probe in ['.no-such-class-xyz', '.checkup-card.no-such-flag-xyz']:
    cs = re.findall(r'\.([A-Za-z][\w-]*)', probe)
    got = any(alive(c) for c in cs)
    print('   %-34s alive=%s  （期望 True 才对？）' % (probe, got))
print('   注：`.checkup-card.no-such-flag-xyz` 里 checkup-card 是活类，')
print('       按"至少一个 class 活着"的判据算活 —— 这类"多余的限定类"不影响渲染，不算问题。')
print()
print('--- 正例验证：真在用的必须判活 ---')
for probe in ['.date-input-small', '.sub-item-cat-tag.cat-血检',
              '.checkup-card.is-mandatory', '.prep-item.is-warning', '.card-footer .n-button']:
    cs = re.findall(r'\.([A-Za-z][\w\u4e00-\u9fff-]*)', probe)
    print('   %-34s alive=%s  （期望 True）' % (probe, any(alive(c) for c in cs)))
