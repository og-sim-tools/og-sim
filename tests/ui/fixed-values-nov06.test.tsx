// @vitest-environment jsdom
/** User, 2026-11-06: unique blessings have one value per rarity, Flame Staff 2.6s, one of each pet, the Blood Moon Familiar sprite. */
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import type { Profile } from '../../src/engine/model';
import { BlessingsEditor, PetsEditor } from '../../src/ui/components/SetupEditors';

afterEach(cleanup);

const data = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const profileWith = (equipped: string, pets = '[]') =>
  loadProfile(
    {
      path: 'p.yaml',
      text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }\nheroes: [{ id: kai, stars: 0, blessings: { level: 5, equipped: [${equipped}] } }]\nactive_hero: kai\npets: ${pets}\n`,
    },
    data,
  ).profile!;

/** Render an editor whose updates change `profile` in place, and re-render after each. */
function editable(p: Profile, view: (p: Profile, update: (fn: (p: Profile) => void) => void) => JSX.Element) {
  const update = (fn: (p: Profile) => void) => {
    fn(p);
    r.rerender(view(p, update));
  };
  const r = render(view(p, update));
  return p;
}

describe('unique blessings', () => {
  const kai = () => data.heroes.get('kai')!;
  const show = (p: Profile, update: (fn: (p: Profile) => void) => void) => (
    <BlessingsEditor hero={kai()} owned={p.heroes[0]!} data={data} update={update} open />
  );

  it("show the wiki's value, can't be typed over, and follow the rarity", () => {
    const p = editable(profileWith('{ id: kai_sword_weapon_dmg, rarity: epic, value: 20 }'), show);
    const input = screen.getByLabelText('Blessing value') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('20');
    fireEvent.change(screen.getByLabelText('Blessing rarity'), { target: { value: 'mythic' } });
    expect(p.heroes[0]!.blessings!.equipped[0]).toMatchObject({ rarity: 'mythic', value: 60 });
  });

  it('offer to fix a saved value that differs', () => {
    const p = editable(profileWith('{ id: kai_sword_weapon_dmg, rarity: epic, value: 15 }'), show);
    fireEvent.click(screen.getByRole('button', { name: 'Use 20' }));
    expect(p.heroes[0]!.blessings!.equipped[0]!.value).toBe(20);
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
  });

  it('take the fixed value when picked', () => {
    const p = editable(profileWith('{ id: crit_dmg, rarity: epic, value: 7 }'), show);
    expect((screen.getByLabelText('Blessing value') as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Blessing'), { target: { value: 'kai_sword_weapon_dmg' } });
    expect(p.heroes[0]!.blessings!.equipped[0]).toMatchObject({ id: 'kai_sword_weapon_dmg', rarity: 'epic', value: 20 });
  });
});

describe('pets', () => {
  it('a pet already in another slot is greyed out', () => {
    const [a, b] = [...data.pets.keys()];
    editable(profileWith('', `[{ id: ${a}, stars: 0, active: true }, { id: ${b}, stars: 0, active: true }]`), (p, update) => <PetsEditor data={data} profile={p} update={update} />);
    const second = screen.getByLabelText('Pet 2') as HTMLSelectElement;
    expect([...second.options].find((o) => o.value === a)!.disabled).toBe(true);
    expect([...second.options].find((o) => o.value === b)!.disabled).toBe(false);
  });
});

describe('data', () => {
  it('Flame Staff: 2.6s in game (wiki 2.1)', () => {
    expect(data.items.get('flame_staff')!.stats.cooldown).toBe(2.6);
  });

  it('Blood Moon Familiar has its sprite', () => {
    expect(data.items.get('blood_moon_familiar')).toMatchObject({ image: 'items/blood_moon_familiar.png', image_size: { w: 15, h: 14 } });
  });
});
