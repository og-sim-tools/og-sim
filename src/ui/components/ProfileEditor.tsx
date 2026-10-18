/**
 * Profile tab (SPEC §8.1): the account, the same for every build and saved automatically — the heroes I own
 * with their stars and skill links, and my auras. Everything chosen per build is in the Battle tab.
 */
import type { GameData, Hero, Issue } from '../../engine/loader';
import { formatIssue } from '../../engine/loader';
import type { LoadoutIssue } from '../../engine/loadout';
import { CLASSES, type Profile } from '../../engine/model';
import { IssueLine } from './StatsPanel';

export { sortPets } from './SetupEditors';

type OwnedHero = Profile['heroes'][number];

interface Props {
  data: GameData;
  profile: Profile;
  issues: Issue[];
  loadoutIssues: LoadoutIssue[];
  /** Editing the typed-in enemy's account (saved with the build it belongs to). */
  editingEnemy?: boolean;
  onChange: (p: Profile) => void;
}

export function ProfileEditor({ data, profile, issues, loadoutIssues, editingEnemy = false, onChange }: Props) {
  const update = (fn: (p: Profile) => void) => {
    const next = structuredClone(profile);
    fn(next);
    onChange(next);
  };
  const owned = new Map(profile.heroes.map((h) => [h.id, h]));
  const heroesByClass = CLASSES.map((c) => [c, [...data.heroes.values()].filter((h) => h.class === c)] as const);

  return (
    <div className="page">
      <div className="stack">
        <div className="panel" data-tour="profile.heroes">
          <h2>
            Heroes <span className="small muted">{owned.size} of {data.heroes.size} owned</span>
          </h2>
          <div className="small muted">
            {editingEnemy
              ? "The enemy's heroes, stars and skill links (saved with this build)."
              : 'Tick the heroes you own and set their stars: this is the same for every build and saves itself. Open a hero for its skills and skill links.'}
          </div>
          {issues.map((i, k) => (
            <div key={k} className={`issue ${i.level === 'info' ? '' : i.level}`}>
              {formatIssue(i)}
            </div>
          ))}
          {loadoutIssues.map((i, k) => (
            <IssueLine key={`l${k}`} issue={i} />
          ))}
          {heroesByClass.map(([c, hs]) => (
            <div key={c}>
              <h3 style={{ textTransform: 'capitalize' }}>{c}</h3>
              {hs.map((h) => (
                <HeroRow key={h.id} hero={h} owned={owned.get(h.id)} data={data} profile={profile} update={update} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="stack">
        <div className="panel" data-tour="profile.auras">
          <h2>Auras</h2>
          <div className="small muted">Owned auras add their ownership bonus to every build. The equipped aura's own skill (coins in the shop) isn't simulated.</div>
          {[...data.auras.values()].map((a) => {
            const owned = profile.auras.find((x) => x.id === a.id);
            const o = a.ownership;
            const amount = owned && o ? (owned.stars > 0 ? (o.by_stars[owned.stars - 1] ?? o.base) : o.base) : null;
            return (
              <div key={a.id} className="row small" style={{ marginTop: 4 }}>
                <span style={{ flex: 1 }}>
                  {a.name} <span className="muted">({a.rarity})</span>
                  {o && <span className="muted"> · {data.stats.get(o.stat)?.name ?? o.stat} {amount !== null ? `+${amount}%` : ''}</span>}
                </span>
                <select
                  aria-label={`${a.name} stars`}
                  value={owned ? String(owned.stars) : ''}
                  onChange={(e) =>
                    update((p) => {
                      p.auras = p.auras.filter((x) => x.id !== a.id);
                      if (e.target.value !== '') p.auras.push({ id: a.id, stars: Number(e.target.value) });
                      else if (p.aura === a.id) p.aura = null;
                    })
                  }
                >
                  <option value="">not owned</option>
                  {Array.from({ length: 8 }, (_, s) => (
                    <option key={s} value={s}>
                      {s}★
                    </option>
                  ))}
                </select>
                <label title="Equipped (economy, later)">
                  <input
                    type="radio"
                    name="equipped-aura"
                    disabled={!owned}
                    checked={profile.aura === a.id}
                    onChange={() => update((p) => void (p.aura = a.id))}
                  />{' '}
                  equipped
                </label>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}

function HeroRow({ hero, owned, data, profile, update }: { hero: Hero; owned: OwnedHero | undefined; data: GameData; profile: Profile; update: (fn: (p: Profile) => void) => void }) {
  const cfg = data.config!;
  const edit = (fn: (h: OwnedHero) => void) => update((p) => fn(p.heroes.find((x) => x.id === hero.id)!));
  if (!owned) {
    return (
      <div className="row small" style={{ marginBottom: 4 }}>
        <label>
          <input type="checkbox" checked={false} onChange={() => update((p) => void p.heroes.push({ id: hero.id, stars: 0, links: [], skin: null }))} /> {hero.name}
        </label>
        <span className="muted">{hero.rarity}</span>
      </div>
    );
  }
  const linkSlots = cfg.heroes.skill_link_stars.filter((s) => s <= owned.stars).length;
  const ownedStars = new Map(profile.heroes.map((h) => [h.id, h.stars]));
  const linkable = [...data.heroes.values()]
    .filter((h) => h.class === hero.class && h.id !== hero.id)
    .flatMap((h) => h.skill_links.filter((l) => (ownedStars.get(h.id) ?? -1) >= l.stars).map((l) => ({ id: l.skill, label: `${data.skills.get(l.skill)?.name} (${h.name})` })));

  return (
    <details className="hero-card">
      <summary className="row">
        <input type="checkbox" checked onChange={() => update((p) => void (p.heroes = p.heroes.filter((h) => h.id !== hero.id)))} onClick={(e) => e.stopPropagation()} aria-label={`Own ${hero.name}`} />
        <b>{hero.name}</b>
        <span className="muted small">{hero.rarity}</span>
        <label className="small muted" onClick={(e) => e.stopPropagation()}>
          Stars{' '}
          <select value={owned.stars} onChange={(e) => edit((h) => void (h.stars = Number(e.target.value)))} aria-label={`${hero.name} stars`}>
            {Array.from({ length: cfg.heroes.max_stars + 1 }, (_, s) => (
              <option key={s} value={s}>
                {s}★
              </option>
            ))}
          </select>
        </label>
        <span className="small muted">Supply Ability {cfg.heroes.supply_ability_base[hero.rarity] + cfg.heroes.supply_ability_per_star * owned.stars}</span>
      </summary>

      <h3>Skills</h3>
      {hero.skills.map((s) => {
        const sim = hero.skill_effects[s.id];
        const label = !sim ? 'not entered' : sim.status === 'complete' ? 'simulated' : sim.status === 'partial' ? 'partly simulated' : sim.status === 'shop' ? 'shop only' : 'needs numbers';
        return (
          <div key={s.id} className="small" title={sim?.notes ?? ''}>
            <b>{s.name}</b> <span className={`badge${sim?.status === 'complete' ? '' : ' muted'}`}>{label}</span>
            <div className="muted">{s.text}</div>
          </div>
        );
      })}
      <h3>Skill links</h3>
      {linkSlots === 0 && <div className="small muted">First link slot opens at {cfg.heroes.skill_link_stars[0]}★.</div>}
      {Array.from({ length: linkSlots }, (_, i) => (
        <div key={i} className="row small">
          <span className="muted">Slot {i + 1}</span>
          <select
            value={owned.links[i] ?? ''}
            aria-label={`Link slot ${i + 1}`}
            onChange={(e) =>
              edit((h) => {
                const l = [...h.links];
                l[i] = e.target.value;
                h.links = l.filter(Boolean);
              })
            }
          >
            <option value="">—</option>
            {linkable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </details>
  );
}

