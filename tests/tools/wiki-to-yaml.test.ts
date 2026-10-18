import { describe, expect, it } from 'vitest';
import {
  ParseError,
  bracketTags,
  parseBlessingValue,
  parseGear,
  parseHeroes,
  parseItemStats,
  parseItemValue,
  parseItems,
  parseNameList,
  statusParams,
} from '../../tools/wiki-to-yaml/parse';

describe('cell parsers', () => {
  it('reads item stats', () => {
    expect(parseItemStats('DMG 1.5x ATK<br>Cooldown 2.6s<br>Accuracy 80%', 'x')).toEqual({
      damage: { ratio: 1.5, scales_with: 'atk' },
      cooldown: 2.6,
      accuracy: 80,
    });
    expect(parseItemStats('DMG 1.0x ATK<br>Accuracy 85%', 'x')).toEqual({ damage: { ratio: 1, scales_with: 'atk' }, accuracy: 85 });
    expect(parseItemStats('', 'x')).toEqual({});
    expect(() => parseItemStats('DMG 1.5x HP', 'x')).toThrow(ParseError);
  });

  it('reads values, mapping the wiki "?" to 0', () => {
    expect(parseItemValue('5', 'x')).toEqual({ value: 5, value_unknown: false });
    expect(parseItemValue('0 (wiki: ?)', 'x')).toEqual({ value: 0, value_unknown: true });
    expect(() => parseItemValue('?', 'x')).toThrow(ParseError);
  });

  it('reads name lists and flags ❓ names without fixing them', () => {
    const flags: string[] = [];
    expect(parseNameList('Club, ❓Big Spike', (m) => flags.push(m))).toEqual(['club', 'big_spike']);
    expect(flags).toEqual(['references "Big Spike", which the wiki doesn\'t list as an item (❓)']);
    expect(parseNameList('—', () => {})).toEqual([]);
  });

  it('reads blessing values', () => {
    expect(parseBlessingValue('+1 ~ 2%')).toEqual({ min: 1, max: 2, unit: 'pct' });
    expect(parseBlessingValue('+25% ~ 30%')).toEqual({ min: 25, max: 30, unit: 'pct' });
    expect(parseBlessingValue('+10%')).toEqual({ value: 10, unit: 'pct' });
    expect(parseBlessingValue('-2')).toEqual({ value: -2, unit: 'flat' });
    expect(parseBlessingValue('-0.2s')).toEqual({ value: -0.2, unit: 'seconds' });
    expect(parseBlessingValue('0.6s')).toEqual({ value: 0.6, unit: 'seconds' }); // copied as written; fixed in manual/
    expect(parseBlessingValue('—')).toBeNull();
    expect(() => parseBlessingValue('lots')).toThrow(ParseError);
  });

  it('reads bracketed tags', () => {
    expect(bracketTags('[Rock] & [Trap] Weapon DMG')).toEqual(['rock', 'trap']);
  });

  it('reads status numbers from wiki descriptions as written', () => {
    expect(statusParams('On Hit, 50% chance to Heal 0.01x HP per Vamp stack.')).toEqual({
      chance_pct: 50,
      amount_per_stack: { ratio: 0.01, scales_with: 'hp' },
    });
    expect(statusParams('Take 0.01x ATK DMG every 2s per Poison stack.')).toEqual({
      amount_per_stack: { ratio: 0.01, scales_with: 'atk' },
      interval_s: 2,
    });
    expect(statusParams('Items activate 1% slower per Freeze stack.')).toEqual({ pct_per_stack: 1 });
    expect(statusParams('Dodge Rate increases by 1% per Dodge stack.')).toEqual({ pct_per_stack: 1 });
  });
});

