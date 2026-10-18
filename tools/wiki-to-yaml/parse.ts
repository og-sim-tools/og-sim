/**
 * Parsers for the docs/wiki-data markdown → wiki YAML entries (SPEC §9 phase 2).
 *
 * Names, numbers and footprints are copied exactly. Nothing is corrected here: fixes from
 * corrections.md go into data/<category>/manual/. Anything odd is returned as a flag so the
 * converter can report it. Structural surprises (unexpected columns, unparseable stats) throw.
 */
import { slugify } from '../../src/engine/model/common';

export const WIKI = 'https://overgearedhero.fandom.com/wiki/';
/** Ids for wiki misspellings the user confirmed (the wiki name is kept; data/<category>/manual/ fixes it). */
export const ID_FIXES: Record<string, string> = { racoon: 'raccoon' };
const idOf = (name: string) => ID_FIXES[slugify(name)] ?? slugify(name);
export const pageUrl = (page: string) => WIKI + page.replace(/ /g, '_');

export interface Flag {
  file: string;
  entry: string;
  message: string;
}

export class ParseError extends Error {}

type Entry = Record<string, unknown>;

const provenance = (url: string) => ({ source: 'wiki', url, verified: false });

/** Split a markdown table row into trimmed cells. */
export function splitRow(line: string): string[] {
  const t = line.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) throw new ParseError(`Not a table row: ${line}`);
  return t.slice(1, -1).split('|').map((c) => c.trim());
}

const isSeparator = (line: string) => /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim());

/** Table rows (excluding header and separator) of every table in `lines`, with the header. */
function tables(lines: string[]): { header: string[]; rows: string[][]; firstLine: number }[] {
  const out: { header: string[]; rows: string[][]; firstLine: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim().startsWith('|') && i + 1 < lines.length && isSeparator(lines[i + 1]!)) {
      const header = splitRow(lines[i]!);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && lines[j]!.trim().startsWith('|'); j++) {
        const cells = splitRow(lines[j]!);
        if (cells.length !== header.length) {
          throw new ParseError(`Row has ${cells.length} cells, header has ${header.length}: ${lines[j]}`);
        }
        rows.push(cells);
      }
      out.push({ header, rows, firstLine: i + 1 });
      i = j - 1;
    }
  }
  return out;
}

/** Split a document into `## ` sections. */
function sections(text: string, level: '##' | '###'): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(level + ' ')) {
      cur = { title: line.slice(level.length + 1).trim(), lines: [] };
      out.push(cur);
    } else if (level === '###' && line.startsWith('## ')) {
      cur = null;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  return out;
}

const brToNewline = (s: string) => s.replace(/<br\s*\/?>/g, '\n');

function expectHeader(header: string[], want: string[], where: string) {
  if (header.join('|') !== want.join('|')) {
    throw new ParseError(`${where}: unexpected table header "${header.join(' | ')}", expected "${want.join(' | ')}".`);
  }
}

/** Strip the ❓ marker (a name the wiki references that matches no item); report it. */
function unknownMarker(name: string, flag: (m: string) => void): string {
  if (name.startsWith('❓')) {
    const clean = name.slice(1).trim();
    flag(`references "${clean}", which the wiki doesn't list as an item (❓)`);
    return clean;
  }
  return name;
}

// ------------------------------------------------------------------ items

export function parseItemStats(cell: string, where: string): Entry {
  const stats: Entry = {};
  if (cell === '') return stats;
  for (const part of cell.split(/<br\s*\/?>/)) {
    const p = part.trim();
    let m: RegExpExecArray | null;
    if ((m = /^DMG ([\d.]+)x ATK$/.exec(p))) stats.damage = { ratio: Number(m[1]), scales_with: 'atk' };
    else if ((m = /^Cooldown ([\d.]+)s$/.exec(p))) stats.cooldown = Number(m[1]);
    else if ((m = /^Accuracy ([\d.]+)%$/.exec(p))) stats.accuracy = Number(m[1]);
    else throw new ParseError(`${where}: can't read stat "${p}".`);
  }
  return stats;
}

