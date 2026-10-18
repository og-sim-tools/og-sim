"""Transcribe Overgeared Hero wiki tables into markdown reference docs.

Usage: python3 -I wiki_dump.py <cache_dir> <out_dir>

<cache_dir> holds the API responses saved as <Page>.wikitext (Items saved as items.wikitext)
and a heroes/ subfolder with one <Hero>.wikitext per hero.
Quick and dirty on purpose: it writes markdown for humans and Claude Code to read,
and lists everything odd in flags.json for manual review.
"""
import json
import os
import re
import sys
from collections import OrderedDict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wikiparse import (RARITIES, clean, file_names, footprint, grade_spans, md_cell, norm,
                       parse_table, rarity_of, split_tables)

CACHE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
WIKI = 'https://overgearedhero.fandom.com/wiki/'
FLAGS = []
KNOWN_ICONS = {'Attack DMG', 'Cooldown', 'Accuracy', 'Coin', 'Filled Socket', 'Block', 'Burn', 'Freeze', 'Dodge',
               'Heal', 'Poison', 'Focus', 'Spike', 'Stun', 'Remove Buff', 'Cleanse', 'Vamp', 'Crit Rate',
               'Healing Reduction', 'HP', 'Haste', 'Regen', 'All DMG', 'Invincible', 'Seal', 'Block Remove',
               'DMG Increase', 'Item Haste', 'Extra Attack', 'ATK', 'All DMG Reduction'}


def flag(page, what, detail):
    FLAGS.append({'page': page, 'what': what, 'detail': detail})


def read(name):
    return open(os.path.join(CACHE, name + '.wikitext'), encoding='utf-8').read()


def tables(text):
    return [parse_table(b) for _, b in split_tables(text)]


def note_icons(page, ctx, raw):
    for ic in re.findall(r'\[\[File:([^|\]]+?)[-_]Description\.png', raw):
        ic = ic.replace('_', ' ')
        if ic not in KNOWN_ICONS:
            KNOWN_ICONS.add(ic)
            flag(page, 'new icon', f'{{{ic}}} first seen in {ctx}')


def header(title, page_urls, extra=''):
    src = ', '.join(f'[{p}]({WIKI}{p.replace(" ", "_")})' for p in page_urls)
    return (f'# {title}\n\n_Transcribed from the Overgeared Hero wiki ({src}) on 2026-10-15. '
            f'Wiki data is unverified; see REVIEW.md for known problems._\n\n{extra}')


# ------------------------------------------------------------------ items
items_text = read('items')
TABS = ['Universal', 'Warrior', 'Ranger', 'Wizard', 'Pet']
item_tables = [t for t in tables(items_text) if t[0][:2] == ['Sprite', 'Name']]
assert len(item_tables) == 5, len(item_tables)

ITEMS = OrderedDict()   # name -> dict
SPRITES = {}            # normalised sprite / name -> item name


STAT_LABEL = {'Attack DMG': 'DMG', 'Cooldown': 'Cooldown', 'Accuracy': 'Accuracy', 'Crit Rate': 'Crit'}


def parse_stats(raw, name):
    out = []
    for line in re.split(r'<br\s*/?>', raw):
        if not line.strip():
            continue
        m = re.search(r'\[\[File:([^|\]]+?)[-_]Description\.png', line)
        icon = m.group(1).replace('_', ' ') if m else None
        txt = clean(re.sub(r'\[\[File:[^\]]*\]\]', '', line))
        if icon in STAT_LABEL:
            out.append(f'{STAT_LABEL[icon]} {txt.replace(" ATK DMG", " ATK")}')
        else:
            out.append(clean(line))
            flag('Items', 'unusual stat line', f'{name}: {clean(line)}')
    return out


