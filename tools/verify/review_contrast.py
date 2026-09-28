# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""审查③（第 2 版）：对比度审计。

比第 1 版好在：**色值不手抄，直接从 CheckupScheduleView.vue 的 :global(:root) 令牌块解析**
（`var(--info-color, #4fb6e8)` → 取兜底 #4fb6e8）。
否则改了令牌忘了改脚本，脚本就在验一份早就不存在的配色 —— 典型的假绿。

背景那一侧是人判断的（静态分析推不出元素的实际背景链），所以仍以「令牌对」的形式列出来。
"""
import io, re, sys

V = os.path.join(_REPO, 'frontend/src/views/CheckupScheduleView.vue')
s = io.open(V, encoding='utf-8').read()
style = s[s.index('<style scoped>'):]
blk = re.search(r':global\(:root\)\s*\{(.*?)\n\}', style, re.S).group(1)

TOK = {}
for m in re.finditer(r'(--ck-[a-z0-9-]+)\s*:\s*([^;]+);', blk):
    name, val = m.group(1), m.group(2).strip()
    fb = re.search(r'var\([^,]+,\s*([^)]+)\)', val)
    TOK[name] = (fb.group(1).strip() if fb else val)


def lum(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def cr(fg, bg):
    a, b = lum(fg), lum(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def V_(x):
    """接受令牌名或直接色值"""
    if x.startswith('--'):
        if x not in TOK:
            print('!! 令牌不存在:', x)
            sys.exit(2)
        return TOK[x]
    if x in ('#fff', 'white'):
        return '#ffffff'
    return x


# (元素, 字号, 是否粗体, 前景, 背景, 改前对比度[手抄自审查第 1 版], 类型)
# 类型 'text' = 正文/标签文字（AA 需 4.5；≥18.66px 或 ≥14px 粗体算大字需 3）
# 类型 'icon' = 图形符号（WCAG 1.4.11 非文本内容，阈值 3:1）——
#              圆点里的 `!`/`·`、关闭用的 `×`/`✕` 都属这类：真正传达信息的是旁边的文字
PAIRS = [
    ('孕周徽章 .week-badge',            12, True,  '--ck-info-ink', '--ck-info-bg', 1.78, 'text'),
    ('完成卡徽章 .is-completed .week-badge', 12, True, '--ck-done-ink', '--ck-surface', 2.10, 'text'),
    ('预计日期 .expected-date-tag',      11, False, '--ck-info-ink', '--ck-info-bg', 5.17, 'text'),
    ('预计日期(临近) .is-urgent',        11, True,  '--ck-attn-ink', '--ck-attn-bg', 4.51, 'text'),
    ('子项数 .sub-items-count',          11, False, '--ck-ink-3', '--ck-line', 3.86, 'text'),
    ('分类标签 .sub-item-cat-tag',       10, True,  '--ck-ink-3', '--ck-surface-2', 4.34, 'text'),
    ('子项必检 .sub-item-required-tag',  10, True,  '--ck-danger-ink', '--ck-danger-bg', 4.41, 'text'),
    ('子项推荐 .sub-item-recommended-tag', 10, True, '--ck-attn-ink', '--ck-attn-bg', 2.84, 'text'),
    ('准备标题 .prep-title',             13, True,  '--ck-attn-ink', '--ck-attn-bg', 6.84, 'text'),
    ('准备条目数 .prep-count',           11, False, '--ck-attn-ink', '--ck-attn-line', 4.03, 'text'),
    ('准备条目 .prep-item',              12.5, False, '--ck-ink-2', '--ck-attn-bg', 8.75, 'text'),
    ('准备警告 .prep-item.is-warning',    12.5, True, '--ck-danger-ink', '--ck-attn-bg', 4.66, 'text'),
    ('已完成文字 .completed-text',       13, True,  '--ck-done-ink', '--ck-done-bg', 2.10, 'text'),
    ('本次推荐 .current-recommend',      14, True,  '--ck-attn-ink', '--ck-attn-bg', 1.99, 'text'),
    ('统计小标 .stat-label',             13, False, '--ck-ink-3', '--bg-tint-cream', 4.41, 'text'),
    ('进度百分比 .progress-text',        14, True,  '--ck-ink', '--bg-tint-cream', 15.92, 'text'),
    ('子项名 .sub-item-name',            13, False, '--ck-ink', '--ck-surface', 10.35, 'text'),
    ('子项折叠箭头 .sub-item-fold',       10, False, '--ck-ink-3', '--ck-surface', 2.56, 'icon'),
    ('空态提示 .no-items-hint',          12, False, '--ck-ink-3', '--ck-surface-2', 2.45, 'text'),
    ('删除圆点 ✕ .report-del-sm',         9,  True,  '#fff', '--ck-danger', 3.27, 'icon'),
    ('激活分类(白字) .cat-tab.active',   12, False, '#fff', '--ck-accent', 4.63, 'text'),
    ('准备圆点 · .prep-bullet',          11, True,  '--ck-ink', '--ck-attn', 1.67, 'icon'),
    ('准备圆点 ! .is-warning .prep-bullet', 11, True, '#fff', '--ck-danger', 1.67, 'icon'),
    ('自定义删除 × .custom-item-del',    11, False, '--ck-danger', '--ck-danger-bg', 3.08, 'icon'),
]

GLOBAL = {'--bg-tint-cream': '#fff9ec'}   # 全局令牌（不在 --ck-* 块里）单独给

print('%-38s %-6s %-20s %-8s %s' % ('元素', '字号', '改后 fg/bg → 对比', '改前', '判定'))
print('-' * 112)
bad = []
for name, size, bold, fgt, bgt, before, kind in PAIRS:
    fg = V_(fgt) if not fgt.startswith('--bg-tint') else GLOBAL[fgt]
    bg = V_(bgt) if not bgt.startswith('--bg-tint') else GLOBAL[bgt]
    x = cr(fg, bg)
    if kind == 'icon':
        need = 3.0                      # WCAG 1.4.11 非文本内容
    else:
        need = 3.0 if (size >= 18.66 or (bold and size >= 14)) else 4.5
    ok = x >= need
    if not ok:
        bad.append((name, x, need))
    print('%-38s %-6s %-20s %-8s %s' % (
        name[:37], size,
        '%s/%s → %.2f' % (fg, bg, x),
        '%.2f' % before,
        ('✅' if ok else '🔴 低于 %.1f' % need) + ('  (↑%.2f)' % (x - before) if x > before else '  (↓%.2f)' % (before - x))))

print()
print('=' * 108)
print('不达标的 %d 项：' % len(bad))
for n, x, need in bad:
    print('   🔴 %-36s %.2f  (需 %.1f)' % (n, x, need))
if not bad:
    print('   无 —— 全部达标 ✅')