export function parseItemValue(cell: string, where: string): { value: number; value_unknown: boolean } {
  if (/^\d+$/.test(cell)) return { value: Number(cell), value_unknown: false };
  if (/^0 \(wiki: \?\)$/.test(cell)) return { value: 0, value_unknown: true };
  throw new ParseError(`${where}: can't read value "${cell}".`);
}

export function parseNameList(cell: string, flag: (m: string) => void): string[] {
  if (cell === '—' || cell === '') return [];
  return cell.split(',').map((n) => slugify(unknownMarker(n.trim(), flag)));
}

const ITEM_HEADER = ['Item', 'Rarity', 'Tags', 'Stats', 'Effect', 'Footprint', 'Value', 'Merges into', 'Made from'];
const PET_ITEM_HEADER = ['Item', 'Rarity', 'Tags', 'Stats', 'Effect', 'Footprint', 'Value'];

export interface ItemsResult {
  /** File key (universal, warrior, ranger, wizard, pet_spawn) → entries. */
  files: Record<string, Entry[]>;
  flags: Flag[];
}

export function parseItems(text: string): ItemsResult {
  const FILE = 'items.md';
  const url = pageUrl('Items');
  const files: Record<string, Entry[]> = {};
  const flags: Flag[] = [];
  for (const sec of sections(text, '##')) {
    const m = /^(Universal|Warrior|Ranger|Wizard|Pet-spawned) items \((\d+)\)$/.exec(sec.title);
    if (!m) continue;
    const key = m[1] === 'Pet-spawned' ? 'pet_spawn' : m[1]!.toLowerCase();
    const isPet = key === 'pet_spawn';
    const classes = key === 'universal' || isPet ? [] : [key];
    const tbls = tables(sec.lines);
    if (tbls.length !== 1) throw new ParseError(`${FILE} ${sec.title}: expected one table, found ${tbls.length}.`);
    const { header, rows } = tbls[0]!;
    expectHeader(header, isPet ? PET_ITEM_HEADER : ITEM_HEADER, `${FILE} ${sec.title}`);
    if (rows.length !== Number(m[2])) {
      flags.push({ file: FILE, entry: sec.title, message: `heading says ${m[2]} items, table has ${rows.length}` });
    }
    files[key] = rows.map((c) => {
      const [nameCell, rarity, tags, stats, effect, footprint, value, mergesInto, madeFrom] = c as [string, ...string[]];
      const nm = /^(.*?)\s*(?:🔒(.+))?$/.exec(nameCell)!;
      const name = nm[1]!.trim();
      const flag = (message: string) => flags.push({ file: FILE, entry: name, message });
      const where = `${FILE} ${name}`;

      let effectText = brToNewline(effect!);
      let temporary = false;
      if (/\n?_Disappears after battle\._$/.test(effectText)) {
        temporary = true;
        effectText = effectText.replace(/\n?_Disappears after battle\._$/, '');
      }
      let flavor: string | undefined;
      const fm = /^_([^_].*)_$/s.exec(effectText);
      if (fm && !effectText.slice(1, -1).includes('_')) {
        flavor = fm[1]!;
        effectText = '';
      }
      const fp = /^`(.+)`$/.exec(footprint!);
      if (!fp) throw new ParseError(`${where}: footprint "${footprint}" isn't in backticks.`);

      const entry: Entry = {
        id: slugify(name),
        name,
        kind: isPet ? 'pet_spawn' : 'item',
        rarity: rarity!.toLowerCase(),
        tags: tags!.split(',').map((t) => slugify(t.trim())).filter(Boolean),
        class_restriction: classes,
      };
      if (nm[2]) entry.hero_exclusive = slugify(nm[2].trim());
      entry.footprint = fp[1];
      const st = parseItemStats(stats!, where);
      if (Object.keys(st).length > 0) entry.stats = st;
      entry.effect_text = effectText;
      if (flavor !== undefined) entry.flavor = flavor;
      Object.assign(entry, parseItemValue(value!, where));
      if (!isPet) {
        entry.merges_into = parseNameList(mergesInto!, flag);
        entry.components = parseNameList(madeFrom!, flag);
      }
      if (temporary) entry.temporary = true;
      Object.assign(entry, provenance(url));
      return entry;
    });
  }
  return { files, flags };
}

