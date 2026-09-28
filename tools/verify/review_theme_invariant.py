# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""审查⑤：不变量 —— 「本页 5 个语义令牌」必须等于「App.vue 里 Naive 主题的 5 个色」。

为什么值得查：这两处一旦漂移，同一屏里 Naive 组件（n-tag / n-button）和自写样式
就会显示成两种不同的"红/绿/蓝" —— 正是这次要消灭的"杂"。而它们是两个文件里的两份常量，
没有任何机制保证同步。这个脚本就是那个机制。
"""
import io, re, sys, os

V = os.environ.get('CK_VUE') or os.path.join(_REPO, 'frontend/src/views/CheckupScheduleView.vue')
APP = os.environ.get('CK_APP') or os.path.join(_REPO, 'frontend/src/App.vue')

vs = io.open(V, encoding='utf-8').read()
style = vs[vs.index('<style scoped>'):]
blk = re.search(r':global\(:root\)\s*\{(.*?)\n\}', style, re.S).group(1)

TOK = {}
for m in re.finditer(r'(--ck-[a-z0-9-]+)\s*:\s*([^;]+);', blk):
    name, val = m.group(1), m.group(2).strip()
    fb = re.search(r'var\(\s*(--[a-z0-9-]+)\s*,\s*([^)]+)\)', val)
    TOK[name] = (fb.group(1), fb.group(2).strip()) if fb else (None, val)

app = io.open(APP, encoding='utf-8').read()
theme = {}
# 注意：键名既有 primaryColor 也有 textColor1/textColor2 —— 正则必须容得下键尾的数字，
# 只写 (\w+Color) 会漏掉 textColor1/2（恒取到 None，属脚本自身 bug）。
for k, v in re.findall(r"(\w*[Cc]olor\w*)\s*:\s*'(#[0-9a-fA-F]{3,8})'", app):
    theme.setdefault(k, v)

# 全局语义色 → 令牌里的 fill
MAP = [
    ('粉 primary', '--ck-accent', 'primaryColor'),
    ('蓝 info',    '--ck-info',   'infoColor'),
    ('绿 success', '--ck-done',   'successColor'),
    ('琥 warning', '--ck-attn',   'warningColor'),
    ('红 error',   '--ck-danger', 'errorColor'),
]

print('本页令牌 → 全局 token → 兜底色   vs   App.vue 的 Naive 主题色')
print('-' * 96)
bad = 0
for label, tok, key in MAP:
    ref, fb = TOK[tok]
    t = theme.get(key)
    same = (t is not None and fb.lower() == t.lower())
    if not same:
        bad += 1
    print('%-14s %-16s var(%s, %s)   %-16s %s   %s' % (
        label, tok, ref, fb, key + ' =', t, '✅ 一致' if same else '🔴 不一致'))

print()
print('另外：Naive 主题里的文字色也应等于全局 --text-*')
pairs = [('textColor1', '#1f1730'), ('textColor2', '#5c5275')]
for k, v in pairs:
    got = theme.get(k)
    ok = (got or '').lower() == v
    if not ok:
        bad += 1          # ← 必须计入 bad，否则「🔴 却仍报全部一致」= 安慰剂结论
    print('   %-14s = %-10s 期望 %-10s  %s' % (k, got, v, '✅' if ok else '🔴'))

print()
print('=' * 96)
print('结论：%s' % ('全部一致 ✅' if bad == 0 else '有 %d 处不一致 🔴' % bad))
sys.exit(0 if bad == 0 else 1)
