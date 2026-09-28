# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""产检排期页「配色优化」改前 / 改后对照图。
两张：① 整页左右对照（1x，看整体色感）② 顶部放大对照（2x，看细节）
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(_TMP, 'checkup-shot')
FONT = r'C:/Windows/Fonts/msyh.ttc'
BAR = 34
GAP = 10


def font(size):
    return ImageFont.truetype(FONT, size)


before = Image.open(os.path.join(OUT, '配色前_手机.png')).convert('RGB')
after = Image.open(os.path.join(OUT, 'after.png')).convert('RGB')
print('before', before.size, ' after', after.size)

H = min(before.height, after.height)
before = before.crop((0, 0, before.width, H))
after = after.crop((0, 0, after.width, H))


def col_label(d, x, y, w, text, bg, fg):
    d.rectangle([x, y, x + w, y + BAR], fill=bg)
    d.text((x + 12, y + 8), text, font=font(15), fill=fg)


# ---------- ① 整页左右对照 ----------
w1 = before.width + after.width + GAP
out1 = Image.new('RGB', (w1, BAR + H), (255, 255, 255))
d1 = ImageDraw.Draw(out1)
col_label(d1, 0, 0, before.width, '改前（60 种颜色 / 4 套色板打架）', (254, 226, 226), (185, 28, 28))
col_label(d1, before.width + GAP, 0, after.width, '改后（5 个角色，全部走 App 主色令牌）', (220, 252, 231), (22, 101, 52))
out1.paste(before, (0, BAR))
out1.paste(after, (before.width + GAP, BAR))
d1.rectangle([before.width, 0, before.width + GAP, BAR + H], fill=(255, 255, 255))
name1 = '产检页配色_改前改后整页对照.png'
out1.save(os.path.join(OUT, name1))
print('saved', name1, out1.size)


# ---------- ② 顶部放大对照（2x，纵向叠放） ----------
SC = 2
TOP = 470          # 摘要 + 第一张卡
crops = [
    (before, (0, 0, before.width, TOP), '改前：摘要是饱和橙底、进度条绿→蓝渐变、分类标签彩虹色、卡片竖条 4 种色', True),
    (after, (0, 0, after.width, TOP), '改后：摘要浅底 + 品牌粉进度条；必检=粉、自定义=蓝、完成=绿、提醒=琥珀；分类标签统一中性', False),
]
panels = []
for im, box, cap, hot in crops:
    c = im.crop(box)
    panels.append((c.resize((c.width * SC, c.height * SC), Image.LANCZOS), cap, hot))

w2 = max(p[0].width for p in panels)
total_h = sum(BAR + p[0].height + 8 for p in panels)
out2 = Image.new('RGB', (w2, total_h), (255, 255, 255))
d2 = ImageDraw.Draw(out2)
y = 0
for c, cap, hot in panels:
    d2.rectangle([0, y, w2, y + BAR], fill=(254, 226, 226) if hot else (220, 252, 231))
    d2.text((12, y + 8), cap, font=font(16), fill=(185, 28, 28) if hot else (22, 101, 52))
    y += BAR
    out2.paste(c, (0, y))
    y += c.height + 8
name2 = '产检页配色_放大对照.png'
out2.save(os.path.join(OUT, name2))
print('saved', name2, out2.size)
