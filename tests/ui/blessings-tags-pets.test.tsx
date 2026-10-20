// @vitest-environment jsdom
/** Blessings feeding Stat Details, tag suggestions in the item editor, pet ordering, tag stats. */
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { LayoutSchema, type Profile } from '../../src/engine/model';
import { buildLoadout } from '../../src/engine/loadout';
import { aggregateStats } from '../../src/engine/stats';
import { ItemEditor } from '../../src/ui/components/ItemEditor';
import { ProfileEditor, sortPets } from '../../src/ui/components/ProfileEditor';
import { BuildStats, HeroEditor } from '../../src/ui/components/SetupEditors';
import { computeAccountStats } from '../../src/engine/accountStats';
import { knownTags, suggestTags } from '../../src/ui/state/editor';
import { DATA_, combatLoadout } from '../combat-fixture';

afterEach(cleanup);

const data = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const profileWith = (equipped: string, stats = '') =>
  loadProfile(
    {
      path: 'p.yaml',
      text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\ndetailed_stats: { ${stats} }\nheroes: [{ id: kai, stars: 0, blessings: { level: 5, equipped: [${equipped}] } }]\nactive_hero: kai\n`,
    },
    data,
  ).profile!;

describe('blessings → calculated stats', () => {
  it('maps every tag blessing to a tag stat', () => {
    for (const id of ['sword_weapon_dmg', 'bow_weapon_dmg', 'rock_trap_weapon_dmg', 'kai_sword_weapon_dmg', 'erwen_bow_dmg']) {
      const stat = data.blessings.get(id)!.stat!;
      expect(data.stats.get(stat)?.item_tags?.length, id).toBeGreaterThan(0);
    }
  });

  it("adds the active hero's stat blessings (HP % multiplies base HP)", () => {
    const p = profileWith('{ id: crit_dmg, rarity: epic, value: 20 }, { id: kai_sword_weapon_dmg, rarity: epic, value: 15 }, { id: hp, rarity: epic, value: 10 }');
    const s = computeAccountStats(data, p, 'kai');
    expect(s.detailed).toMatchObject({ crit_dmg: 120, sword_dmg_increase: 15, hp_pct: 10 });
    expect(s.hp).toBe(1e6); // typed-in HP already includes % bonuses
  });

  it('shows the calculated stats with where they come from, and no percentage inputs', () => {
    const p = profileWith('{ id: crit_dmg, rarity: epic, value: 20 }');
    render(
      <>
        <HeroEditor data={data} profile={p} heroId="kai" onHero={vi.fn()} update={vi.fn()} />
        <BuildStats data={data} profile={p} update={vi.fn()} />
      </>,
    );
    expect(screen.getByText('Blessings').closest('summary')!.textContent).toMatch(/1 \/ 5.*Crit DMG/);
    const table = screen.getByRole('table', { name: 'Calculated stats' });
    expect(table.textContent).toMatch(/Crit DMG120%/);
    expect(table.textContent).toMatch(/Blessing: Crit DMG \+20/);
    expect(screen.queryByLabelText('Crit DMG')).toBeNull();
  });
});

describe('gear → calculated stats', () => {
  it('adds stat lines up to the rarity and the bonus stat × the rarity scale', () => {
    const p = loadProfile(
      {
        path: 'p.yaml',
        text: [
          'basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }',
          'gear:',
          '  weapon: { id: primal_flame, rarity: mythic, tier: 0 }',
          '  rings: [{ id: archwizards_ring, rarity: legendary, tier: 0 }]',
        ].join('\n'),
      },
      data,
    ).profile!;
    const s = computeAccountStats(data, p, null);
    // Primal Flame: ATK +25% (rare), Burn DMG +35% (epic), Burn inflict +50% (legendary), Crit Rate 12.5 × 4 (mythic).
    // Archwizard's Ring (legendary): ATK +10% (uncommon) +15% (epic).
    expect(s.detailed).toMatchObject({ atk_pct: 50, burn_dmg_increase: 35, burn_inflict_increase: 50, crit_rate: 50 });
    expect(s.atk).toBe(100_000); // typed-in ATK already includes gear ATK %
    expect(s.parts.map((x) => x.label)).toContain('Primal Flame (mythic) +0: Crit Rate +50%');
    expect(s.bonusMissing).toEqual([]);
  });

  it('S weapon bonus stat: known for epic +0..+2, legendary +0..+3, mythic +0..+1 (user, 2026-10-18); anything else needs the in-game value', () => {
    const at = (weapon: string) =>
      computeAccountStats(data, loadProfile({ path: 'p.yaml', text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }
gear:
  weapon: ${weapon}
` }, data).profile!, null);
    const table: [string, number, number][] = [['epic', 0, 12.5], ['epic', 1, 15], ['epic', 2, 17.5], ['legendary', 0, 25], ['legendary', 1, 30], ['legendary', 2, 35], ['legendary', 3, 40], ['mythic', 0, 50], ['mythic', 1, 55]];
    for (const [r, t, v] of table) {
      const s = at(`{ id: primal_flame, rarity: ${r}, tier: ${t} }`);
      expect(s.detailed.crit_rate, `${r}+${t}`).toBe(v);
      expect(s.bonusMissing).toEqual([]);
    }
    // Not known yet: mythic +2, and any non-S weapon (they start at +3%).
    expect(at('{ id: primal_flame, rarity: mythic, tier: 2 }').bonusMissing).toMatchObject([{ gearId: 'primal_flame', rarity: 'mythic', tier: 2 }]);
    expect(at('{ id: frost_staff, rarity: mythic, tier: 0 }').bonusMissing).toHaveLength(1);
    // The value typed in always wins, also over a known one.
    expect(at('{ id: primal_flame, rarity: mythic, tier: 2, bonus_value: 60 }').detailed.crit_rate).toBe(60);
    expect(at('{ id: primal_flame, rarity: mythic, tier: 0, bonus_value: 49 }').detailed.crit_rate).toBe(49);
    const prof = loadProfile({ path: 'p.yaml', text: ['basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }', 'gear:', '  weapon: { id: primal_flame, rarity: mythic, tier: 3 }'].join('\n') }, data).profile!;
    const lo = buildLoadout(data, prof, LayoutSchema.parse({ placements: [] }));
    expect(aggregateStats(lo).issues.some((i) => i.code === 'gear_bonus_missing' && i.level === 'error')).toBe(true);
  });
});