for tab, (hdr, rows) in zip(TABS, item_tables):
    for r in rows:
        c = r['cells']
        sprite = (file_names(c[0]) or [''])[0]
        name = clean(c[1])
        it = {
            'tab': tab, 'name': name, 'sprite': sprite, 'rarity': rarity_of(c[1]),
            'tags': [clean(x) for x in re.split(r'<br\s*/?>', c[2]) if clean(x)],
            'stats': parse_stats(c[3], name), 'effect': clean(c[4], keep_lines=True),
            'footprint': footprint(c[5]),
            'value': (re.findall(r'\d+|\?', clean(c[6])) or ['?'])[0],
            'merges_raw': file_names(c[7]) if len(c) > 7 else [],
            'components_raw': file_names(c[8]) if len(c) > 8 else [],
        }
        note_icons('Items', name, c[3] + c[4])
        if not it['rarity']:
            flag('Items', 'missing rarity', name)
        fp = it['footprint']
        if not fp or '#' not in ''.join(fp):
            flag('Items', 'footprint has no filled cell', name)
        if fp and len(set(len(x) for x in fp)) > 1:
            flag('Items', 'ragged footprint rows', f'{name}: {fp}')
        has_socket = 'o' in ''.join(fp)
        mentions_socket = '[dot]' in it['effect']
        if has_socket != mentions_socket:
            flag('Items', 'socket mismatch', f'{name}: footprint sockets={has_socket}, effect mentions socket icon={mentions_socket}')
        if it['value'] == '?':
            it['value'] = '0 (wiki: ?)'
        key = name if name not in ITEMS else f'{name} ({tab})'
        if key != name:
            flag('Items', 'duplicate name', f'{name} appears in {ITEMS[name]["tab"]} and {tab}')
        ITEMS[key] = it
        SPRITES[norm(sprite)] = key
        SPRITES[norm(name)] = key


def resolve(fname, page, ctx):
    n = norm(fname)
    if n in SPRITES:
        return SPRITES[n]
    import difflib
    guess = difflib.get_close_matches(n, list(SPRITES), n=3, cutoff=0.6)
    gtxt = ', '.join(SPRITES[g] for g in guess) or 'no close match'
    flag(page, 'unresolved name', f'`{fname}` in {ctx} — closest: {gtxt}')
    return f'❓{fname.rsplit(".", 1)[0].replace("_", " ")}'


for it in ITEMS.values():
    it['merges'] = [resolve(f, 'Items', f'{it["name"]} → merge recipes') for f in it['merges_raw']]
    it['components'] = [resolve(f, 'Items', f'{it["name"]} → components') for f in it['components_raw']]

# reverse check: components ↔ merges
UNMIRRORED = []
for it in ITEMS.values():
    for comp in it['components']:
        other = ITEMS.get(comp)
        if other and it['name'] not in other['merges'] and other['tab'] != 'Pet':
            UNMIRRORED.append((it['name'], comp))

# ------------------------------------------------------------------ heroes (needed for exclusive flags)
HERO_ORDER = ['Bjorn', 'Rose', 'Darkan', 'Rebecca', 'Kai', 'Spearman', 'Barbarian', 'Fighter',
              'Erwen', 'Raven', 'Talin', 'Venom', 'Lua', 'Acrobat', 'Sniper', 'Archer',
              'Trixie', 'Cecilia', 'Spark', 'Feline_Mage', 'Fire_Mage', 'Ice_Mage', 'Mage']
