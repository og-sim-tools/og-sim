/** Pet skill text at the pet's star level. */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { petSkillText } from '../../src/ui/state/petText';

const d = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const at = (id: string, stars: number) => {
  const p = d.pets.get(id)!;
  return petSkillText(p.skill.text, p.star_effects, stars);
};

describe('pet skill text with stars', () => {
  it('folds unlocked star lines into the numbers', () => {
    expect(at('red_dragon', 0).text).toMatch(/30% of the enemy's Max HP/);
    expect(at('red_dragon', 2).text).toMatch(/40% of the enemy's Max HP/);
    expect(at('red_dragon', 5).text).toMatch(/50% of the enemy's Max HP/);
    expect(at('red_dragon', 5).extra.join(' ')).toMatch(/10 Burn/); // nothing to merge into
    expect(at('white_wolf_captain', 2).text).toMatch(/45% Haste/);
    expect(at('fire_fox', 2).text).toMatch(/15% of the enemy's Max HP.*for 10s/);
    expect(at('butterfly', 2).text).toMatch(/summons 15/);
    expect(at('blue_wolf', 2).text).toMatch(/30% Haste/);
    expect(at('ice_reaper', 2).text).toMatch(/60% Reduction/);
    expect(at('poison_mushroom', 2).text).toMatch(/24 Poison/);
    expect(at('eagle', 3).text).toMatch(/Every 4s.*Remove 8 more/);
  });
});
