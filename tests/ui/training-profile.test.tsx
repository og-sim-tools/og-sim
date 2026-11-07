// @vitest-environment jsdom
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameDataFromDir } from '../../src/engine/loader-node';
import { type Profile, ProfileSchema } from '../../src/engine/model';
import { ProfileEditor } from '../../src/ui/components/ProfileEditor';

afterEach(cleanup);
const data = loadGameDataFromDir(join(__dirname, '..', '..', 'data')).data;
const base = ProfileSchema.parse({ basic_stats: { hp: '5M', atk: '1M', initial_block: '2M' } });

function renderWith(profile: Profile) {
  const onChange = vi.fn();
  render(<ProfileEditor data={data} profile={profile} issues={[]} loadoutIssues={[]} onChange={onChange} />);
  return onChange;
}

describe('Profile tab: Type in or Calculate HP / ATK / Block', () => {
  it('typing in is the default and switching to Calculate keeps the typed values', () => {
    const onChange = renderWith(base);
    expect((screen.getByRole('radio', { name: /Type in/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('HP')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Calculate/ }));
    const next = onChange.mock.calls[0]![0] as Profile;
    expect(next.stat_mode).toBe('calculated');
    expect(next.basic_stats).toEqual(base.basic_stats);
  });

  it('Calculate asks for rank, number, then HP / ATK / Block upgrades, and warns that gear is missing', () => {
    const p = { ...base, stat_mode: 'calculated' as const, training: { rank: 'gmaster', number: 12, hp: 7, atk: 10, block: 3 } };
    const onChange = renderWith(p);
    const labels = ['Training rank', 'Training rank number', 'Training HP upgrades', 'Training ATK upgrades', 'Training Block upgrades'];
    const selects = labels.map((l) => screen.getByLabelText(l) as HTMLSelectElement);
    expect(selects.map((s) => s.value)).toEqual(['gmaster', '12', '7', '10', '3']);
    // In the order the game lists them: rank name, number, HP, ATK, Block.
    const all = [...document.querySelectorAll('[data-tour="profile.training"] select')].map((s) => s.getAttribute('aria-label'));
    expect(all).toEqual(labels);
    expect(document.body.textContent).toMatch(/HP 296K · ATK 59\.8K · Initial Block 118K/);
    expect(screen.getByRole('alert').textContent).toMatch(/Gear HP \/ ATK \/ Block isn't counted/);

    fireEvent.change(selects[0]!, { target: { value: 'apprentice' } });
    // GMaster 12 → Apprentice only goes up to 3.
    expect((onChange.mock.calls[0]![0] as Profile).training).toEqual({ rank: 'apprentice', number: 3, hp: 7, atk: 10, block: 3 });
  });

  it('the enemy editor keeps plain typed-in stats', () => {
    render(<ProfileEditor data={data} profile={base} issues={[]} loadoutIssues={[]} editingEnemy onChange={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: /Calculate/ })).toBeNull();
  });
});
