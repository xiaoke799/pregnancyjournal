# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""审查②：令牌冲突 + style 块外的实际色值"""
import io, re, os

ROOT = os.path.join(_REPO, 'frontend/src')

# ---- ① --ck- 出现在哪些文件 ----
hits = {}
for dirpath, _dirs, files in os.walk(ROOT):
    for fn in files:
        if not fn.endswith(('.vue', '.ts', '.css', '.js')):
            continue
        p = os.path.join(dirpath, fn)
        try:
            t = io.open(p, encoding='utf-8').read()
        except Exception:
            continue
        n = t.count('--ck-')
        if n:
            hits[os.path.relpath(p, ROOT).replace('\\', '/')] = n
print('① 含 --ck- 的文件：')
for k, v in sorted(hits.items(), key=lambda x: -x[1]):
    print('   %-46s %d 次' % (k, v))
others = [k for k in hits if 'CheckupScheduleView.vue' not in k]
print('   → 本文件之外：', others if others else '无（无全局冲突）')

# ---- ② style 块外的实际色值 ----
V = os.path.join(_REPO, 'frontend/src/views/CheckupScheduleView.vue')
s = io.open(V, encoding='utf-8').read()
head = s[:s.index('<style scoped>')]
nc = re.sub(r'/\*.*?\*/', '', head, flags=re.S)
nc = re.sub(r'<!--.*?-->', '', nc, flags=re.S)
nc = re.sub(r'(?m)//.*$', '', nc)
print()
print('② style 块外（模板 + 脚本）去注释后的实际色值：')
print('   hex      :', re.findall(r'#[0-9a-fA-F]{3,8}\b', nc) or '无')
print('   rgb/rgba :', re.findall(r'rgba?\([^)]*\)', nc) or '无')
print('   color:   :', re.findall(r'color:\s*[^;"]+', nc) or '无')
print('   var(--  :', re.findall(r'var\(--[a-z0-9-]+', nc) or '无')

# ---- ③ 样式块里剩余的 rgba/白字（应只剩中性叠加与彩底白字） ----
style = s[s.index('<style scoped>'):]
style_nc = re.sub(r'/\*.*?\*/', '', style, flags=re.S)
print()
print('③ 样式块里剩余的 rgb/rgba 与 white：')
for m in re.finditer(r'^\s*([^{}\n]+)\{([^}]*)\}', style_nc, re.M):
    sel, dec = m.group(1).strip(), m.group(2)
    for d in dec.split(';'):
        if re.search(r'rgba?\(|\bwhite\b|#fff\b', d):
            print('   %-34s %s' % (sel[:34], d.strip()))
