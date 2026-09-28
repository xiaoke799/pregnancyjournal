# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""客观判断「某张统计卡的图里到底有没有画出线」—— 不靠肉眼看缩略图。

背景：本项目出现过「血糖卡下面写着『数据列表 (6条)』，但图是空白的」——
原因是默认缩放窗口只显示末尾约 20 个点，稀疏指标的 6 个点全在窗口外。
这种"图空白"在截图上很显眼，但在长图缩略图里容易看漏，所以用像素统计给个数。

做法：把卡片裁剪图里「绘图区」（汇总条之下、图例/数据列表之上）的像素，
按「离白色/浅灰有多远」判定为"墨迹"，算 ink 比例。空白图 ≈ 0。

用法：
    python _check_chart_ink.py <标签> [卡片序号...]
    # 例：python _check_chart_ink.py big-pregnancy 3      # 血糖
不带序号则检查全部卡片。
读 tools/verify/.tmp/stats-shot/cards-<标签>/*.png
"""
import os
import re
import sys

from PIL import Image

ROOT = require('./_env').REPO
SHOT_DIR = os.path.join(_TMP, 'stats-shot')

label = sys.argv[1] if len(sys.argv) > 1 else 'big-pregnancy'
want = set(int(x) for x in sys.argv[2:]) if len(sys.argv) > 2 else None

card_dir = os.path.join(SHOT_DIR, 'cards-' + label)
if not os.path.isdir(card_dir):
    raise SystemExit('找不到目录：%s（先跑 _crop_cards.py）' % card_dir)

files = sorted(f for f in os.listdir(card_dir) if f.endswith('.png'))
rows = []
for f in files:
    m = re.match(r'(\d+)-', f)
    if not m:
        continue
    idx = int(m.group(1))
    if want and idx not in want:
        continue
    im = Image.open(os.path.join(card_dir, f)).convert('RGB')
    w, h = im.size
    px = im.load()
    # 卡片下半部就是绘图区；不细抠边界，靠"饱和度"把灰字/网格线排除掉
    y0, y1 = int(h * 0.34), int(h * 0.86)
    x0, x1 = int(w * 0.04), int(w * 0.96)
    total = 0
    ink = 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            total += 1
            # 只看「彩色」像素：曲线颜色饱和度都 >100，
            # 而坐标轴文字(#94a3b8 sat≈36)、网格线(#f1f5f9 sat≈6)、深色正文(sat≈25) 都在 60 以下。
            if (max(r, g, b) - min(r, g, b)) > 60:
                ink += 1
    ratio = ink * 100.0 / total if total else 0.0
    rows.append((idx, f, ratio, ink))

print('%-4s %-28s %-14s %s' % ('序号', '卡片', '曲线像素占比', '彩色像素数'))
for idx, f, ratio, ink in rows:
    flag = '  ← 🔴 图里没有线（空白）' if ink < 40 else ''
    print('%-4d %-28s %-14s %d%s' % (idx, f[3:-4], '%.2f%%' % ratio, ink, flag))
if rows:
    blank = [r for r in rows if r[3] < 40]
    print('\n空白图 %d / %d 张' % (len(blank), len(rows)))
