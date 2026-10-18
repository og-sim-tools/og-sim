// @vitest-environment jsdom
/** Marking enhanced bag cells (Venom's Poison Coating, Cecilia's Instant Casting). */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { parse } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LayoutSchema } from '../../src/engine/model';
import { BagGrid } from '../../src/ui/components/BagGrid';
import { layoutToYaml, withIds } from '../../src/ui/state/layoutOps';
import { combatLoadout } from '../combat-fixture';

afterEach(cleanup);

describe('enhanced cells', () => {
  const grid = (enhanceEdit: boolean, onToggleEnhanced = vi.fn()) =>
    render(
      <BagGrid
        loadout={combatLoadout(['blade'])}
        issues={[]}
        selected={null}
        hovered={null}
        ghost={null}
        maskEdit={false}
        enhanced={[{ x: 3, y: 1 }]}
        enhanceEdit={enhanceEdit}
        onToggleEnhanced={onToggleEnhanced}
        onSelect={vi.fn()}
        onHover={vi.fn()}
        onToggleMask={vi.fn()}
        onDrop={vi.fn()}
        onKey={vi.fn()}
      />,
    );

  it('shows enhanced cells and toggles them while marking', () => {
    const onToggle = vi.fn();
    const { container } = grid(true, onToggle);
    expect(container.querySelectorAll('.cell.enhanced')).toHaveLength(1);
    fireEvent.click(container.querySelectorAll('.cell')[0]!);
    expect(onToggle).toHaveBeenCalledWith(0, 0);
  });

  it('are saved with the layout', () => {
    const yaml = layoutToYaml(withIds(LayoutSchema.parse({ placements: [], enhanced_cells: [{ x: 3, y: 1 }] })));
    expect(LayoutSchema.parse(parse(yaml)).enhanced_cells).toEqual([{ x: 3, y: 1 }]);
  });
});
