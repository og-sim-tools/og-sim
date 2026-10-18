"""Quick-and-dirty helpers for reading Overgeared Hero wiki tables (wikitext).

Used by wiki_dump.py to transcribe wiki tables into markdown reference docs.
"""
import re

RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"]

ATTR_RE = re.compile(r'^\s*((?:(?:class|style|rowspan|colspan|align|width)\s*=\s*"[^"]*"\s*)+)\|?(?!\|)')


def split_tables(text):
    """Return list of (start_index, table_body) for every {| ... |} table."""
    out = []
    for m in re.finditer(r'\{\|', text):
        end = text.find('\n|}', m.start())
        if end == -1:
            continue
        out.append((m.start(), text[m.start():end]))
    return out


def _strip_attrs(cell):
    """Remove leading html attributes from a table cell, with or without the separating pipe."""
    cell = cell.strip()
    m = ATTR_RE.match(cell)
    attrs = {}
    if m:
        for k, v in re.findall(r'(\w+)\s*=\s*"([^"]*)"', m.group(1)):
            attrs[k] = v
        cell = cell[m.end():].strip()
    # malformed: style="width:220px; | Header  (unterminated quote)
    cell = re.sub(r'^style="[^|]*\|\s*', '', cell)
    return cell, attrs


def parse_table(body):
    """Parse a wiki table into header list and rows (list of dicts with 'cells' and 'category').

    Handles rowspan and in-table category header rows (`! colspan=N | Title`).
    """
    lines = body.split('\n')[1:]  # drop the {| line
    headers, rows = [], []
    cur, cur_is_header = None, False
    category = None
    pending = {}  # column index -> (remaining_rows, text)

    def flush():
        nonlocal cur, category
        if cur is None:
            return
        if cur_is_header and not rows and not headers_done[0]:
            headers.extend(c for c, _ in cur)
            headers_done[0] = True
        elif cur_is_header:
            category = ' '.join(c for c, _ in cur).strip()
        else:
            cells = []
            src = list(cur)
            col = 0
            while src or col in pending:
                if col in pending:
                    n, txt = pending[col]
                    cells.append(txt)
                    if n - 1 > 0:
                        pending[col] = (n - 1, txt)
                    else:
                        del pending[col]
                else:
                    txt, attrs = src.pop(0)
                    cells.append(txt)
                    rs = int(attrs.get('rowspan', '1') or 1)
                    if rs > 1:
                        pending[col] = (rs - 1, txt)
                col += 1
            if any(c.strip() for c in cells):
                rows.append({'cells': cells, 'category': category})
        cur = None

    headers_done = [False]
    for line in lines:
        if line.startswith('|-'):
            flush()
            cur, cur_is_header = [], False
            continue
        if line.startswith('!'):
            if cur is None or (cur and not cur_is_header):
                flush()
                cur = []
            cur_is_header = True
            for part in line[1:].split('!!'):
                txt, attrs = _strip_attrs(part)
                cur.append((txt, attrs))
            continue
        if line.startswith('|') and not line.startswith('|}'):
            if cur is None:
                cur, cur_is_header = [], False
            for part in line[1:].split('||'):
                txt, attrs = _strip_attrs(part)
                cur.append((txt, attrs))
            continue
        # continuation of previous cell
        if cur:
            txt, attrs = cur[-1]
            cur[-1] = (txt + '\n' + line, attrs)
    flush()
    headers = [clean(h) for h in headers]
    return headers, rows


def icon_tokens(t):
    t = re.sub(r'\[\[File:([^|\]]+?)[-_]Description\.png[^\]]*\]\]', lambda m: '{' + m.group(1).replace('_', ' ') + '}', t)
    return t


def file_names(t):
    return [f.strip() for f in re.findall(r'\[\[File:([^|\]]+)', t)]


def grade_spans(t):
    """List of (rarity, inner_text) for every grade-coloured span, in order."""
    return [(r, inner) for r, inner in re.findall(r'<span class="grade-([\w-]+)">(.*?)</span>', t, flags=re.S)]


def detok(t):
    """Turn {Icon} tokens into plain words, dropping them where the next word repeats them.

    `Inflict 6 {Burn} Burn` -> `Inflict 6 Burn`; `On {Filled Socket} Weapon Hit` -> `On [dot] Weapon Hit`.
    """
    out, pos = [], 0
    for m in re.finditer(r'\{([^}]+)\}[ \t]*', t):
        out.append(t[pos:m.start()])
        name = m.group(1).strip()
        nxt = t[m.end():].lower()
        words = name.lower().split()
        if name == 'Filled Socket':
            out.append('[dot] ')
        elif nxt.startswith(words[-1]) or nxt.startswith(words[0]) or (len(words[0]) >= 4 and nxt.startswith(words[0][:4])) or (words[0] == 'attack' and nxt.startswith('on ')):
            pass
        elif name in ('Attack DMG', 'ATK', 'All DMG', 'Crit Rate', 'Coin') and re.match(r'[\d+]', nxt):
            pass  # "{Attack DMG} 3.0x ATK DMG" -> "3.0x ATK DMG"
        elif name == 'Haste' and nxt.startswith('swift'):
            pass
        else:
            out.append(name + ' ')
        pos = m.end()
    out.append(t[pos:])
    return ''.join(out)


def clean(t, keep_lines=False):
    """Wikitext cell -> readable markdown-ish text."""
    t = icon_tokens(t)
    t = re.sub(r'<span class="(?:inline-sprite|pixel-sprite)">(\{[^}]+\})</span>', r'\1', t)
    t = re.sub(r'\[\[File:Star-tier\.png[^\]]*\]\]', '★', t)
    t = re.sub(r'\[\[File:[^\]]*\]\]', '', t)
    t = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', t)
    t = re.sub(r"'''(.*?)'''", r'\1', t)
    t = re.sub(r"''(.*?)''", r'_\1_', t)
    t = re.sub(r'<div style="border-top[^>]*></div>', '\n---\n', t)
    t = re.sub(r'<br\s*/?>', '\n', t)
    t = re.sub(r'<[^>]+>', '', t)
    t = t.replace('&nbsp;', ' ')
    t = detok(t)
    if keep_lines:
        lines = [re.sub(r'[ \t]+', ' ', l).strip() for l in t.split('\n')]
        return '\n'.join(l for l in lines if l)
    return re.sub(r'\s+', ' ', t).strip()


def rarity_of(t):
    for r in re.findall(r'class="grade-([\w-]+)"', t):
        return r
    return None


def footprint(t):
    rows = []
    for part in re.split(r'<br\s*/?>', t):
        cells = re.findall(r'class="grid-(\w+)"', part)
        if cells:
            rows.append(''.join({'filled': '#', 'socket': 'o', 'empty': '.'}.get(c, '?') for c in cells))
    return rows


def norm(name):
    name = re.sub(r'\.png$', '', name, flags=re.I)
    return re.sub(r'[\s_]+', ' ', name).strip().lower()


def md_cell(t):
    return t.replace('|', '\\|').replace('\n', '<br>')
