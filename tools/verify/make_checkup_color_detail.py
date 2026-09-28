# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""产检排期页「配色优化」细节对照图：摘要 / 分类标签 / 已完成卡片 三段，改前 | 改后 并排。"""
import os
from PIL import Image, ImageDraw, ImageFont

D = os.path.join(_TMP, 'checkup-shot')
FONT = r'C:/Windows/Fonts/msyh.ttc'
SC = 1.4
BAR = 34
GAP = 12


def f(s):
    return ImageFont.truetype(FONT, s)


before = Image.open(os.path.join(D, 'color_before.png')).convert('RGB')
after = Image.open(os.path.join(D, 'color_after.png')).convert('RGB')


def find_band(im, target, tol=5, x0=30, x1=470):
    """找一片「卡片底色」连续区间。"""
    px = im.load()
    rows = []
    for y in range(300, im.height):
        n = 0
        for x in range(x0, x1, 5):
            c = px[x, y]
            if abs(c[0]-target[0]) <= tol and abs(c[1]-target[1]) <= tol and abs(c[2]-target[2]) <= tol:
                n += 1
        if n > 60:
            rows.append(y)
    bands = []
    for y in rows:
        if bands and y - bands[-1][1] <= 4:
            bands[-1][1] = y
        else:
            bands.append([y, y])
    return [b for b in bands if b[1] - b[0] > 60]


def bar_band(path, color, tol=8):
    """按【卡片左侧竖条】的颜色找已完成卡片 —— 竖条整卡高度同色，比找底色稳。
       手机上 .checkup-schedule-view padding=8px、卡片 4px 竖条 ⇒ 竖条在 x≈9。"""
    im = Image.open(path).convert('RGB')
    px = im.load()
    ys = [y for y in range(300, im.height)
          if all(abs(px[9, y][i] - color[i]) <= tol for i in range(3))]
    return (ys[0], ys[-1]) if ys else None


gb = find_band(before, (0xE8, 0xF5, 0xE9)) or [bar_band(os.path.join(D, 'color_before.png'), (0x66, 0xBB, 0x6A))]
ga = find_band(after, (0xF1, 0xFA, 0xF4)) or [bar_band(os.path.join(D, 'color_after.png'), (0x4E, 0xA7, 0x50))]
print('改前 已完成卡区间:', gb, ' 改后:', ga)
yb = gb[0] if gb else (2381, 3099)
ya = ga[0] if ga else (2426, 3146)
# 取「卡片区间 ± 上下留白」的较大窗口，保证两张图截的是同一块板面
top3 = min(yb[0], ya[0]) - 30
bot3 = max(yb[1], ya[1]) + 30

rows = [
    ('① 顶部摘要 + 本次推荐', (0, 0, 504, 292), (0, 0, 504, 292),
     '改前：摘要=饱和橙底；进度条=绿→蓝双色渐变；推荐条=写死"孕早期"橙边',
     '改后：摘要=极浅阶段底；进度条=品牌粉同族渐变；推荐条=琥珀（提醒色，不再写死孕早期）'),
    ('② 检查内容 · 分类标签（改前最"花"的一块）', (0, 672, 504, 1264), (0, 672, 504, 1264),
     '改前：6 个分类各一种 Material 彩虹色（B超蓝/血检粉/尿检橙/血糖绿…），一屏十几块彩色',
     '改后：分类标签统一中性灰；只保留"必检=红 / 推荐=琥珀"两种有含义的强调色'),
    ('③ 已完成卡片', (0, top3, 504, bot3), (0, top3, 504, bot3),
     '改前：卡片底色 #E8F5E9、竖条 #66BB6A（Material 绿，与全局 success 色不是同一个绿）',
     '改后：底色/竖条/文字全部改用全局 success 令牌 #4ea750，与"必检=品牌粉、自定义=蓝"成一套'),
]

panels = []
for title, bb, ba, cb, ca in rows:
    pb = before.crop(bb)
    pa = after.crop(ba)
    h = min(pb.height, pa.height)
    pb, pa = pb.crop((0, 0, 504, h)), pa.crop((0, 0, 504, h))
    pb = pb.resize((int(504 * SC), int(h * SC)), Image.LANCZOS)
    pa = pa.resize((int(504 * SC), int(h * SC)), Image.LANCZOS)
    panels.append((title, pb, pa, cb, ca))

colw = panels[0][1].width
total_h = 40 + sum(BAR + BAR + p[1].height + 16 for p in panels)
out = Image.new('RGB', (colw * 2 + GAP, total_h), (255, 255, 255))
d = ImageDraw.Draw(out)
d.text((14, 10), '产检排期页 · 配色优化前后对照', font=f(20), fill=(15, 23, 42))

y = 40
for title, pb, pa, cb, ca in panels:
    d.rectangle([0, y, colw * 2 + GAP, y + BAR], fill=(241, 245, 249))
    d.text((14, y + 8), title, font=f(16), fill=(15, 23, 42))
    y += BAR
    # 两列各自的说明条
    d.rectangle([0, y, colw, y + BAR], fill=(254, 226, 226))
    d.text((12, y + 7), cb, font=f(13), fill=(185, 28, 28))
    d.rectangle([colw + GAP, y, colw * 2 + GAP, y + BAR], fill=(220, 252, 231))
    d.text((colw + GAP + 12, y + 7), ca, font=f(13), fill=(22, 101, 52))
    y += BAR
    out.paste(pb, (0, y))
    out.paste(pa, (colw + GAP, y))
    d.rectangle([colw, 0, colw + GAP, total_h], fill=(255, 255, 255))
    y += pb.height + 16

name = '产检页配色_细节对照.png'
out.save(os.path.join(D, name))
print('saved', name, out.size)
