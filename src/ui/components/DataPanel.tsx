/**
 * Data tab: what the simulator loaded from the game data — problems the loader found, entries not confirmed
 * in game yet, and every manual correction to the wiki.
 */
import { useMemo, useState } from 'react';
import { type LoadResult, formatIssue } from '../../engine/loader';
import { type DataRef, unverifiedEntries } from '../state/dataFlags';
import { Panel } from './Panel';

const show = (v: unknown) => (v === undefined ? '(none)' : JSON.stringify(v));
const CATEGORY_NAMES: Record<string, string> = {
  items: 'Item',
  gear: 'Gear',
  heroes: 'Hero',
  blessings: 'Blessing',
  pets: 'Pet',
  skins: 'Skin',
  auras: 'Aura',
  statuses: 'Status',
  enemies: 'Enemy',
  enemy_traits: 'Enemy trait',
};

interface Props {
  result: LoadResult;
  /** The data the open build uses (for "only this build"). */
  buildRefs?: DataRef[];
  /** Start with "only this build" ticked (coming from the Battle tab's note). */
  focusBuild?: boolean;
}

export function DataPanel({ result, buildRefs = [], focusBuild = false }: Props) {
  const [q, setQ] = useState('');
  const [onlyBuild, setOnlyBuild] = useState(focusBuild && buildRefs.length > 0);
  const inBuild = useMemo(() => new Set(buildRefs.map((r) => r.id)), [buildRefs]);
  const d = result.data;
  const text = q.trim().toLowerCase();
  const keep = (id: string | undefined, hay: string) => (!onlyBuild || (id !== undefined && inBuild.has(id))) && (!text || hay.toLowerCase().includes(text));

  const problems = result.issues.filter((i) => i.level !== 'info' && keep(i.entry, formatIssue(i)));
  const notes = result.issues.filter((i) => i.level === 'info' && keep(i.entry, formatIssue(i)));
  const unverified = useMemo(() => unverifiedEntries(d), [d]).filter((u) => keep(u.id, `${u.category} ${u.id} ${u.name}`));
  const overrides = result.overrides.filter((o) => keep(o.id, `${o.category}/${o.id} ${o.field}`));
  const errors = problems.filter((i) => i.level === 'error').length;

  return (
    <div className="page data-page">
      <div className="stack">
        <Panel id="data.about" title="Game data">
          <div className="small muted">
            {d.items.size} items · {d.gear.size} gear · {d.heroes.size} heroes · {d.pets.size} pets · {d.skins.size} skins · {d.blessings.size} blessings. The numbers come from the game's
            wiki, with corrections from in-game checks on top. The wiki isn't always right, so anything not confirmed in game yet is listed here, and battle results
            that use it may be off.
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input placeholder="Search by name or id…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the data report" style={{ flex: 1, minWidth: 0 }} />
            {buildRefs.length > 0 && (
              <label className="check-line small">
                <input type="checkbox" checked={onlyBuild} onChange={(e) => setOnlyBuild(e.target.checked)} />
                <span>Only what this build uses ({buildRefs.length})</span>
              </label>
            )}
          </div>
        </Panel>

        <Panel id="data.problems" title="Problems" aside={problems.length ? `${errors} error${errors === 1 ? '' : 's'}, ${problems.length - errors} warning${problems.length - errors === 1 ? '' : 's'}` : 'none'}>
          {problems.length === 0 && <div className="muted small">Nothing to report.</div>}
          {problems.map((i, k) => (
            <div key={k} className={`issue ${i.level}`}>
              {formatIssue(i)}
            </div>
          ))}
          {notes.length > 0 && (
            <details className="small" style={{ marginTop: 6 }}>
              <summary>
                {notes.length} note{notes.length === 1 ? '' : 's'} (renames and redirects, nothing wrong)
              </summary>
              {notes.map((i, k) => (
                <div key={k} className="issue">
                  {formatIssue(i)}
                </div>
              ))}
            </details>
          )}
        </Panel>
      </div>

      <div className="stack">
        <Panel id="data.unverified" title="Not verified yet" aside={String(unverified.length)}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Entries taken as they are from their source and not yet confirmed in game. Confirming one (Item editor → "Mark the whole entry verified") takes it off this list.
          </div>
          <div className="list" style={{ maxHeight: 420 }}>
            <table className="stats" aria-label="Not verified yet">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Name</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {unverified.map((u) => (
                  <tr key={`${u.category}:${u.id}`} className={inBuild.has(u.id) ? 'sel' : ''} title={inBuild.has(u.id) ? 'Used by this build' : u.id}>
                    <td className="muted">{CATEGORY_NAMES[u.category] ?? u.category}</td>
                    <td>
                      {u.name} <span className="muted small mono">{u.id}</span>
                    </td>
                    <td className="small">
                      {u.url ? (
                        <a href={u.url} target="_blank" rel="noreferrer">
                          {u.source}
                        </a>
                      ) : (
                        u.source
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel id="data.overrides" title="Corrections to the wiki" aside={String(overrides.length)}>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Every field a manual file (or the Item editor) changes, with the wiki value and the value used now.
          </div>
          <div className="list" style={{ maxHeight: 420 }}>
            <table className="stats">
              <thead>
                <tr>
                  <th>Entry</th>
                  <th>Field</th>
                  <th>Wiki</th>
                  <th>Now</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o, k) => (
                  <tr key={k} title={`${o.file}:${o.line}`}>
                    <td>
                      {o.category}/{o.id}
                    </td>
                    <td className="mono">{o.field}</td>
                    <td className="small">{show(o.from).slice(0, 80)}</td>
                    <td className="small">{show(o.to).slice(0, 80)}</td>
                    <td className="small">
                      {o.source}
                      {o.verified ? ' ✓' : <span className="muted"> (not confirmed)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