// ------------------------------------------------------------------ gear + auras

export interface GearResult {
  gear: Entry[];
  auras: Entry[];
  flags: Flag[];
}

const SLOT_SECTIONS: Record<string, string> = { Weapons: 'weapon', Shields: 'shield', Rings: 'ring', Gloves: 'glove' };

export function parseGear(text: string): GearResult {
  const FILE = 'gear.md';
  const url = pageUrl('Gear');
  const gear: Entry[] = [];
  const auras: Entry[] = [];
  const flags: Flag[] = [];
  for (const sec of sections(text, '##')) {
    const sm = /^(Weapons|Shields|Rings|Gloves) \((\d+)\)$/.exec(sec.title);
    if (sm) {
      const slot = SLOT_SECTIONS[sm[1]!]!;
      const pieces = sections(['## x', ...sec.lines].join('\n'), '###');
      if (pieces.length !== Number(sm[2])) {
        flags.push({ file: FILE, entry: sec.title, message: `heading says ${sm[2]}, found ${pieces.length}` });
      }
      for (const p of pieces) gear.push(parseGearPiece(p.title, p.lines, slot, url));
      continue;
    }
    if (/^Auras \(\d+\)/.test(sec.title)) {
      const t = tables(sec.lines);
      expectHeader(t[0]!.header, ['Aura', 'Rarity', 'Aura skill', 'Skill effect'], `${FILE} Auras`);
      for (const [name, rarity, skill, effect] of t[0]!.rows as [string, string, string, string][]) {
        auras.push({ id: slugify(name), name, rarity: rarity.toLowerCase(), skill_name: skill, skill_text: brToNewline(effect), ...provenance(url) });
      }
    }
  }
  return { gear, auras, flags };
}

function parseGearPiece(title: string, lines: string[], slot: string, url: string): Entry {
  const sRank = title.endsWith('⭐S');
  const name = title.replace(/\s*⭐S$/, '').trim();
  const where = `gear.md ${name}`;
  const field = (label: string) => {
    const l = lines.find((x) => x.startsWith(`- **${label}:**`));
    return l === undefined ? undefined : l.slice(`- **${label}:**`.length).trim();
  };
  const slotText = field('Slot');
  if (slotText?.toLowerCase() !== slot) throw new ParseError(`${where}: slot "${slotText}" doesn't match section (${slot}).`);

  const entry: Entry = { id: slugify(name), name, slot };
  if (sRank) entry.s_rank = true;
  const bonus = field('Bonus stat');
  if (bonus) entry.bonus_stat = bonus.replace(/\s*_\(stat only\)_$/, '');
  const skill = field('Skill');
  if (skill) {
    const trig = /_(Activates[^_]*?)\.?_\s*$/.exec(skill);
    entry.skill = trig ? { text: skill, trigger_text: trig[1] } : { text: skill };
  }
  const eff = field('Gear effect');
  entry.gear_effect_text = eff === undefined || eff === '—' ? '' : eff;

  const start = lines.findIndex((l) => l.startsWith('- **Effects by rarity:**'));
  const rarityEffects: Entry[] = [];
  if (start !== -1) {
    for (let i = start + 1; i < lines.length && lines[i]!.startsWith('  - '); i++) {
      const m = /^ {2}- (Common|Uncommon|Rare|Epic|Legendary|Mythic): (.*)$/.exec(lines[i]!);
      if (!m) throw new ParseError(`${where}: can't read rarity effect "${lines[i]}".`);
      const statOnly = /\s*_\(stat only\)_$/.test(m[2]!);
      const e: Entry = { rarity: m[1]!.toLowerCase(), text: m[2]!.replace(/\s*_\(stat only\)_$/, '') };
      if (statOnly) e.stat_only = true;
      rarityEffects.push(e);
    }
  }
  entry.rarity_effects = rarityEffects;
  Object.assign(entry, provenance(url));
  return entry;
}

// ------------------------------------------------------------------ heroes

