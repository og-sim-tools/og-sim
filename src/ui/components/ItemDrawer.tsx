/**
 * Side panel for the item clicked in the bag: its stats with every modifier from the bag, and the
 * same numbers right after the Start of Battle effects (glove Haste, Swift, Focus …).
 */
import type { StartStats } from '../../engine/combat/battle';
import type { SynergyEntry } from '../../engine/effects/synergy';
import { formatShown } from '../../engine/numbers';
import type { ItemFinalStats } from '../../engine/stats';
import { ItemDetail } from './StatsPanel';
import { imageUrl } from '../staticData';

/** What an item is worth: its shop price in coins (and what it sells for), or why it has none. */
export type ItemWorth =
  | { kind: 'coins'; coins: number; sells: number }
  | { kind: 'unknown' }
  | { kind: 'starting'; points: number; coins: number | null }
  | { kind: 'none'; why: string };

interface Props {
  s: ItemFinalStats;
  syn: SynergyEntry | undefined;
  start: StartStats | undefined;
  names: (id: string) => string;
  image?: string;
  worth?: ItemWorth;
  onClose: () => void;
}

function Worth({ w }: { w: ItemWorth }) {
  const coins = (n: number) => `${n} coin${n === 1 ? '' : 's'}`;
  return (
    <div className="small" style={{ marginTop: 6 }} aria-label="Item value">
      {w.kind === 'coins' && (
        <>
          Value <b>{coins(w.coins)}</b> <span className="muted">· sells for {coins(w.sells)}</span>
        </>
      )}
      {w.kind === 'unknown' && <span className="warn">Value not known yet (the wiki shows "?")</span>}
      {w.kind === 'starting' && (
        <>
          Starting equipment: <b>{w.points} Supply points</b>
          {w.coins !== null && <span className="muted"> · {coins(w.coins)} in the shop (not counted in the build value)</span>}
        </>
      )}
      {w.kind === 'none' && <span className="muted">{w.why}</span>}
    </div>
  );
}

const changed = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && Math.abs(a - b) > 1e-6;

export function ItemDrawer({ s, syn, start, names, image, worth, onClose }: Props) {
  const rows: [string, number | null | undefined, number | null | undefined, (n: number) => string][] = [
    ['DMG / hit', s.damage?.perHit, start?.damagePerHit, formatShown],
    ['Cooldown', s.cooldown?.final, start?.cooldown, (n) => `${n.toFixed(2)}s`],
    ['Haste', s.cooldown?.haste.total, start?.hastePct, (n) => `${Number(n.toFixed(1))}%`],
    ['Accuracy', s.accuracy?.total, start?.accuracy, (n) => `${Number(n.toFixed(1))}%`],
    ['Crit', s.critChance?.capped, start?.critChancePct, (n) => `${Number(n.toFixed(1))}%`],
    ['Crit DMG', s.critDamage?.total, start?.critDamagePct, (n) => `+${Number(n.toFixed(1))}%`],
  ];
  const shown = rows.filter(([, a, b]) => a != null || b != null);
  return (
    <aside className="item-drawer" aria-label="Item details">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {image && <img src={imageUrl(image)} alt="" style={{ height: 32, imageRendering: 'pixelated' }} />}
          {s.name}
        </h2>
        <button aria-label="Close item details" onClick={onClose}>
          ✕
        </button>
      </div>
      {worth && <Worth w={worth} />}
      {shown.length > 0 && (
        <table className="stats" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th />
              <th title="With every bonus from the bag and your stats">In the bag</th>
              <th title="After the Start of Battle effects (Haste from gloves, Swift, Focus …), before any hits">At battle start</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(([label, a, b, f]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{a != null ? f(a) : '—'}</td>
                <td className={changed(a, b) ? 'up' : ''}>{b != null ? f(b) : '—'}</td>
              </tr>
            ))}
            {start?.skillDamagePerHit != null && (
              <tr>
                <td>Skill DMG / hit</td>
                <td>—</td>
                <td>{formatShown(start.skillDamagePerHit)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <ItemDetail s={s} syn={syn} names={names} />
    </aside>
  );
}
