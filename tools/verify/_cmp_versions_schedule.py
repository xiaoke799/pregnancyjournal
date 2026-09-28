# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""对比各历史版本「前端内嵌排期」与「随包 json」的 id -> name，判断老用户数据用的是哪套口径。"""
import subprocess
import re

ROOT = require('./_env').REPO
TAGS = ['v0.0.26', 'v0.0.27', 'v0.0.28', 'HEAD']

# 仓库经历过一次目录搬移，前端/后端 json 的路径各准备几个候选
FRONT_CANDS = [
    'frontend/src/views/CheckupScheduleView.vue',
    'app/frontend/src/views/CheckupScheduleView.vue',
]
JSON_CANDS = [
    'app/server/node/data/checkup_schedule.json',
    'server/node/data/checkup_schedule.json',
]


def git_show(rev, path):
    r = subprocess.run(['git', 'show', '%s:%s' % (rev, path)], cwd=ROOT,
                       capture_output=True, text=True, encoding='utf-8')
    return r.stdout if r.returncode == 0 else None


def first_existing(rev, cands):
    for p in cands:
        s = git_show(rev, p)
        if s:
            return p, s
    return None, None


def embedded(src):
    i = src.find('const DEFAULT_SCHEDULE')
    if i < 0:
        return None
    j = src.find('\n]', i)
    blob = src[i:j if j > 0 else len(src)]
    return re.findall(r'id:\s*"(cs_\d+)"[\s\S]{0,200}?name:\s*"([^"]+)"', blob)


for tag in TAGS:
    print('================ %s ================' % tag)

    fp, fsrc = first_existing(tag, FRONT_CANDS)
    if not fsrc:
        print('  前端文件：找不到')
    else:
        em = embedded(fsrc)
        print('  前端路径：%s' % fp)
        if em is None:
            print('  前端内嵌排期：**没有**（改为走接口）')
        else:
            print('  前端内嵌排期：%d 条' % len(em))
            for i, n in em:
                print('      %-8s %s' % (i, n))

    jp, jsrc = first_existing(tag, JSON_CANDS)
    if not jsrc:
        print('  随包 json：找不到')
    else:
        pairs = re.findall(r'"id"\s*:\s*"(cs_\d+)"[\s\S]{0,300}?"name"\s*:\s*"([^"]+)"', jsrc)
        print('  随包 json：%s → %d 条' % (jp, len(pairs)))
        if len(pairs) <= 20:
            for i, n in pairs:
                print('      %-8s %s' % (i, n))
    print()
