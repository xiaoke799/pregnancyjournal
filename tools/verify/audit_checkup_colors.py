# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""按选择器汇总 CheckupScheduleView.vue 里的颜色用法，用来规划收敛方案。"""
import re
import collections

P = os.path.join(_REPO, 'frontend/src/views/CheckupScheduleView.vue')
src = open(P, encoding='utf-8').read()
style = src[src.index('<style scoped>'):]

# 逐条规则：selector { body }
rules = re.findall(r'([^{}]+)\{([^{}]*)\}', style)
COLOR_RE = re.compile(r'(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))')

hue_count = collections.Counter()
out = []
for sel, body in rules:
    sel = ' '.join(sel.split())
    if '@media' in sel or '@keyframes' in sel or not sel:
        continue
    decls = [d.strip() for d in body.split(';') if COLOR_RE.search(d)]
    if not decls:
        continue
    out.append((sel, decls))
    for d in decls:
        for c in COLOR_RE.findall(d):
            hue_count[c.upper()] += 1

print('=== 带颜色的规则（%d 条）===' % len(out))
for sel, decls in out:
    print('\n' + sel)
    for d in decls:
        print('    ' + d)

print('\n\n=== 颜色使用频次（去重后 %d 种）===' % len(hue_count))
for c, n in hue_count.most_common():
    print('%4d  %s' % (n, c))