export interface HeroesResult {
  files: Record<string, Entry[]>;
  flags: Flag[];
}

export function parseHeroes(text: string): HeroesResult {
  const FILE = 'heroes.md';
  const files: Record<string, Entry[]> = {};
  const flags: Flag[] = [];
  for (const sec of sections(text, '##')) {
    const cm = /^(Warrior|Ranger|Wizard) \((\d+)\)$/.exec(sec.title);
    if (!cm) continue;
    const cls = cm[1]!.toLowerCase();
    const heroes = sections(['## x', ...sec.lines].join('\n'), '###');
    if (heroes.length !== Number(cm[2])) flags.push({ file: FILE, entry: sec.title, message: `heading says ${cm[2]}, found ${heroes.length}` });
    files[cls] = heroes.map(({ title: name, lines }) => {
      const flag = (message: string) => flags.push({ file: FILE, entry: name, message });
      const where = `${FILE} ${name}`;
      const rl = lines.find((l) => l.startsWith('- **Rarity:**'));
      const rm = rl && /^- \*\*Rarity:\*\* (\w+) · \*\*Base Supply Ability:\*\* (\d+)$/.exec(rl);
      if (!rm) throw new ParseError(`${where}: can't read rarity line.`);

      const skills: Entry[] = [];
      const exclusive: Entry[] = [];
      let mode: 'skills' | 'exclusive' | null = null;
      let links: Entry[] = [];
      let supplies: Entry[] = [];
      let skins: string[] = [];
      for (const l of lines) {
        if (l.startsWith('- **Skills**')) mode = 'skills';
        else if (l.startsWith('- **Exclusive items:**')) mode = 'exclusive';
        else if (l.startsWith('- ')) {
          mode = null;
          const lm = /^- \*\*Skill links:\*\* (.*)$/.exec(l);
          if (lm) {
            links = lm[1]!.split(/,\s*(?=\d★)/).map((s) => {
              const m = /^(\d)★ → (.+)$/.exec(s.trim());
              if (!m) throw new ParseError(`${where}: can't read skill link "${s}".`);
              return { stars: Number(m[1]), skill: slugify(m[2]!), _name: m[2]! };
            });
          }
          const sm = /^- \*\*Supplies:\*\* (.*)$/.exec(l);
          if (sm) {
            supplies = sm[1]!.split(/,\s*(?=\d★)/).map((s) => {
              const m = /^(\d)★ (.+)$/.exec(s.trim());
              if (!m) throw new ParseError(`${where}: can't read supply "${s}".`);
              return { stars: Number(m[1]), item: slugify(unknownMarker(m[2]!.trim(), flag)) };
            });
          }
          const km = /^- _Skins \(ignored\): (.*)_$/.exec(l);
          if (km) skins = km[1]!.split(',').map((s) => s.trim());
        } else if (mode === 'skills' && l.startsWith('  - ')) {
          const m = /^ {2}- \*\*(.+?):\*\*\s*(.*)$/.exec(l);
          if (!m) throw new ParseError(`${where}: can't read skill "${l}".`);
          skills.push({ id: slugify(m[1]!), name: m[1]!, text: m[2]! });
        } else if (mode === 'exclusive' && l.startsWith('  - ')) {
          const m = /^ {2}- (.+?) — (.*)$/.exec(l);
          if (!m) throw new ParseError(`${where}: can't read exclusive item "${l}".`);
          exclusive.push({ item: slugify(unknownMarker(m[1]!.trim(), flag)), note: m[2]! });
        }
      }
      for (const link of links) {
        const exact = skills.find((s) => s.name === link._name);
        if (!exact) {
          const near = skills.find((s) => s.id === link.skill);
          flag(
            near
              ? `skill link "${link._name}" doesn't exactly match the skill name "${near.name}" (same id ${link.skill})`
              : `skill link "${link._name}" matches none of the hero's skills`,
          );
        }
        delete link._name;
      }
      const entry: Entry = {
        id: slugify(name),
        name,
        class: cls,
        rarity: rm[1]!.toLowerCase(),
        base_supply_ability: Number(rm[2]),
        skills,
        skill_links: links,
        exclusive_items: exclusive,
        supplies,
      };
      if (skins.length > 0) entry.skins = skins;
      Object.assign(entry, provenance(pageUrl(name)));
      return entry;
    });
  }
  return { files, flags };
}

