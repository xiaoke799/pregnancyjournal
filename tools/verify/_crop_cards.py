# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""按 shot_stats.js 探针输出的 rects（卡片坐标）逐张裁剪截图，放大 2 倍。

为什么要有这个：一次截 14 张卡的长图，直接看缩略图读不出坐标轴刻度、单位、汇总数字。
把每张卡单独裁出来放大，才能逐张核对（y 轴是否从 0 起、横轴标签够不够、图例对不对）。

用法：
    python _crop_cards.py <标签> [放大倍数]
读 tools/verify/.tmp/stats-shot/<标签>.png 与 <标签>.json（取 m_rects）
写 tools/verify/.tmp/stats-shot/cards-<标签>/<序号>-<卡片标题>.png
"""
import io
import json
import os
import re
import sys

from PIL import Image

# ⚠️ 这里原有一行 `ROOT = require('./_env').REPO` —— 从 JS 脚本抄过来的语法，
#    在 Python 里必然 NameError（而且 ROOT 根本没人用，真正用的是上面的 _REPO/_TMP）。
#    2026-09-30 删除；本脚本依赖 pillow（`pip install pillow`）。
SHOT_DIR = os.path.join(_TMP, 'stats-shot')

label = sys.argv[1] if len(sys.argv) > 1 else 'big-pregnancy'
scale = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0

png_path = os.path.join(SHOT_DIR, label + '.png')
json_path = os.path.join(SHOT_DIR, label + '.json')
im = Image.open(png_path)
diag = json.load(io.open(json_path, encoding='utf-8'))

rects_raw = diag.get('m_rects') or ''
titles = (diag.get('m_titles') or '').split('|')
rects = []
for part in rects_raw.split(','):
    part = part.strip()
    if not part or ':' not in part:
        continue
    top, h = part.split(':')
    rects.append((int(top), int(h)))

if len(rects) != len(titles):
    print('⚠️ 坐标数(%d) 与标题数(%d) 不一致，仍按序号裁剪' % (len(rects), len(titles)))

outdir = os.path.join(SHOT_DIR, 'cards-' + label)
os.makedirs(outdir, exist_ok=True)
# 清掉上一次的产物（只删本目录下的 png，数量可控）
for f in os.listdir(outdir):
    if f.endswith('.png'):
        os.remove(os.path.join(outdir, f))

W = im.size[0]
written = []
skipped = []
for i, (top, h) in enumerate(rects):
    name = titles[i] if i < len(titles) else ('card%d' % i)
    if top >= im.size[1]:
        skipped.append('%02d %s  y=%d（超出截图高度 %d，请把 PJ_SHOT_H 调大）' % (i + 1, name, top, im.size[1]))
        continue
    safe = re.sub(r'[^\w\u4e00-\u9fff-]', '_', name)
    left = 0
    right = W
    box = (left, max(0, top - 2), right, min(im.size[1], top + h + 2))
    crop = im.crop(box)
    crop = crop.resize((int(crop.size[0] * scale), int(crop.size[1] * scale)), Image.LANCZOS)
    path = os.path.join(outdir, '%02d-%s.png' % (i + 1, safe))
    crop.save(path)
    written.append('%02d %s  y=%d h=%d' % (i + 1, name, top, h))

print('共 %d 张 → %s' % (len(written), outdir))
print('\n'.join(written))
if skipped:
    print('\n⚠️ 跳过 %d 张：' % len(skipped))
    print('\n'.join(skipped))