describe('blessings', () => {
  it('a hero ticked in the Profile tab is just owned (0★, no blessings); every hero has 5 blessing slots, with no level to set (2026-10-20)', () => {
    expect(data.config!.blessings.default_level).toBe(9);
    const onChange = vi.fn();
    render(<ProfileEditor data={data} profile={profileWith('')} issues={[]} loadoutIssues={[]} onChange={onChange} />);
    const erwen = screen.getAllByRole('checkbox').find((c) => c.parentElement?.textContent?.trim() === 'Erwen')!;
    fireEvent.click(erwen);
    const next = onChange.mock.calls.at(-1)![0] as Profile;
    expect(next.heroes.find((h) => h.id === 'erwen')).toEqual({ id: 'erwen', stars: 0, links: [], skin: null });
    cleanup();
    render(<HeroEditor data={data} profile={{ ...next, active_hero: 'erwen' }} heroId="erwen" onHero={vi.fn()} update={vi.fn()} />);
    expect(screen.queryByLabelText('Blessing level')).toBeNull();
    expect(screen.getByText('Blessings').closest('summary')!.textContent).toMatch(/0 \/ 5/);
    expect(document.body.textContent).not.toMatch(/Dragon's Blessing level/);
  });
});

describe('tag stats', () => {
  it('[Sword] DMG Increase adds to items tagged sword only', () => {
    const lo = combatLoadout(['blade', 'rock'], 'sword_dmg_increase: 20');
    const s = aggregateStats(lo).items;
    expect(s.get('blade0')!.damage!.typePct.total).toBe(20);
    expect(s.get('rock1')!.damage!.typePct.total).toBe(0);
    expect(DATA_.stats.get('creature_dmg_increase')!.item_tags).toEqual(['creature']);
  });
});

describe('tag suggestions', () => {
  const known = knownTags(data);

  it('knows the tags in use and suggests prefix matches first', () => {
    expect(known).toContain('sword');
    expect(known).toContain('blunted');
    expect(suggestTags(['bow', 'crossbow', 'blunted'], 'bo')).toEqual(['bow', 'crossbow']);
    expect(suggestTags(['bow', 'crossbow'], 'bo', ['bow'])).toEqual(['crossbow']);
  });

  it('the gear editor suggests tags and warns about a tag nothing else uses', () => {
    render(<ItemEditor data={data} target={{ category: 'gear', id: 'spiral_spear' }} onTarget={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
    const input = screen.getByLabelText('Tags');
    fireEvent.change(input, { target: { value: 'blu' } });
    expect(screen.getByRole('button', { name: 'blunted' })).toBeTruthy();
    fireEvent.change(input, { target: { value: 'swrod' } });
    expect(screen.getByText(/"swrod" isn't a known tag/)).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/New tag nothing else uses: swrod/)).toBeTruthy();
  });
});

describe('pets', () => {
  it('orders mythic → rare, then by name', () => {
    const sorted = sortPets([
      { name: 'B', rarity: 'rare' },
      { name: 'A', rarity: 'rare' },
      { name: 'Z', rarity: 'mythic' },
      { name: 'C', rarity: 'epic' },
      { name: 'D', rarity: 'legendary' },
    ]);
    expect(sorted.map((p) => p.name)).toEqual(['Z', 'D', 'C', 'A', 'B']);
  });
});
