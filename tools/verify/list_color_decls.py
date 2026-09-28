# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""列出 style 块里"含颜色的声明"去重清单，用于制定替换表（人工核对用）。"""
import re

P = os.path.join(_REPO, 'frontend/src/views/CheckupScheduleView.vue')
src = open(P, encoding='utf-8').read()
style = src[src.index('<style scoped>'):]

COLOR_RE = re.compile(r'(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\))')
decls = set()
for body in re.findall(r'\{([^{}]*)\}', style):
    for d in body.split(';'):
        d = d.strip()
        if COLOR_RE.search(d):
            decls.add(re.sub(r'\s+', ' ', d))

for d in sorted(decls):
    print(d)
print('\n共 %d 条不同的声明' % len(decls))
