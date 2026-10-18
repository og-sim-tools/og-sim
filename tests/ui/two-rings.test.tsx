// @vitest-environment jsdom
/** Two identical rings/gloves are two separate pieces of gear. */
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadProfile } from '../../src/engine/loader';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { buildLoadout } from '../../src/engine/loadout';
import { LayoutSchema } from '../../src/engine/model';
import { validateLoadout } from '../../src/engine/validate';
import { GearEditor } from '../../src/ui/components/SetupEditors';

afterEach(cleanup);

const data = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const profile = loadProfile(
  {
    path: 'p.yaml',
    text: `basic_stats: { hp: 1M, atk: 100K, initial_block: 0 }
gear:
  rings: [{ id: natures_ring, rarity: epic, tier: 0 }, { id: natures_ring, rarity: rare, tier: 0 }]
heroes: [{ id: kai, stars: 0 }]
active_hero: kai
`,
  },
  data,
).profile!;
const layout = (n: number) =>
  LayoutSchema.parse({ placements: Array.from({ length: n }, (_, i) => ({ item: 'natures_ring', x: i * 2, y: 0, rotation: 0 })) });
const panel = (n: number) =>
  render(<GearEditor data={data} profile={profile} update={vi.fn()} loadout={buildLoadout(data, profile, layout(n))} onPlace={vi.fn()} />);

describe('two identical rings', () => {
  it('placing one still offers the second', () => {
    panel(1);
    expect(screen.getAllByText('in bag')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Place' })).toHaveLength(1);
  });

  it('both placed: both in the bag, each with its own rarity, no gear issues', () => {
    panel(2);
    expect(screen.getAllByText('in bag')).toHaveLength(2);
    const lo = buildLoadout(data, profile, layout(2));
    const rings = [...lo.entries.values()].filter((e) => e.kind === 'gear');
    expect(rings.map((e) => e.gearRarity)).toEqual(['epic', 'rare']);
    const codes = validateLoadout(lo).map((i) => i.code);
    expect(codes).not.toContain('gear_not_equipped');
    expect(codes).not.toContain('gear_not_placed');
  });
});