// ------------------------------------------------------------------ blessings

export interface BlessingRange {
  min?: number;
  max?: number;
  value?: number;
  unit: 'pct' | 'seconds' | 'flat';
}

const UNIT: Record<string, BlessingRange['unit']> = { '%': 'pct', s: 'seconds', '': 'flat' };

/** "+1 ~ 2%" → {min 1, max 2}; "+25% ~ 30%" → {25, 30}; "+10%" → {value 10}; "-2" → {value -2}; "—" → null. */
export function parseBlessingValue(cell: string): BlessingRange | null {
  const c = cell.trim();
  if (c === '—' || c === '') return null;
  let m = /^([+-]?[\d.]+)(%|s)?\s*~\s*([+-]?[\d.]+)(%|s)?$/.exec(c);
  if (m) {
    const unit = m[4] ?? m[2] ?? '';
    return { min: Number(m[1]), max: Number(m[3]), unit: UNIT[unit]! };
  }
  m = /^([+-]?[\d.]+)(%|s)?$/.exec(c);
  if (m) return { value: Number(m[1]), unit: UNIT[m[2] ?? '']! };
  throw new ParseError(`Can't read blessing value "${cell}".`);
}

const RARITY_COLS = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

export interface BlessingsResult {
  files: Record<string, Entry[]>;
  slotsByLevel: Record<string, number>;
  flags: Flag[];
}

/** Bracketed tag names in an effect: "[Rock] & [Trap] Weapon DMG" → rock, trap. */
export const bracketTags = (s: string) => [...s.matchAll(/\[([^\]]+)\]/g)].map((m) => slugify(m[1]!));

export function parseBlessings(text: string, heroSkills: Map<string, string[]>): BlessingsResult {
  const FILE = 'blessings.md';
  const url = pageUrl("Dragon's Blessing");
  const files: Record<string, Entry[]> = { common: [], class: [], unique: [] };
  const flags: Flag[] = [];
  const slotsByLevel: Record<string, number> = {};

  const valuesOf = (cells: string[], cols: string[], name: string) => {
    const values: Record<string, unknown> = {};
    const units = new Set<string>();
    cells.forEach((cell, i) => {
      let v: BlessingRange | null;
      try {
        v = parseBlessingValue(cell);
      } catch (e) {
        throw new ParseError(`${FILE} ${name}: ${(e as Error).message}`);
      }
      if (!v) return;
      units.add(v.unit);
      const { unit: _u, ...rest } = v;
      values[cols[i]!.toLowerCase()] = rest;
    });
    if (units.size > 1) flags.push({ file: FILE, entry: name, message: `mixed units across rarities: ${[...units].join(', ')}` });
    return { values, unit: [...units][0] ?? 'flat' };
  };

  for (const sec of sections(text, '##')) {
    const t = tables(sec.lines);
    if (sec.title.startsWith('Slots by')) {
      expectHeader(t[0]!.header, ['Level', 'Slots'], `${FILE} slots`);
      for (const [lvl, slots] of t[0]!.rows as [string, string][]) slotsByLevel[lvl] = Number(slots);
    } else if (sec.title.startsWith('Common blessings')) {
      expectHeader(t[0]!.header, ['Blessing', ...RARITY_COLS], `${FILE} common`);
      for (const [name, ...cells] of t[0]!.rows as [string, ...string[]][]) {
        const { values, unit } = valuesOf(cells, RARITY_COLS, name);
        files.common!.push({
          id: slugify(name),
          name,
          kind: 'common',
          effect_text: name,
          ...(bracketTags(name).length ? { target_tags: bracketTags(name) } : {}),
          unit,
          values,
          ...provenance(url),
        });
      }
    } else if (sec.title.startsWith('Class blessings')) {
      expectHeader(t[0]!.header, ['Class', 'Blessing', ...RARITY_COLS], `${FILE} class`);
      for (const [cls, name, ...cells] of t[0]!.rows as [string, string, ...string[]][]) {
        const { values, unit } = valuesOf(cells, RARITY_COLS, name);
        files.class!.push({
          id: slugify(name),
          name,
          kind: 'class',
          class: cls.toLowerCase(),
          effect_text: name,
          target_tags: bracketTags(name),
          unit,
          values,
          ...provenance(url),
        });
      }
    } else if (sec.title.startsWith('Unique')) {
      expectHeader(t[0]!.header, ['Hero', 'Blessing', 'Effect', 'Epic', 'Legendary', 'Mythic'], `${FILE} unique`);
      for (const [heroName, bname, effect, ...cells] of t[0]!.rows as [string, string, string, ...string[]][]) {
        const hero = slugify(heroName);
        const unnamed = bname === '(hero bonus)';
        const label = unnamed ? effect.replace(/…/g, ' ').replace(/\s+/g, ' ').trim() : bname;
        const id = `${hero}_${slugify(label)}`;
        const { values, unit } = valuesOf(cells, ['Epic', 'Legendary', 'Mythic'], `${heroName} / ${bname}`);
        const entry: Entry = { id, name: unnamed ? label : bname, kind: 'unique', hero };
        if (unnamed) flags.push({ file: FILE, entry: `${heroName} ${label}`, message: `unnamed on the wiki ("(hero bonus)"); id "${id}" made from the effect` });
        if (!unnamed) {
          const skills = heroSkills.get(hero) ?? [];
          if (skills.includes(slugify(bname))) entry.buffs_skill = slugify(bname);
          else flags.push({ file: FILE, entry: `${heroName} ${bname}`, message: `named like a skill but ${heroName} has no skill "${bname}" (skills: ${skills.join(', ') || 'none'})` });
        }
        entry.effect_text = effect;
        if (bracketTags(effect).length) entry.target_tags = bracketTags(effect);
        entry.unit = unit;
        entry.values = values;
        Object.assign(entry, provenance(url));
        files.unique!.push(entry);
      }
    }
  }
  return { files, slotsByLevel, flags };
}