describe('document parsers', () => {
  const ITEMS = `
## Warrior items (2)

| Item | Rarity | Tags | Stats | Effect | Footprint | Value | Merges into | Made from |
|---|---|---|---|---|---|---|---|---|
| Red Rose 🔒Rose | Epic | Tool |  | Start of Battle: Gain 2 Spike. | \`# / #\` | 0 (wiki: ?) | Red Rose Rapier | — |
| Club | Common | Weapon, Blunted | DMG 1.5x ATK<br>Cooldown 2s<br>Accuracy 80% | _"It's pretty worn out."_ | \`# / #\` | 5 | Axe | — |

## Pet-spawned items (1)

| Item | Rarity | Tags | Stats | Effect | Footprint | Value |
|---|---|---|---|---|---|---|
| Poison Bug | Uncommon | Creature |  | Every 6s: Inflict 1 Poison.<br>_Disappears after battle._ | \`#\` | 0 (wiki: ?) |
`;

  it('parses item tables: exclusives, flavour, temporary, class from the section', () => {
    const { files, flags } = parseItems(ITEMS);
    expect(flags).toEqual([]);
    const [rose, club] = files.warrior!;
    expect(rose).toMatchObject({ id: 'red_rose', hero_exclusive: 'rose', class_restriction: ['warrior'], value: 0, value_unknown: true, footprint: '# / #' });
    expect(club).toMatchObject({ effect_text: '', flavor: '"It\'s pretty worn out."', tags: ['weapon', 'blunted'] });
    expect(files.pet_spawn![0]).toMatchObject({ kind: 'pet_spawn', temporary: true, effect_text: 'Every 6s: Inflict 1 Poison.', class_restriction: [] });
    expect(rose).toMatchObject({ source: 'wiki', url: 'https://overgearedhero.fandom.com/wiki/Items', verified: false });
  });

  it('flags a heading count that disagrees with the table', () => {
    const { flags } = parseItems(ITEMS.replace('Warrior items (2)', 'Warrior items (3)'));
    expect(flags[0]!.message).toBe('heading says 3 items, table has 2');
  });

  it('fails loudly when the table layout changes', () => {
    expect(() => parseItems(ITEMS.replace('| Merges into | Made from |', '| Merges | Made from |'))).toThrow(/unexpected table header/);
  });

  it('parses gear pieces and stat-only rarity effects', () => {
    const { gear } = parseGear(`
## Rings (1)

### Gold Ring ⭐S

- **Slot:** Ring
- **Gear effect:** —
- **Effects by rarity:**
  - Rare: ATK +10% _(stat only)_
  - Epic: Increase ATK DMG by 150%.
`);
    expect(gear[0]).toMatchObject({
      id: 'gold_ring',
      slot: 'ring',
      s_rank: true,
      gear_effect_text: '',
      rarity_effects: [{ rarity: 'rare', text: 'ATK +10%', stat_only: true }, { rarity: 'epic', text: 'Increase ATK DMG by 150%.' }],
    });
  });

  it('parses heroes and flags link names that differ from skill names', () => {
    const { files, flags } = parseHeroes(`
## Warrior (1)

### Barbarian

- **Rarity:** Rare · **Base Supply Ability:** 5
- **Skills** [LATER effects]:
  - **Battle Cry:** On Attacked: gain Spike.
  - **That's Mine!:** Shop thing.
- **Skill links:** 4★ → That's Mine, 8★ → Battle Cry
- **Supplies:** 1★ Club, 3★ ❓Big Spike
`);
    expect(files.warrior![0]).toMatchObject({
      id: 'barbarian',
      class: 'warrior',
      base_supply_ability: 5,
      skill_links: [{ stars: 4, skill: 'thats_mine' }, { stars: 8, skill: 'battle_cry' }],
      supplies: [{ stars: 1, item: 'club' }, { stars: 3, item: 'big_spike' }],
      url: 'https://overgearedhero.fandom.com/wiki/Barbarian',
    });
    expect(flags.map((x) => x.message)).toEqual([
      'references "Big Spike", which the wiki doesn\'t list as an item (❓)',
      'skill link "That\'s Mine" doesn\'t exactly match the skill name "That\'s Mine!" (same id thats_mine)',
    ]);
  });
});
