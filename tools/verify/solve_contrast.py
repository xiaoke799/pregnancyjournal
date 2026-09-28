# -*- coding: utf-8 -*-
"""为审查发现的临界对比度，反解出达标的色值"""


def lum(h):
    h = h.lstrip('#')
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def cr(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


print('【F1】--ck-info-ink 要在 --ck-info-bg #f4f8ff 上 ≥4.5（11px 小字）')
for c in ['#1a7ba8', '#18739e', '#17709b', '#166c96', '#156a94', '#136088', '#0f5c82']:
    print('   %s  on #f4f8ff = %.2f   on #ffffff = %.2f' % (c, cr(c, '#f4f8ff'), cr(c, '#ffffff')))

print()
print('【F2】--ck-attn-ink #8a5a12 要在 --ck-attn-line 上 ≥4.5')
for c in ['#f0dfb8', '#f4e6c8', '#f6ebd6', '#f8efdf', '#faf3e7']:
    print('   #8a5a12 on %s = %.2f      （该线相对卡片白底的可见度对照下面）' % (c, cr('#8a5a12', c)))
print('   线 vs 卡片白 #ffffff:')
for c in ['#f0dfb8', '#f4e6c8', '#f6ebd6', '#f8efdf']:
    print('      %s = %.2f' % (c, cr(c, '#ffffff')))
print('   线 vs 准备区底 #fff9ec:')
for c in ['#f0dfb8', '#f4e6c8', '#f6ebd6', '#f8efdf']:
    print('      %s = %.2f' % (c, cr(c, '#fff9ec')))

print()
print('【F4】准备圆点里的字形')
for fg, bg in [('#ffffff', '#f0a020'), ('#8a5a12', '#f0a020'), ('#1f1730', '#f0a020'),
               ('#5c5275', '#f0a020'), ('#ffffff', '#e64646'), ('#1f1730', '#e64646')]:
    print('   %s on %s = %.2f' % (fg, bg, cr(fg, bg)))