// ------------------------------------------------------------------ pets

const ROLE: Record<string, string> = {
  'Puts items in the bag (MVP)': 'bag_items',
  'Battle effect (MVP)': 'battle',
  'Shop/merge only [LATER]': 'economy',
};

export function parsePets(text: string): { pets: Entry[]; flags: Flag[] } {
  const FILE = 'pets.md';
  const url = pageUrl('Pets');
  const flags: Flag[] = [];
  const summary = new Map<string, { rarity: string; cost: number; role: string }>();
  const pets: Entry[] = [];
  for (const sec of sections(text, '##')) {
    if (sec.title === 'Summary') {
      const t = tables(sec.lines)[0]!;
      expectHeader(t.header, ['Pet', 'Rarity', 'Cost', 'Type'], `${FILE} summary`);
      for (const [name, rarity, cost, type] of t.rows as [string, string, string, string][]) {
        const role = ROLE[type];
        if (!role) throw new ParseError(`${FILE} ${name}: unknown type "${type}".`);
        summary.set(name, { rarity: rarity.toLowerCase(), cost: Number(cost), role });
      }
    }
    const pm = /^Pets \((\d+)\)$/.exec(sec.title);
    if (!pm) continue;
    const list = sections(['## x', ...sec.lines].join('\n'), '###');
    if (list.length !== Number(pm[1])) flags.push({ file: FILE, entry: sec.title, message: `heading says ${pm[1]}, found ${list.length}` });
    for (const { title: name, lines } of list) {
      const where = `${FILE} ${name}`;
      const rl = lines.find((l) => l.startsWith('- **Rarity:**'));
      const rm = rl && /^- \*\*Rarity:\*\* (\w+) · \*\*Activation cost:\*\* (\d)$/.exec(rl);
      if (!rm) throw new ParseError(`${where}: can't read rarity line.`);
      const sl = lines.find((l) => l.startsWith('- **Active skill — '));
      const sm = sl && /^- \*\*Active skill — (.+?):\*\*\s*(.*)$/.exec(sl);
      if (!sm) throw new ParseError(`${where}: can't read active skill.`);
      const stars: Entry[] = [];
      for (const l of lines) {
        const m = /^ {2}- (\d)★: (.*)$/.exec(l);
        if (!m) continue;
        const star: Entry = { stars: Number(m[1]), text: m[2]! };
        const cm = /Activation [Cc]ost is decreased by (\d+)/.exec(m[2]!);
        if (cm) star.activation_cost_delta = -Number(cm[1]);
        stars.push(star);
      }
      const s = summary.get(name);
      if (!s) throw new ParseError(`${where}: missing from the summary table.`);
      if (s.rarity !== rm[1]!.toLowerCase() || s.cost !== Number(rm[2])) {
        flags.push({ file: FILE, entry: name, message: `summary table (${s.rarity}, cost ${s.cost}) disagrees with the pet section (${rm[1]}, cost ${rm[2]})` });
      }
      pets.push({
        id: idOf(name),
        name,
        rarity: rm[1]!.toLowerCase(),
        activation_cost: Number(rm[2]),
        skill: { name: sm[1]!, text: sm[2]! },
        star_effects: stars,
        role: s.role,
        ...provenance(url),
      });
    }
  }
  return { pets, flags };
}

