/** Stats panel (SPEC §8): player stats and per-item final stats with where each bonus came from. */
import type { ReactNode } from 'react';
import type { LoadoutIssue } from '../../engine/loadout';
import type { SynergyEntry } from '../../engine/effects/synergy';
import { formatShown } from '../../engine/numbers';
import type { ItemFinalStats, PctStat, StatsResult } from '../../engine/stats';

const sign = (n: number) => `${n >= 0 ? '+' : ''}${Number(n.toFixed(2))}`;

function Parts({ stat }: { stat: PctStat }) {
  if (stat.parts.length === 0) return null;
  return (
    <div className="breakdown">
      {stat.parts.map((c, i) => (
        <div key={i}>
          {sign(c.amount)} {c.label}
        </div>
      ))}
    </div>
  );
}

export function ItemDetail({ s, syn, names }: { s: ItemFinalStats; syn: SynergyEntry | undefined; names: (id: string) => string }) {
  return (
    <div>
      <h3>
        {s.name} <span className="muted small">[{s.instanceId}]</span>
      </h3>
      {s.damage && (
        <>
          <div>
            DMG <b>{formatShown(s.damage.perHit)}</b> per hit{s.damage.hits > 1 ? ` × ${s.damage.hits}` : ''}
          </div>
          <div className="breakdown">
            {s.damage.ratio.ratio !== null ? Number(s.damage.ratio.ratio.toFixed(4)) : '?'}x ATK = {formatShown(s.damage.base)}
            {s.damage.ratio.range && (
              <>
                {' '}
                (observed {s.damage.ratio.range.lo.toFixed(3)}–{s.damage.ratio.range.hi.toFixed(3)}, ±{(s.damage.ratio.uncertainty! * 100).toFixed(2)}%)
              </>
            )}
            <br />× {s.damage.modifier.toFixed(3)} (type {sign(s.damage.typePct.total)}%, all {sign(s.damage.allPct.total)}%)
          </div>
          <Parts stat={s.damage.typePct} />
          <Parts stat={s.damage.allPct} />
        </>
      )}
      {s.cooldown && (
        <>
          <div>
            Cooldown <b>{s.cooldown.final.toFixed(3)}s</b> <span className="muted small">(base {s.cooldown.base}s, haste {sign(s.cooldown.haste.total)}%{s.cooldown.clamped ? ', clamped' : ''})</span>
          </div>
          <Parts stat={s.cooldown.haste} />
        </>
      )}
      {s.accuracy && (
        <>
          <div>
            Accuracy <b>{s.accuracy.total}%</b> <span className="muted small">(before evasion)</span>
          </div>
          <Parts stat={s.accuracy} />
        </>
      )}
      {s.critChance && (
        <>
          <div>
            Crit <b>{s.critChance.capped}%</b>
          </div>
          <Parts stat={s.critChance} />
        </>
      )}
      {s.critDamage && (
        <>
          <div>
            Crit DMG <b>+{s.critDamage.total}%</b>
          </div>
          <Parts stat={s.critDamage} />
        </>
      )}
      {Object.entries(s.effectValues).map(([k, v]) => (
        <div key={k}>
          {k}: <b>{v.value !== null ? formatShown(v.value) : '?'}</b>{' '}
          <span className="muted small">
            ({v.ratio.ratio !== null ? Number(v.ratio.ratio.toFixed(4)) : '?'}x {v.scalesWith.toUpperCase()})
          </span>
        </div>
      ))}
      {syn && (
        <>
          {syn.gives.length > 0 && <h3>Gives</h3>}
          {syn.gives.map((g, i) => (
            <div key={i} className="small">
              {g.text} → {g.targets.map(names).join(', ') || <span className="muted">nothing</span>}
            </div>
          ))}
          {syn.receives.length > 0 && <h3>Receives</h3>}
          {syn.receives.map((r, i) => (
            <div key={i} className="small">
              {r.text} ← {r.fromName}
            </div>
          ))}
          {syn.textOnly && (
            <>
              <h3>{syn.partial ? 'Rest of the effect (text only)' : 'Effect (text only, not simulated yet)'}</h3>
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
                {syn.textOnly}
              </div>
              {syn.dotTargets.length > 0 && <div className="small muted">Dots touch: {syn.dotTargets.map(names).join(', ')}</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}

interface Props {
  stats: StatsResult;
  synergy: Map<string, SynergyEntry>;
  selected: string | null;
  onSelect: (id: string) => void;
}

export function StatsPanel(p: Props) {
  const { stats } = p;
  return (
    <div className="panel">
      <h2>Stats</h2>
      <div className="small">
        HP <b>{formatShown(stats.player.hp)}</b> · ATK <b>{formatShown(stats.player.atk)}</b> · Initial Block <b>{formatShown(stats.player.initialBlock)}</b>
      </div>
      <ItemStats {...p} />
    </div>
  );
}

/** Each attacking item's final numbers; a click opens its breakdown in the side panel. */
export function ItemStats({ stats, selected, onSelect }: Props) {
  const sel = selected ? stats.items.get(selected) : undefined;
  const dmgItems = [...stats.items.values()].filter((s) => s.damage || s.cooldown);
  return (
    <>
      {stats.issues.map((i, k) => (
        <IssueLine key={k} issue={i} />
      ))}
      {dmgItems.length > 0 && (
        <table className="stats" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th>DMG/hit</th>
              <th>CD</th>
              <th>Acc</th>
              <th>Crit</th>
            </tr>
          </thead>
          <tbody>
            {dmgItems.map((s) => (
              <tr key={s.instanceId} className={`clickable${s.instanceId === selected ? ' sel' : ''}`} onClick={() => onSelect(s.instanceId)}>
                <td>{s.name}</td>
                <td>{s.damage ? formatShown(s.damage.perHit) : '—'}</td>
                <td>{s.cooldown ? `${s.cooldown.final.toFixed(2)}s` : '—'}</td>
                <td>{s.accuracy ? `${s.accuracy.total}%` : '—'}</td>
                <td>{s.critChance ? `${s.critChance.capped}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="muted small" style={{ marginTop: 8 }}>
        {sel ? `${sel.name} is open in the side panel.` : 'Click an item (here or in the bag) for its breakdown, synergies and value.'}
      </div>
    </>
  );
}

export function IssueLine({ issue, onClick }: { issue: LoadoutIssue; onClick?: () => void }) {
  return (
    <div className={`issue ${issue.level}${onClick ? ' clickable' : ''}`} onClick={onClick}>
      {issue.message}
    </div>
  );
}

export function IssuesPanel({ issues, onSelect, extra }: { issues: LoadoutIssue[]; onSelect: (id: string) => void; /** Shown under the checks (a note about the data). */ extra?: ReactNode }) {
  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <div className="panel" data-tour="battle.checks">
      <h2>
        Checks{' '}
        <span className="small muted">
          {errors === 0 ? '✓ valid' : `${errors} error${errors === 1 ? '' : 's'}`}
          {issues.length - errors > 0 ? `, ${issues.length - errors} warning${issues.length - errors === 1 ? '' : 's'}` : ''}
        </span>
      </h2>
      {issues.map((i, k) => (
        <IssueLine key={k} issue={i} onClick={i.instanceIds?.[0] ? () => onSelect(i.instanceIds![0]!) : undefined} />
      ))}
      {extra}
    </div>
  );
}
