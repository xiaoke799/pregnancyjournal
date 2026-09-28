# -*- coding: utf-8 -*-
import os as _os
_REPO = _os.path.abspath(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', '..'))
_TMP = _os.path.join(_REPO, 'tools', 'verify', '.tmp')

"""产检页配色改动 · 完善性审查
① 选择器集合比对（证明没丢规则、没有意外多出的规则）
② 逐条「属性: 值」比对，列出所有颜色属性的新旧映射
③ 全文件（模板/脚本）里 style 块之外是否还有写死色
④ --ck-* 令牌全局冲突检查由 shell 侧另做
"""
import io, re, sys, collections

OLD = os.path.join(_TMP, 'CheckupScheduleView.配色前.bak.vue')
NEW = os.path.join(_REPO, 'frontend/src/views/CheckupScheduleView.vue')


def style_block(path):
    s = io.open(path, encoding='utf-8').read()
    i = s.index('<style scoped>')
    j = s.index('</style>', i)
    return s[:i], s[i + len('<style scoped>'):j]


def strip_comments(css):
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def match_brace(css, open_idx):
    """返回与 css[open_idx]='{' 配对的那个 '}' 的下标。"""
    depth = 0
    for i in range(open_idx, len(css)):
        if css[i] == '{':
            depth += 1
        elif css[i] == '}':
            depth -= 1
            if depth == 0:
                return i
    return len(css) - 1


def parse_rules(css):
    """返回 [(media, selector, decls)]，支持一层 @media 嵌套。"""
    css = strip_comments(css)
    rules = []
    i = 0
    n = len(css)
    while i < n:
        at = css.find('@media', i)
        brace = css.find('{', i)
        if brace == -1:
            break
        if at != -1 and at < brace:
            head = css[at:brace].strip()
            close = match_brace(css, brace)
            inner = css[brace + 1:close]
            for sel, dec in parse_flat(inner):
                rules.append((head, sel, dec))
            i = close + 1
        else:
            close = match_brace(css, brace)
            sel = css[i:brace].strip()
            dec = css[brace + 1:close]
            for s in [x.strip() for x in sel.split(',') if x.strip()]:
                rules.append(('', s, dec))
            i = close + 1
    return rules


def parse_flat(inner):
    out = []
    i = 0
    while i < len(inner):
        brace = inner.find('{', i)
        if brace == -1:
            break
        close = inner.find('}', brace)
        sel = inner[i:brace].strip()
        dec = inner[brace + 1:close]
        for s in [x.strip() for x in sel.split(',') if x.strip()]:
            out.append((s, dec))
        i = close + 1
    return out


def props(dec):
    d = {}
    for part in dec.split(';'):
        if ':' not in part:
            continue
        k, v = part.split(':', 1)
        d[k.strip()] = v.strip()
    return d


_, old_css = style_block(OLD)
_, new_css = style_block(NEW)
old_rules = parse_rules(old_css)
new_rules = parse_rules(new_css)

old_sel = collections.OrderedDict()
for m, s, d in old_rules:
    old_sel[(m, s)] = d
new_sel = collections.OrderedDict()
for m, s, d in new_rules:
    new_sel[(m, s)] = d

print('=' * 78)
print('① 选择器集合比对')
print('   旧 %d 条 / 新 %d 条' % (len(old_sel), len(new_sel)))
removed = [k for k in old_sel if k not in new_sel]
added = [k for k in new_sel if k not in old_sel]
print('   被删除的选择器 (%d):' % len(removed))
for k in removed:
    print('      -', k[1] or k[0], '   =>', old_sel[k][:70])
print('   新增的选择器 (%d):' % len(added))
for k in added:
    print('      +', k[1] or k[0])

print()
print('=' * 78)
print('② 颜色属性新旧映射（逐规则）')
COLOR_KEYS = ('color', 'background', 'background-color', 'border', 'border-color',
              'border-top', 'border-bottom', 'border-left', 'border-right',
              'box-shadow', 'outline')
def colorish(v):
    return bool(re.search(r'#[0-9a-fA-F]{3,8}\b|rgba?\(|var\(--|\bwhite\b|\btransparent\b', v))

changed = 0
for k in old_sel:
    if k not in new_sel:
        continue
    o, n = props(old_sel[k]), props(new_sel[k])
    for key in sorted(set(o) | set(n)):
        if not any(c in key for c in COLOR_KEYS):
            continue
        ov, nv = o.get(key), n.get(key)
        if ov is None or nv is None or ov == nv:
            if ov != nv:
                print('  [增删] %-34s %-14s %r -> %r' % (k[1][:34], key, ov, nv))
                changed += 1
            continue
        if colorish(ov) or colorish(nv):
            print('  %-34s %-14s %s  ->  %s' % (k[1][:34], key, ov[:52], nv[:52]))
            changed += 1
print('  共 %d 条颜色相关改动' % changed)

print()
print('=' * 78)
print('③ style 块之外是否还有写死色（模板 inline style / :style / JS 字符串）')
head_old, _ = style_block(OLD)
head_new, _ = style_block(NEW)
for tag, head in (('旧', head_old), ('新', head_new)):
    hits = []
    for m in re.finditer(r'(?:style\s*=\s*"([^"]*)"|:\s*style\s*=\s*"([^"]*)")', head):
        v = (m.group(1) or m.group(2) or '').strip()
        if v:
            hits.append(v)
    js_hits = re.findall(r"'[^']*#[0-9a-fA-F]{6}[^']*'|\"[^\"]*#[0-9a-fA-F]{6}[^\"]*\"", head)
    print('  [%s] inline/:style 共 %d 处:' % (tag, len(hits)))
    for h in hits:
        print('        ', h)
    print('  [%s] JS 里含 #rrggbb 的字面量 %d 处:' % (tag, len(js_hits)))
    for h in js_hits:
        print('        ', h)