// ------------------------------------------------------------------ statuses + enemy traits

/** Numeric parameters stated in a wiki status description. */
export function statusParams(desc: string): Entry {
  const out: Entry = {};
  let m: RegExpExecArray | null;
  if ((m = /(\d+(?:\.\d+)?)% chance/.exec(desc))) out.chance_pct = Number(m[1]);
  if ((m = /([\d.]+)x (ATK|HP)/.exec(desc))) out.amount_per_stack = { ratio: Number(m[1]), scales_with: m[2]!.toLowerCase() };
  if ((m = /[Ee]very (\d+(?:\.\d+)?)s/.exec(desc))) out.interval_s = Number(m[1]);
  if ((m = /(\d+(?:\.\d+)?)% (?:\w+ )?per \w+ stack/.exec(desc))) out.pct_per_stack = Number(m[1]);
  return out;
}

export function parseStatuses(text: string): { statuses: Entry[]; traits: Entry[]; flags: Flag[] } {
  const FILE = 'statuses.md';
  const url = pageUrl('Stats and Effects');
  const statuses: Entry[] = [];
  const traits: Entry[] = [];
  const flags: Flag[] = [];
  let traitsSeen = false;
  for (const sec of sections(text, '##')) {
    if (sec.title === 'Buffs' || sec.title === 'Debuffs') {
      const t = tables(sec.lines)[0]!;
      expectHeader(t.header, ['Name', 'Description', 'Simulator'], `${FILE} ${sec.title}`);
      for (const [name, desc] of t.rows as [string, string, string][]) {
        const description = brToNewline(desc);
        statuses.push({
          id: slugify(name),
          name,
          polarity: sec.title === 'Buffs' ? 'buff' : 'debuff',
          description,
          ...statusParams(description),
          ...provenance(url),
        });
      }
    }
    const tm = /^Enemy traits \((\d+)\)/.exec(sec.title);
    if (tm) {
      traitsSeen = true;
      for (const group of sections(['## x', ...sec.lines].join('\n'), '###')) {
        const t = tables(group.lines)[0]!;
        expectHeader(t.header, ['Trait', 'Description'], `${FILE} ${group.title}`);
        for (const [name, desc] of t.rows as [string, string][]) {
          traits.push({
            id: slugify(name),
            name,
            group: group.title,
            descriptions: brToNewline(desc).split(' / or: ').map((d) => d.trim()),
            ...provenance(url),
          });
        }
      }
      if (traits.length !== Number(tm[1])) {
        flags.push({ file: FILE, entry: 'Enemy traits', message: `heading says ${tm[1]}, found ${traits.length}` });
      }
    }
  }
  if (!traitsSeen) throw new ParseError(`${FILE}: no enemy traits section.`);
  return { statuses, traits, flags };
}
