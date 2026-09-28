# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""决定性比对：v0.0.28 前端内嵌排期（用户实际看到并据此写数据的口径）
   vs 工作区新 json（改后推送读取的口径） vs HEAD 旧 json（改前推送读取的口径）。"""
import subprocess
import io
import json
import re

ROOT = require('./_env').REPO


def git_show(path):
    return subprocess.run(['git', 'show', path], cwd=ROOT,
                          capture_output=True, text=True, encoding='utf-8').stdout


# --- 1) v0.0.28 前端内嵌 DEFAULT_SCHEDULE ---
src = git_show('v0.0.28:frontend/src/views/CheckupScheduleView.vue')
start = src.find('const DEFAULT_SCHEDULE')
end = src.find('\n]', start)
blob = src[start:end]
front = re.findall(r'id:\s*"(cs_\d+)"[\s\S]{0,200}?name:\s*"([^"]+)"', blob)
print('=== v0.0.28 前端内嵌排期（用户实际看到的口径）: %d 条 ===' % len(front))
for i, n in front:
    print('   %-8s %s' % (i, n))

# --- 2) 工作区新 json ---
newj = json.load(io.open(ROOT + '/app/server/node/data/checkup_schedule.json', encoding='utf-8'))
newmap = {it['id']: it['name'] for it in newj}
print()
print('=== 工作区新 json（改后推送口径）: %d 条 ===' % len(newmap))

# --- 3) HEAD 旧 json ---
oldj = json.loads(git_show('HEAD:app/server/node/data/checkup_schedule.json'))
oldmap = {it['id']: it['name'] for it in oldj}
print('=== HEAD 旧 json（改前推送口径）: %d 条 ===' % len(oldmap))

# --- 4) 三方逐条比对 ---
print()
print('=== 逐条比对（以用户实际看到的前端口径为基准） ===')
print('%-8s %-26s %-26s %s' % ('id', '用户看到(v0.0.28前端)', '改后推送(新json)', '改前推送(旧json)'))
same_new = same_old = 0
front_ids = [i for i, _ in front]
for i, n in front:
    nv = newmap.get(i, '（无此 id）')
    ov = oldmap.get(i, '（无此 id）')
    ok_new = '✅' if nv == n else '❌'
    ok_old = '✅' if ov == n else '❌'
    if nv == n:
        same_new += 1
    if ov == n:
        same_old += 1
    print('%-8s %-26s %-26s %s   %s%s' % (i, n, nv, ov, ok_new, ok_old))
print()
print('→ 与「用户看到的口径」一致：新 json %d/%d ；旧 json %d/%d'
      % (same_new, len(front), same_old, len(front)))
print('→ 新 json 里用户口径不存在的 id：%s' % (sorted(set(front_ids) - set(newmap)) or '无'))
print('→ 旧 json 里多出来的 id：%s' % (sorted(set(oldmap) - set(front_ids)) or '无'))
