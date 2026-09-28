# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""把「产检日期输入框」修复前/后的截图拼成对照图（给人看的交付物）。"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(_TMP, 'checkup-shot')
FONT = r'C:/Windows/Fonts/msyh.ttc'
SCALE = 2
CROP = (0, 330, 504, 500)          # 第一张卡片的「标题 + 预计日期 + 输入框」一带
BAR = 34                            # 每张图上方的标题条高度


def load(name):
    return Image.open(os.path.join(OUT, name)).convert('RGB')


def label(draw, x, y, text, size=17, color=(30, 41, 59)):
    f = ImageFont.truetype(FONT, size)
    draw.text((x, y), text, font=f, fill=color)


def panel(pairs, title, filename):
    """pairs = [(图片, 该图要显示的说明, 是否高亮)]"""
    crops = []
    for im, cap, _ in pairs:
        c = im.crop(CROP)
        c = c.resize((c.width * SCALE, c.height * SCALE), Image.LANCZOS)
        crops.append(c)
    w = max(c.width for c in crops)
    head = BAR * len(crops) + 34
    out = Image.new('RGB', (w, head + sum(c.height for c in crops) + 12), (255, 255, 255))
    d = ImageDraw.Draw(out)
    label(d, 16, 8, title, 19, (15, 23, 42))
    y = 34
    for (im, cap, hot), c in zip(pairs, crops):
        d.rectangle([0, y, w, y + BAR], fill=(254, 226, 226) if hot else (226, 232, 240))
        label(d, 14, y + 7, cap, 17, (185, 28, 28) if hot else (51, 65, 85))
        y += BAR
        out.paste(c, (0, y))
        d.rectangle([0, y - 1, w, y], fill=(203, 213, 225))
        y += c.height
    out.save(os.path.join(OUT, filename))
    print('saved', filename, out.size)


def side_by_side(before, after, filename):
    """整页左右对照"""
    b, a = before.crop((0, 300, before.width, 1500)), after.crop((0, 300, after.width, 1500))
    gap, head = 24, 40
    out = Image.new('RGB', (b.width + gap + a.width, head + b.height), (255, 255, 255))
    d = ImageDraw.Draw(out)
    d.text((16, 10), '修复前（旧写法：输入框写死 100px）', font=ImageFont.truetype(FONT, 19), fill=(185, 28, 28))
    d.text((b.width + gap + 16, 10), '修复后（输入框独占一行）', font=ImageFont.truetype(FONT, 19), fill=(21, 128, 61))
    out.paste(b, (0, head))
    out.paste(a, (b.width + gap, head))
    out.save(os.path.join(OUT, filename))
    print('saved', filename, out.size)


before, after = load('before.png'), load('after.png')
side_by_side(before, after, '产检日期框_手机端_修复前后整页对照.png')
panel([(before, '修复前：显示成 "yyyy/mm"，最后一位被切掉', True),
       (after, '修复后：完整显示，且独占一行、点按区域更大', False)],
      '产检日期输入框 · 手机端（同一张卡片、同一位置） 放大 2 倍',
      '产检日期框_手机端_放大对照.png')