SUPPLY_STARS = {'legendary': [0, 0, 1, 3, 5, 7], 'epic': [0, 1, 3, 5, 7], 'rare': [1, 3, 5, 7]}
HEROES = []
EXCLUSIVE = {}  # item name -> hero
for h in HERO_ORDER:
    t = open(os.path.join(CACHE, 'heroes', h + '.wikitext'), encoding='utf-8').read()
    info = dict(re.findall(r'^\|(\w+)=(.*)$', t.split('}}', 1)[0], flags=re.M))
    hero = {'page': h, 'name': clean(info.get('title', h)), 'class': clean(info.get('type', '')),
            'rarity': rarity_of(info.get('grade', '')), 'supply_ability': info.get('supply_ability', '').strip()}
    skills_sec = re.search(r'== Skills ==(.*?)\n== ', t, flags=re.S)
    hero['skills'] = [(clean(n), clean(d, keep_lines=True)) for n, d in re.findall(
        r'<div class="skill-name">(.*?)</div>.*?<div class="skill-description">(.*?)</div>',
        skills_sec.group(1) if skills_sec else '', flags=re.S)]
    if len(hero['skills']) != 2:
        flag(f'Hero: {hero["name"]}', 'expected 2 skills', f'found {len(hero["skills"])}')
    links = {}
    for star, sk in re.findall(r"Star-tier\.png\|link=\]\]</span> (\d):'''\s*Skill Link Unlocked: \[([^\]]+)\]", t):
        links[int(star)] = sk
    hero['links'] = links
    ex = []
    for card in re.findall(r'<div class="exclusive-item-card">(.*?)\n</div>\n</div>\n</div>', t, flags=re.S):
        nm = clean(re.search(r'exclusive-item-name">(.*?)</div>', card).group(1))
        how = clean(re.search(r'exclusive-item-description">(.*?)</div>', card, flags=re.S).group(1))
        icons = re.search(r'exclusive-item-output-icons">(.*?)</div>', card, flags=re.S).group(1)
        parts = [resolve(f, f'Hero: {hero["name"]}', f'exclusive item {nm}') for f in file_names(icons)]
        recipe = None
        if '=' in icons and len(parts) == 3:
            recipe = f'{parts[0]} + {parts[1]} = {parts[2]}'
            result = parts[2]
        else:
            result = parts[-1] if parts else nm
        ex.append({'name': nm, 'how': how, 'recipe': recipe, 'item': result})
        if result in EXCLUSIVE and EXCLUSIVE[result] != hero['name']:
            flag('Heroes', 'item exclusive to two heroes', f'{result}: {EXCLUSIVE[result]} and {hero["name"]}')
        EXCLUSIVE[result] = hero['name']
        if norm(nm) != norm(result.lstrip('❓')):
            flag(f'Hero: {hero["name"]}', 'exclusive item name differs from item', f'card says "{nm}", item resolved to "{result}"')
    hero['exclusive'] = ex
    sup = re.search(r'\{\{Hero Supplies(.*?)\}\}', t, flags=re.S)
    supplies = []
    if sup:
        params = dict(re.findall(r'\|(\w+)=([^\n|]*)', sup.group(1)))
        g = params.get('grade', '').strip().lower()
        n = 1
        while f'item{n}' in params:
            stars = SUPPLY_STARS.get(g, [])
            st = stars[n - 1] if n - 1 < len(stars) else '?'
            supplies.append((st, resolve(params[f'item{n}'].strip(), f'Hero: {hero["name"]}', 'supplies')))
            n += 1
        if g != hero['rarity']:
            flag(f'Hero: {hero["name"]}', 'supplies grade ≠ hero grade', f'{g} vs {hero["rarity"]}')
        if len(supplies) != len(SUPPLY_STARS.get(g, [])):
            flag(f'Hero: {hero["name"]}', 'unexpected number of supplies', f'{len(supplies)} for grade {g}')
    hero['supplies'] = supplies
    hero['skins'] = [clean(x) for x in re.findall(r'\{\{Hero Skin\s*\|.*?\|title=([^\n|]*)', t, flags=re.S)]
    for sn, sd in hero['skills']:
        if re.search(r'(_x_|x\?|\?x|\bx\b(?! ?\d))', sd):
            flag(f'Hero: {hero["name"]}', 'placeholder value in skill text', f'{sn}: "{sd}"')
    base = {'rare': '5', 'epic': '8', 'legendary': '10'}.get(hero['rarity'])
    if base and hero['supply_ability'] != base:
        flag(f'Hero: {hero["name"]}', 'supply ability ≠ grade base', f'{hero["supply_ability"]} vs {base}')
    for star in (4, 8):
        if star not in links:
            flag(f'Hero: {hero["name"]}', 'missing skill link', f'no skill listed for star {star}')
        elif links[star] not in [s for s, _ in hero['skills']]:
            flag(f'Hero: {hero["name"]}', 'skill link name not among skills', f'{star}★: {links[star]}')
    HEROES.append(hero)

