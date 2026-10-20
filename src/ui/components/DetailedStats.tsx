/**
 * Detailed stats (Battle tab, user 2026-10-20): HP / ATK / Block and every calculated stat, then every item in
 * the bag with its final numbers; click an item for its breakdown and synergies.
 */
import { useMemo, useState } from 'react';
import { buildSynergyReport } from '../../engine/effects/synergy';
import type { Loadout } from '../../engine/loadout';
import { formatShown } from '../../engine/numbers';
import { aggregateStats } from '../../engine/stats';
import { BuildStats } from './SetupEditors';
import { ItemDetail } from './StatsPanel';

export function DetailedStats({ loadout, label }: { loadout: Loadout; label: string }) {
  const stats = useMemo(() => aggregateStats(loadout), [loadout]);
  const synergy = useMemo(() => buildSynergyReport(loadout), [loadout]);
  const [open, setOpen] = useState<string | null>(null);
  const items = [...stats.items.values()];
  const sel = open ? stats.items.get(open) : undefined;
  return (
    <details className="detailed-stats">
      <summary>Detailed stats</summary>
      <h3>Stats</h3>
      <BuildStats data={loadout.data} profile={loadout.profile} update={() => {}} readOnly open />
      <h3>Items</h3>
      {items.length === 0 ? (
        <div className="small muted">The bag is empty.</div>
      ) : (
        <table className="stats compact" aria-label={`${label} items`}>
          <thead>
            <tr>
              <th>Item</th>
              <th>DMG/hit</th>
              <th>CD</th>
              <th>Acc</th>
              <th>Crit</th>
              <th>Crit DMG</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.instanceId} className={`clickable${s.instanceId === open ? ' sel' : ''}`} onClick={() => setOpen(s.instanceId === open ? null : s.instanceId)} title="Click for its breakdown and synergies">
                <td>{s.name}</td>
                <td>{s.damage ? formatShown(s.damage.perHit) : '—'}</td>
                <td>{s.cooldown ? `${s.cooldown.final.toFixed(2)}s` : '—'}</td>
                <td>{s.accuracy ? `${s.accuracy.total}%` : '—'}</td>
                <td>{s.critChance ? `${s.critChance.capped}%` : '—'}</td>
                <td>{s.critDamage ? `+${Number(s.critDamage.total.toFixed(1))}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sel && (
        <div className="hero-card" style={{ marginTop: 6 }}>
          <b>{sel.name}</b>
          <ItemDetail s={sel} syn={synergy.get(sel.instanceId)} names={(id) => stats.items.get(id)?.name ?? id} />
        </div>
      )}
    </details>
  );
}
