# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""出「预计日期只留一处 + 新增取消完成」的交付对照图。"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(_TMP, 'checkup-shot')
FONT = r'C:/Windows/Fonts/msyh.ttc'
BAR = 32


def label(d, x, y, text, size=16, color=(30, 41, 59)):
    d.text((x, y), text, font=ImageFont.truetype(FONT, size), fill=color)


after = Image.open(os.path.join(OUT, 'after.png')).convert('RGB')
before = Image.open(os.path.join(OUT, 'before.png')).convert('RGB')

# 三块：(来源图, 裁剪框, 缩放, 说明文字, 是否高亮)
panels = [
    (before, (0, 380, 504, 470), 2, '改前：预计日期出现两处（左上「预计 06-19」+ 右上「06/19」，内容完全重复）', True),
    (after, (0, 380, 504, 460), 2, '改后：只剩「预计 06/19 · 已过98天」一处，就在完成日期输入框上方', False),
    (after, (0, 1770, 504, 1860), 2, '改后：已完成卡片出现「取消完成」入口（误按「标记完成」可撤销）', False),
]

crops = []
for im, box, sc, cap, hot in panels:
    c = im.crop(box)
    crops.append((c.resize((c.width * sc, c.height * sc), Image.LANCZOS), cap, hot))

w = max(c.width for c, _, _ in crops)
head = 36
total_h = head + sum(BAR + c.height + 6 for c, _, _ in crops)
out = Image.new('RGB', (w, total_h), (255, 255, 255))
d = ImageDraw.Draw(out)
label(d, 14, 8, '产检卡片：预计日期去重 + 新增「取消完成」', 19, (15, 23, 42))

y = head
for c, cap, hot in crops:
    d.rectangle([0, y, w, y + BAR], fill=(254, 226, 226) if hot else (226, 232, 240))
    label(d, 12, y + 7, cap, 15, (185, 28, 28) if hot else (51, 65, 85))
    y += BAR
    out.paste(c, (0, y))
    d.rectangle([0, y - 1, w, y], fill=(203, 213, 225))
    y += c.height + 6

name = '产检卡_预计日期去重与取消完成.png'
out.save(os.path.join(OUT, name))
print('saved', name, out.size)