for nm, hero in EXCLUSIVE.items():
    if nm in ITEMS:
        ITEMS[nm]['hero_exclusive'] = hero

# ------------------------------------------------------------------ write items.md
fp_note = ('**Footprint legend:** `#` occupied cell, `o` item dot (socket), `.` empty. Rows are separated by ` / `, '
           'top row first, as drawn on the wiki (unrotated).\n\n'
           '**Scaling:** `Nx ATK DMG` = N × ATK. Block removal also scales with ATK. Heals, HP and Block gains scale with HP. '
           'Values are shop prices in gold; sell value = ceil(value / 2) (the wiki’s sale/sell numbers are wrong).\n\n')
lines = [header('Items', ['Items'], fp_note)]
for tab in TABS:
    group = [i for i in ITEMS.values() if i['tab'] == tab]
    title = {'Pet': 'Pet-spawned items'}.get(tab, f'{tab} items')
    lines.append(f'## {title} ({len(group)})\n')
    if tab == 'Universal':
        lines.append('Available to every class. Some merge recipes vary by class.\n')
    elif tab == 'Pet':
        lines.append('Not pets — items that pets put into empty bag cells at battle start. Price `?` on the wiki → 0.\n')
    else:
        lines.append(f'Only available to {tab} heroes.\n')
    cols = ['Item', 'Rarity', 'Tags', 'Stats', 'Effect', 'Footprint', 'Value']
    if tab != 'Pet':
        cols += ['Merges into', 'Made from']
    lines.append('| ' + ' | '.join(cols) + ' |')
    lines.append('|' + '---|' * len(cols))
    for i in group:
        nm = i['name'] + (f' 🔒{i["hero_exclusive"]}' if i.get('hero_exclusive') else '')
        row = [nm, (i['rarity'] or '?').title(), ', '.join(i['tags']), '<br>'.join(i['stats']),
               i['effect'], '`' + ' / '.join(i['footprint']) + '`', i['value']]
        if tab != 'Pet':
            row += [', '.join(i['merges']) or '—', ', '.join(i['components']) or '—']
        lines.append('| ' + ' | '.join(md_cell(x) for x in row) + ' |')
    lines.append('')
lines.append('🔒 = hero-exclusive item (from the hero pages). ❓ = name the wiki references that matches no item; see REVIEW.md.\n')
open(os.path.join(OUT, 'items.md'), 'w').write('\n'.join(lines))

# ------------------------------------------------------------------ gear.md
gear_text = read('Gear')
gt = tables(gear_text)
slots_tbl = gt[0]
upg_tbl = gt[2]
weapons, shields, rings, gloves, auras = gt[3], gt[4], gt[5], gt[6], gt[7]

lines = [header('Gear', ['Gear'],
                '**Not on the wiki, so every gear piece below still needs, entered by hand:** shape, item dots, and for weapons '
                'the basic attack stats (DMG ratio, cooldown, accuracy, crit rate, hits per attack).\n\n'
                'Bonus stats and plain stat lines in "effects by rarity" (e.g. `ATK +25%`) are already included in Stat Details, '
                'so the simulator doesn’t apply them again; they are marked _(stat only)_.\n\n')]
lines.append('## Slots\n')
lines.append('| Slot | Quantity |\n|---|---|')
for r in slots_tbl[1]:
    lines.append(f'| {clean(r["cells"][1])} | {clean(r["cells"][2])} |')
