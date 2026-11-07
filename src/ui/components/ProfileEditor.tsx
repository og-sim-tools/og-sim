/**
 * Profile tab (SPEC §8.1): the account, the same for every build and saved automatically — HP / ATK / Block as
 * the game shows them (first), the heroes I own with their stars, skill links and Dragon's Blessings, the pets
 * and skins I own with their stars, and my auras. What's chosen per build is in the Build tab.
 */
import type { GameData, Hero, Issue } from '../../engine/loader';
import { formatIssue } from '../../engine/loader';
import type { LoadoutIssue } from '../../engine/loadout';
import { basicStats } from '../../engine/accountStats';
import { CLASSES, type Profile } from '../../engine/model';
import { formatShown } from '../../engine/numbers';
import { rankLevel } from '../../engine/training';
import { IssueLine } from './StatsPanel';
import { AbbrevInput, BlessingsEditor, SkillLinksEditor, sortPets } from './SetupEditors';
import { rarityColor } from './BagGrid';

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

  const cfg = data.config!;
  const ownedPets = new Map(profile.owned_pets.map((p) => [p.id, p.stars]));
  const ownedSkins = new Map(profile.skins.map((s) => [s.id, s.stars]));
  const skinHeroes = (s: (typeof data.skins extends Map<string, infer T> ? T : never)) =>
    s.available?.all ? 'all heroes' : [...(s.available?.heroes ?? []).map((h) => data.heroes.get(h)?.name ?? h), ...(s.available?.classes ?? [])].join(', ');

  return (
    <div className="page profile-page">
      <div className="panel profile-stats" data-tour="profile.stats">
        <h2>Stats</h2>
        <div className="small muted">
          {editingEnemy
            ? "The enemy's HP, ATK and Block (saved with this build)."
            : profile.stat_mode === 'calculated'
              ? 'HP, ATK and Block added up from your Combat Training (rank, then HP, ATK and Block upgrades in that rank) and the other sources the simulator knows. The same in every build.'
              : "HP, ATK and Block as the game's Stat Details screen shows them (this overrides every calculation). They're the same in every build; everything else (Crit, Haste, DMG bonuses …) is calculated from your gear, blessings and auras."}
        </div>
        {!editingEnemy && <StatModeToggle profile={profile} update={update} />}
        {profile.stat_mode === 'calculated' && !editingEnemy ? (
          <CalculatedStats data={data} profile={profile} update={update} />
        ) : (
          <div className="row small" style={{ marginTop: 6 }}>
            {(['hp', 'atk', 'initial_block'] as const).map((k) => (
              <label key={k} className="muted">
                {k === 'hp' ? 'HP' : k === 'atk' ? 'ATK' : 'Block'} <AbbrevInput label={k === 'hp' ? 'HP' : k === 'atk' ? 'ATK' : 'Initial Block'} value={profile.basic_stats[k]} onCommit={(v) => update((p) => void (p.basic_stats[k] = v))} width={80} />
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="stack">
        <div className="panel" data-tour="profile.heroes">
          <h2>
            Heroes <span className="small muted">{owned.size} of {data.heroes.size} owned</span>
          </h2>
          <div className="small muted">
            {editingEnemy
              ? "The enemy's heroes, stars, skill links and blessings (saved with this build)."
              : "Tick the heroes you own and set their stars. Open a hero for its Dragon's Blessings, skills and skill links."}
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
        {!editingEnemy && (
          <div className="panel" data-tour="profile.pets">
            <h2>
              Pets <span className="small muted">{profile.owned_pets.length} of {data.pets.size} owned</span>
            </h2>
            <div className="small muted">The pets you own and their stars. A build picks up to 3 of them (Build tab, Pets box).</div>
            <div className="owned-grid">
              {sortPets([...data.pets.values()]).map((pet) => (
                <label key={pet.id} className="row small owned-row">
                  <span className="swatch" style={{ background: rarityColor(pet.rarity) }} />
                  <span className="name">{pet.name}</span>
                  <select
                    aria-label={`${pet.name} stars`}
                    value={ownedPets.has(pet.id) ? String(ownedPets.get(pet.id)) : ''}
                    onChange={(e) =>
                      update((p) => {
                        p.owned_pets = p.owned_pets.filter((o) => o.id !== pet.id);
                        if (e.target.value !== '') p.owned_pets.push({ id: pet.id, stars: Number(e.target.value) });
                      })
                    }
                  >
                    <option value="">not owned</option>
                    {Array.from({ length: cfg.pets.max_stars + 1 }, (_, k) => (
                      <option key={k} value={k}>
                        {k}★
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="panel" data-tour="profile.skins">
          <h2>
            Skins <span className="small muted">{profile.skins.length} owned</span>
          </h2>
          <div className="small muted">{editingEnemy ? "The enemy's skins and their stars." : 'The skins you own and their stars. A build brings up to 2 of their skills (Build tab, Skins box).'}</div>
          <div className="owned-grid">
            {[...data.skins.values()]
              .filter((s) => !s.enemy_only)
              .map((skin) => (
                <label key={skin.id} className="row small owned-row" title={skin.skill ? `${skin.skill.name}: ${skin.skill.reward}` : 'No skill'}>
                  <span className="name">
                    {skin.name} <span className="muted">({skinHeroes(skin) || '—'})</span>
                  </span>
                  <select
                    aria-label={`${skin.name} stars`}
                    value={ownedSkins.has(skin.id) ? String(ownedSkins.get(skin.id)) : ''}
                    onChange={(e) =>
                      update((p) => {
                        p.skins = p.skins.filter((o) => o.id !== skin.id);
                        if (e.target.value !== '') p.skins.push({ id: skin.id, stars: Number(e.target.value) });
                        else p.equipped_skins = p.equipped_skins.filter((x) => x !== skin.id);
                      })
                    }
                  >
                    <option value="">not owned</option>
                    {Array.from({ length: 6 }, (_, k) => (
                      <option key={k} value={k}>
                        {k}★
                      </option>
                    ))}
                  </select>
                </label>
              ))}
          </div>
        </div>
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

/** Type HP / ATK / Block in (accurate), or calculate them from Combat Training and the rest (incomplete). */
function StatModeToggle({ profile, update }: { profile: Profile; update: (fn: (p: Profile) => void) => void }) {
  const mode = profile.stat_mode ?? 'direct';
  return (
    <div className="row small" role="radiogroup" aria-label="How HP, ATK and Block are found" style={{ marginTop: 6 }}>
      {(
        [
          ['direct', 'Type in', 'Type in your HP, ATK and Block exactly as the game shows them. Overrides every calculation (training, pets, heroes, gear).'],
          ['calculated', 'Calculate', 'Add up Combat Training and the other sources. Incomplete: gear is not counted yet.'],
        ] as const
      ).map(([m, label, title]) => (
        <label key={m} title={title}>
          <input
            type="radio"
            name="stat-mode"
            checked={mode === m}
            onChange={() =>
              update((p) => {
                if (m === 'direct') delete p.stat_mode;
                else p.stat_mode = 'calculated';
              })
            }
          />{' '}
          {label}
        </label>
      ))}
    </div>
  );
}

const range = (n: number, from = 0) => Array.from({ length: n - from + 1 }, (_, i) => i + from);

/** Combat Training inputs (rank name, number, then HP / ATK / Block upgrades) and the calculated totals. */
function CalculatedStats({ data, profile, update }: { data: GameData; profile: Profile; update: (fn: (p: Profile) => void) => void }) {
  const t = data.training;
  const result = basicStats(data, profile);
  const tr = profile.training ?? (t ? { rank: t.ranks[0]!.id, number: 1, hp: 0, atk: 0, block: 0 } : null);
  const rank = t?.ranks.find((r) => r.id === tr?.rank);
  const per = t?.upgrades_per_rank ?? 10;
  // The last rank has no next one: its upgrades stop where the table ends.
  const level = t && tr ? rankLevel(t, tr.rank, tr.number) : null;
  const maxUps = t && level !== null ? Math.min(per, t.track.hp.length - 1 - per * level) : per;
  const set = (patch: Partial<NonNullable<typeof tr>>) =>
    update((p) => {
      if (!tr) return;
      const next = { ...tr, ...patch };
      const r = t?.ranks.find((x) => x.id === next.rank);
      if (r && next.number > r.numbers) next.number = r.numbers;
      p.training = next;
    });
  return (
    <div className="calculated-stats" style={{ marginTop: 6 }}>
      {t && tr && (
        <div className="row small" data-tour="profile.training">
          <span className="muted">Combat Training</span>
          <label className="muted">
            Rank{' '}
            <select aria-label="Training rank" value={tr.rank} onChange={(e) => set({ rank: e.target.value })}>
              {t.ranks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <select aria-label="Training rank number" value={tr.number} onChange={(e) => set({ number: Number(e.target.value) })}>
            {range(rank?.numbers ?? 1, 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {(['hp', 'atk', 'block'] as const).map((k) => (
            <label key={k} className="muted">
              {k === 'hp' ? 'HP' : k === 'atk' ? 'ATK' : 'Block'}{' '}
              <select aria-label={`Training ${k === 'hp' ? 'HP' : k === 'atk' ? 'ATK' : 'Block'} upgrades`} value={tr[k]} onChange={(e) => set({ [k]: Number(e.target.value) })}>
                {range(Math.max(maxUps, tr[k])).map((n) => (
                  <option key={n} value={n}>
                    {n}/{per}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="small" style={{ marginTop: 4 }}>
        HP <b>{formatShown(result.hp)}</b> · ATK <b>{formatShown(result.atk)}</b> · Initial Block <b>{formatShown(result.initialBlock)}</b>
        <span className="muted"> (calculated)</span>
      </div>
      {result.source.parts.map((p, i) => (
        <div key={i} className="small muted">
          {p.label}: {formatShown(p.amount)}
        </div>
      ))}
      <div className="issue warning small" role="alert">
        Calculated stats are incomplete and lower than in game. {result.source.warnings.join(' ')} For accurate battles, pick "Type in" and enter your stats from the game's Stat Details screen.
      </div>
    </div>
  );
}

function HeroRow({ hero, owned, data, profile, update }: { hero: Hero; owned: OwnedHero | undefined; data: GameData; profile: Profile; update: (fn: (p: Profile) => void) => void }) {
  const cfg = data.config!;
  const edit = (fn: (h: OwnedHero) => void) => update((p) => fn(p.heroes.find((x) => x.id === hero.id)!));
  if (!owned) {
    return (
      <div className="hero-row not-owned small">
        <label>
          <input type="checkbox" checked={false} onChange={() => update((p) => void p.heroes.push({ id: hero.id, stars: 0, links: [], skin: null }))} /> {hero.name}
        </label>
        <span className="muted">{hero.rarity} · not owned</span>
      </div>
    );
  }

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

      <BlessingsEditor hero={hero} owned={owned} data={data} update={update} open />
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
      <SkillLinksEditor hero={hero} owned={owned} data={data} profile={profile} update={update} />
    </details>
  );
}