lines.append('\n## Rarity and tiers\n')
lines.append('Common → Uncommon → Rare → Epic → Legendary → Mythic. Tiers: Epic +0…+2, Legendary +0…+3, Mythic +0…+4.\n')
lines.append('**Effects by rarity:** each rarity adds the effect listed for it, and keeps all lower ones. '
             'S-rank gear (marked ⭐S) can only be obtained from certain chests.\n')


def gear_block(r, slot, has_skill):
    c = r['cells']
    name_raw = c[2]
    name = clean(name_raw)
    s_rank = 'S Rank.png' in name_raw
    out = [f'### {name}{" ⭐S" if s_rank else ""}\n']
    out.append(f'- **Slot:** {slot}')
    if has_skill:
        out.append(f'- **Bonus stat:** {clean(c[3])} _(stat only)_')
        out.append(f'- **Skill:** {clean(c[4])}')
        eff, grades = c[5], c[6]
    else:
        eff, grades = c[3], c[4]
    note_icons('Gear', name, ''.join(c))
    out.append(f'- **Gear effect:** {clean(eff) or "—"}')
    spans = grade_spans(grades)
    if not spans:
        flag('Gear', 'no rarity effects found', name)
    out.append('- **Effects by rarity:**')
    seen = []
    for rar, txt in spans:
        t = clean(txt)
        stat_only = bool(re.fullmatch(r'(ATK|HP|Attack DMG|All DMG|Crit Rate|Block Gain|Spike DMG|Burn DMG|Poison DMG|'
                                      r'Freeze Inflict|Burn Inflict|Poison Inflict|Item Haste|Accuracy)\s*\+\s*\d+(\.\d+)?%', t))
        out.append(f'  - {rar.title()}: {t}{" _(stat only)_" if stat_only else ""}')
        seen.append(rar)
    order = [RARITIES.index(x) for x in seen if x in RARITIES]
    if order != sorted(order):
        flag('Gear', 'rarity effects out of order', f'{name}: {seen}')
    for m in re.findall(r'\[([A-Z][^\]]+)\]\s*-', clean(''.join(c))):
        flag('Gear', 'named gear mechanic', f'{name}: [{m}]')
    out.append('- **Needs manual entry:** shape, dots' + (', basic attack stats' if has_skill else ''))
    out.append('')
    return out


for title, (hdr, rows), has_skill, slot in [('Weapons', weapons, True, 'Weapon'), ('Shields', shields, False, 'Shield'),
                                            ('Rings', rings, False, 'Ring'), ('Gloves', gloves, False, 'Glove')]:
    lines.append(f'## {title} ({len(rows)})\n')
    sec = re.search(r'== ' + title + r' ==\n(.*?)\n\n', gear_text, flags=re.S)
    if sec:
        lines.append(clean(sec.group(1)) + '\n')
    for r in rows:
        lines.extend(gear_block(r, slot, has_skill))

lines.append(f'## Auras ({len(auras[1])})  — [LATER]\n')
lines.append('One aura can be equipped. Only the aura skill matters (economy); ownership effects are ignored.\n')
lines.append('| Aura | Rarity | Aura skill | Skill effect |\n|---|---|---|---|')
for r in auras[1]:
    c = r['cells']
    lines.append(f'| {md_cell(clean(c[1]))} | {(rarity_of(c[1]) or "?").title()} | {md_cell(clean(c[2]))} | {md_cell(clean(c[3]))} |')
lines.append('')
open(os.path.join(OUT, 'gear.md'), 'w').write('\n'.join(lines))

# ------------------------------------------------------------------ blessings.md
bt = tables(read('Dragon%27s_Blessing'))
lvl, common, klass, unique = bt[2], bt[3], bt[4], bt[5]
lines = [header('Dragon’s Blessing', ["Dragon's Blessing"],
                '**Blessings are per hero.** Each hero has their own blessing slots. Hero-exclusive (unique) blessings can only '
                'be rolled on their own hero; linking that hero’s skill to another hero does not unlock them.\n\n'
                'I enter the exact value of each blessing I own. Common and class blessings roll inside a range per rarity; '
                'unique blessings have one fixed value per rarity.\n\n')]
lines.append('## Slots by Dragon’s Blessing level\n\n| Level | Slots |\n|---|---|')
for r in lvl[1]:
    lines.append(f'| {clean(r["cells"][0])} | {clean(r["cells"][1])} |')
lines.append('\n_Drop rates and XP are on the wiki but not needed by the simulator._\n')


def range_table(rows, lead_cols):
    head = lead_cols + [x.title() for x in RARITIES]
    out = ['| ' + ' | '.join(head) + ' |', '|' + '---|' * len(head)]
    for r in rows:
        lead = r['lead']
        vals = {rar: clean(txt) for rar, txt in grade_spans(r['val'])}
        out.append('| ' + ' | '.join([md_cell(x) for x in lead] + [vals.get(x, '—') for x in RARITIES]) + ' |')
    return out


lines.append(f'## Common blessings ({len(common[1])})\n\nAvailable to every hero.\n')
lines += range_table([{'lead': [clean(r['cells'][0])], 'val': r['cells'][1]} for r in common[1]], ['Blessing'])
lines.append(f'\n## Class blessings ({len(klass[1])})\n\nOne value range shared by all of them. No limit on how many of each.\n')
lines += range_table([{'lead': [clean(r['cells'][0]), clean(r['cells'][1])], 'val': r['cells'][2]} for r in klass[1]],
                     ['Class', 'Blessing'])
lines.append('\n## Unique (hero-exclusive) blessings\n\nOnly one of each per hero. Fixed value per rarity. '
             'A blessing named after a skill buffs that skill [LATER]; the others are plain bonuses.\n')
head = ['Hero', 'Blessing', 'Effect'] + [x.title() for x in ['epic', 'legendary', 'mythic']]
lines.append('| ' + ' | '.join(head) + ' |')
lines.append('|' + '---|' * len(head))
for r in unique[1]:
    c = r['cells']
    hero = clean(c[0])
    bname = clean(c[1]) or '(hero bonus)'
    spans = grade_spans(c[2])
    vals = {rar: clean(txt) for rar, txt in spans}
    effect = clean(re.sub(r'<span class="grade-[\w-]+">.*?</span>', '…', c[2], flags=re.S))
    effect = re.sub(r'(…\s*/?\s*)+', '…', effect).strip()
    extra = [rar for rar in vals if rar not in ('epic', 'legendary', 'mythic')]
    if extra:
        flag("Dragon's Blessing", 'unique blessing rarity outside Epic–Mythic', f'{hero} / {bname}: {extra}')
    lines.append('| ' + ' | '.join(md_cell(x) for x in [hero, bname, effect] + [vals.get(x, '—') for x in ['epic', 'legendary', 'mythic']]) + ' |')
lines.append('\n`…` in the effect marks where the per-rarity value goes.\n')
open(os.path.join(OUT, 'blessings.md'), 'w').write('\n'.join(lines))

# ------------------------------------------------------------------ pets.md
pt = tables(read('Pets'))
pets = pt[3]
lines = [header('Pets', ['Pets'],
                '- Up to **3 pets** equipped. Each active skill costs 1–3 activation points; each hero has **5 points** per run.\n'
                '- Stars **0–6**. Extra effects unlock at the star counts shown (★ = 1 star).\n'
                '- Pet levels and ownership effects only raise HP/ATK and are already in Stat Details, so they’re ignored.\n'
                '- Many skills only affect the shop or merging (economy, [LATER]). Pets that put items in the bag or act in battle matter for the MVP.\n\n')]
PET_KIND = {
    'bag': ['Venomous Spider', 'Butterfly'],
    'economy': ['Geezer', 'Mimic', 'Goblin Scientist', 'Mini Mimic'],
}


def pet_kind(name):
    for k, v in PET_KIND.items():
        if name in v:
            return k
    return 'battle'


lines.append('## Summary\n')
lines.append('| Pet | Rarity | Cost | Type |\n|---|---|---|---|')
for r in pets[1]:
    c = r['cells']
    nm = clean(c[1])
    lines.append(f'| {nm} | {(rarity_of(c[1]) or "?").title()} | {c[2].count("Icon-Activation Cost")} | '
                 + {'bag': 'Puts items in the bag (MVP)', 'economy': 'Shop/merge only [LATER]', 'battle': 'Battle effect (MVP)'}[pet_kind(nm)] + ' |')
lines.append('')
lines.append(f'## Pets ({len(pets[1])})\n')
for r in pets[1]:
    c = r['cells']
    name = clean(c[1])
    note_icons('Pets', name, ''.join(c))
    cost = c[2].count('Icon-Activation Cost')
    star_lines = []
    for ln in re.split(r'<br\s*/?>', c[6]):
        n = ln.count('Star-tier.png')
        t = clean(re.sub(r'\[\[File:Star-tier\.png[^\]]*\]\]', '', ln))
        if t:
            star_lines.append((n, t))
    spawns = re.findall(r'summons? (\d+) ([A-Z][\w\' ]+?)(?:s)? into', clean(c[4]), flags=re.I)
    if re.search(r'_x_', clean(c[4])):
        flag('Pets', 'placeholder value in skill text', f'{name}: {clean(c[4])}')
    lines.append(f'### {name}\n')
    lines.append(f'- **Rarity:** {(rarity_of(c[1]) or "?").title()} · **Activation cost:** {cost}')
    lines.append(f'- **Active skill — {clean(c[3])}:** {clean(c[4], keep_lines=True)}')
    lines.append('- **Star effects:**' if star_lines else '- **Star effects:** —')
    for n, t in star_lines:
        lines.append(f'  - {n}★: {t}')
    lines.append('')
    if not cost:
        flag('Pets', 'no activation cost icons', name)
open(os.path.join(OUT, 'pets.md'), 'w').write('\n'.join(lines))

# ------------------------------------------------------------------ statuses.md
st_text = read('Stats_and_Effects')
st = tables(st_text)
sections = re.findall(r'\n== ([^=\n]+) ==', st_text)
OVERRIDES = {
    'Spike': 'Simulator uses **0.1x ATK** per stack (wiki says 0.01x — typo; observed 61.1K at 610.9K ATK).',
    'Burn': 'Simulator uses **0.1x ATK** of the inflicter per stack (wiki says 0.01x — typo).',
    'Poison': 'Simulator uses **0.1x ATK** of the inflicter per stack (wiki says 0.01x — typo).',
    'Vamp': 'Simulator uses **0.005x HP** per stack (observed 20.0K at 4M HP). Wiki\'s 0.01x is wrong.',
    'Regen': 'Simulator uses **0.005x HP** per stack (observed: 6 stacks healed 7.24M on 241.6M HP). Wiki\'s 0.01x is wrong.',
}
lines = [header('Stats, statuses and effects', ['Stats_and_Effects'],
                'Where my in-game observations disagree with the wiki, the **Simulator** note wins.\n\n'
                '**General rules (mine, not on the wiki):** stacks last the whole battle unless applied with a duration; '
                'a chance (e.g. 50%) is rolled once for all stacks; Poison and Regen tick on a global 2 s timer from battle start; '
                'all damage hits Block before HP (except Rose’s *Impale*).\n\n')]
for title, (hdr, rows) in zip([s for s in sections if s not in ('Overview', 'Enemy Traits', 'Notes', 'See also')], st[:8]):
    lines.append(f'## {title}\n')
    lines.append('| Name | Description | Simulator |\n|---|---|---|')
    for r in rows:
        nm = clean(r['cells'][1])
        lines.append(f'| {md_cell(nm)} | {md_cell(clean(r["cells"][2], keep_lines=True))} | {OVERRIDES.get(nm, "")} |')
    lines.append('')
lines.append('## Berserk (from my observations; not on the wiki)\n')
lines.append('- Starts when the battle timer reaches **10.00 s**.\n- **Who:** only the enemy in chapter modes (Stage, Gauntlet, Boss Rush); both sides in PvP.\n- Stack 1: **+25% DMG, +25% Item Haste, +0% Accuracy**.\n- **+1 stack every 1 s**; each stack adds **+5** to each of those (stack 2: +30% / +30% / +5%).\n- The DMG bonus adds to All DMG Increase.\n- Enemies with the trait **Short Time Limit** never go berserk.\n')
hdr, rows = st[8]
lines.append(f'## Enemy traits ({len(rows)})  — [LATER]\n')
lines.append('Descriptions only. A trait with several variants lists them separated by “ / or: ”.\n')
cat = None
for r in rows:
    if r['category'] != cat:
        cat = r['category']
        lines.append(f'\n### {cat}\n\n| Trait | Description |\n|---|---|')
    desc = clean(r['cells'][2], keep_lines=True).replace('\n---\n', ' / or: ')
    lines.append(f'| {md_cell(clean(r["cells"][1]))} | {md_cell(desc)} |')
lines.append('')
open(os.path.join(OUT, 'statuses.md'), 'w').write('\n'.join(lines))

# ------------------------------------------------------------------ heroes.md
lines = [header('Heroes', ['Heroes'] + [h.replace('_', ' ') for h in HERO_ORDER],
                '- Classes: Warrior, Ranger, Wizard. Stars **0–9**.\n'
                '- **Supply Ability** (starting-equipment capacity) = base (Rare 5, Epic 8, Legendary 10) + 1 per star.\n'
                '- **Supplies** unlock at the stars shown. Once unlocked, a supply can be brought by any hero of the same class.\n'
                '- **Skill links:** this hero’s skills become linkable by same-class heroes at 4★ and 8★, in the order shown. '
                'The hero’s own link slots also open at 4★ and 8★.\n'
                '- **Hero-exclusive items:** usable as supplies by any same-class hero; can’t be merged; only in shops for their own hero.\n'
                '- Ownership effects and skins are ignored. 23 heroes here; the wiki’s “26” includes 2 skins and 1 unknown.\n\n')]
for cls in ['Warrior', 'Ranger', 'Wizard']:
    group = [h for h in HEROES if h['class'] == cls]
    lines.append(f'## {cls} ({len(group)})\n')
    for h in sorted(group, key=lambda x: ['legendary', 'epic', 'rare'].index(x['rarity'] or 'rare')):
        lines.append(f'### {h["name"]}\n')
        lines.append(f'- **Rarity:** {(h["rarity"] or "?").title()} · **Base Supply Ability:** {h["supply_ability"]}')
        lines.append('- **Skills** [LATER effects]:')
        for n, d in h['skills']:
            lines.append(f'  - **{n}:** {d.replace(chr(10), " ")}')
        lines.append(f'- **Skill links:** 4★ → {h["links"].get(4, "?")}, 8★ → {h["links"].get(8, "?")}')
        if h['exclusive']:
            lines.append('- **Exclusive items:**')
            for e in h['exclusive']:
                lines.append(f'  - {e["item"]} — ' + (f'merge: {e["recipe"]}' if e['recipe'] else e['how']))
        lines.append('- **Supplies:** ' + ', '.join(f'{s}★ {n}' for s, n in h['supplies']))
        if h['skins']:
            lines.append(f'- _Skins (ignored): {", ".join(h["skins"])}_')
        lines.append('')
open(os.path.join(OUT, 'heroes.md'), 'w').write('\n'.join(lines))

json.dump({'flags': FLAGS, 'unmirrored': UNMIRRORED}, open(os.path.join(OUT, 'flags.json'), 'w'), indent=1, ensure_ascii=False)
print(f'items {len(ITEMS)}, heroes {len(HEROES)}, flags {len(FLAGS)}')
