/**
 * What a build is played with (SPEC §4.8): the hero, gear, pets and skins it brings (saved with the build), and
 * what's account-wide (the hero's blessings, pets' and skins' stars, HP / ATK / Block: saved in the account and
 * the same in every build). Used in the Build tab, for my build and for an enemy's (whose are its own).
 */
import { useEffect, useState } from 'react';
import { computeAccountStats, weaponBonusValue } from '../../engine/accountStats';
import type { GameData, Gear, Hero, Skin } from '../../engine/loader';
import type { Loadout } from '../../engine/loadout';
import { ABBREV_RE, type BlessingValue, CLASSES, PetRarity, type Profile, type Rarity } from '../../engine/model';
import { petSkillText } from '../state/petText';
import { GearIcon } from './BagGrid';

type GearRef = NonNullable<Profile['gear']['weapon']>;
type OwnedHero = Profile['heroes'][number];
export type Update = (fn: (p: Profile) => void) => void;

/** Text input for K/M/B numbers that only commits valid values. */
export function AbbrevInput({ value, onCommit, label, width = 90 }: { value: string | number; onCommit: (v: string) => void; label: string; width?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const ok = ABBREV_RE.test(text.trim());
  return (
    <span>
      <input
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (ABBREV_RE.test(e.target.value.trim())) onCommit(e.target.value.trim().toUpperCase());
        }}
        style={{ width, borderColor: ok ? undefined : 'var(--error)' }}
      />
      {!ok && <span className="field-error"> like 4M, 1.34M, 812.5K</span>}
    </span>
  );
}

const showRange = (v: BlessingValue | undefined) => (!v ? '—' : 'value' in v ? `${v.value}` : `${v.min} ~ ${v.max}`);
const inRange = (v: BlessingValue, x: number) => ('value' in v ? Math.abs(v.value - x) < 1e-9 : x >= Math.min(v.min, v.max) - 1e-9 && x <= Math.max(v.min, v.max) + 1e-9);

/** Mythic → rare, then by name. */
export function sortPets<T extends { name: string; rarity: string }>(pets: T[]): T[] {
  const rank = (r: string) => PetRarity.options.indexOf(r as never);
  return [...pets].sort((a, b) => rank(b.rarity) - rank(a.rarity) || a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ hero and blessings

/** The build's hero (from the heroes I own) and its Dragon's Blessings. */
export function HeroEditor({ data, profile, heroId, onHero, update, account = false }: { data: GameData; profile: Profile; heroId: string | null; onHero: (id: string | null) => void; update: Update; account?: boolean }) {
  const cfg = data.config!;
  const owned = new Map(profile.heroes.map((h) => [h.id, h]));
  const hero = heroId ? data.heroes.get(heroId) : undefined;
  const mine = heroId ? owned.get(heroId) : undefined;
  return (
    <>
      <div className="row">
        <select aria-label="Hero for this build" value={heroId ?? ''} onChange={(e) => onHero(e.target.value || null)} style={{ flex: 1, minWidth: 0 }}>
          <option value="">— pick a hero —</option>
          {CLASSES.map((c) => (
            <optgroup key={c} label={c}>
              {[...data.heroes.values()]
                .filter((h) => h.class === c && owned.has(h.id))
                .map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {hero && mine && (
          <span className="small muted" title="Stars are set in the Profile tab (account-wide)">
            {hero.class} · {mine.stars}★ · Supply {cfg.heroes.supply_ability_base[hero.rarity] + cfg.heroes.supply_ability_per_star * mine.stars}
          </span>
        )}
      </div>
      {profile.heroes.length === 0 && <div className="small muted">Tick the heroes you own in the Profile tab first.</div>}
      {hero && !mine && <div className="issue warning small">{hero.name} isn't among your heroes (Profile tab), so their stars and blessings don't count.</div>}
      {hero && mine && <BlessingsEditor hero={hero} owned={mine} data={data} update={update} account={account} />}
    </>
  );
}

/** Whether the simulator uses a blessing in battle (a stat, a battle bonus, a status bonus, tagged items, or a change to its hero's skill). */
export function blessingSimulated(def: GameData['blessings'] extends Map<string, infer B> ? B : never): boolean {
  return !!(def.stat || def.combat_bonus || def.item_inflict_statuses || def.target_tags.length || def.skill_mods?.length || def.adds_enhanced_slots);
}

/** What a blessing does in the simulator, for its tooltip. */
function blessingHow(def: GameData['blessings'] extends Map<string, infer B> ? B : never, data: GameData): string {
  if (def.stat) return `Adds to ${data.stats.get(def.stat)?.name ?? def.stat}`;
  if (def.combat_bonus || def.item_inflict_statuses) return 'Works in battle only';
  if (def.skill_mods?.length) return `Changes ${data.skills.get(def.buffs_skill ?? '')?.name ?? 'its hero skill'}`;
  if (def.adds_enhanced_slots) return `${def.manual_note ?? 'More enhanced slots'}`;
  if (def.target_tags.length) return '';
  return 'Not simulated';
}

/** A hero's equipped blessings (up to 5), folded to one line until opened. */
export function BlessingsEditor({ hero, owned, data, update, account = false, open }: { hero: Hero; owned: OwnedHero; data: GameData; update: Update; account?: boolean; open?: boolean }) {
  const cfg = data.config!;
  const edit = (fn: (h: OwnedHero) => void) => update((p) => fn(p.heroes.find((x) => x.id === hero.id)!));
  // Always 5 slots (user, 2026-10-20: no Dragon's Blessing level). The saved level is kept as it is.
  const level = owned.blessings?.level ?? cfg.blessings.default_level;
  const slots = cfg.blessings.max_per_hero;
  const equipped = owned.blessings?.equipped ?? [];
  const choices = [...data.blessings.values()].filter((b) => b.kind === 'common' || (b.kind === 'class' && b.class === hero.class) || (b.kind === 'unique' && b.hero === hero.id));
  return (
    <details className="blessings" style={{ marginTop: 6 }} open={open}>
      <summary className="small">
        <b>Blessings</b> {equipped.length} / {slots}
        <span className="muted"> {equipped.map((b) => data.blessings.get(b.id)?.name ?? b.id).join(' · ')}</span>
      </summary>
      {account && <div className="small muted">{hero.name}'s blessings are your account's: the same in every build with {hero.name} (also in the Profile tab).</div>}
      {equipped.map((b, i) => {
        const def = data.blessings.get(b.id);
        const range = def?.values[b.rarity];
        const setB = (patch: Partial<typeof b>) => edit((h) => void (h.blessings!.equipped[i] = { ...b, ...patch }));
        return (
          <div key={i} className="row small" style={{ marginTop: 4 }}>
            <select
              value={b.id}
              aria-label="Blessing"
              style={{ maxWidth: 190 }}
              onChange={(e) => {
                const d = data.blessings.get(e.target.value)!;
                setB({ id: d.id, rarity: (Object.keys(d.values)[0] ?? 'common') as Rarity });
              }}
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id !== b.id && equipped.some((x) => x.id === c.id)}>
                  {c.kind === 'unique' ? '★ ' : c.kind === 'class' ? '◆ ' : ''}
                  {c.name}
                </option>
              ))}
            </select>
            <select value={b.rarity} aria-label="Blessing rarity" onChange={(e) => setB({ rarity: e.target.value as Rarity })}>
              {Object.keys(def?.values ?? {}).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input type="number" step="any" value={b.value} aria-label="Blessing value" style={{ width: 64 }} onChange={(e) => setB({ value: Number(e.target.value) })} />
            <span className={range && !inRange(range, b.value) ? 'field-warn' : 'muted'} title={def ? blessingHow(def, data) : ''}>
              {def?.unit === 'pct' ? '%' : def?.unit === 'seconds' ? 's' : ''} ({showRange(range)})
            </span>
            {def && !blessingSimulated(def) && <span className="badge warn">not simulated</span>}
            {def?.manual_note && <span className="badge" title={def.manual_note}>see note</span>}
            <button onClick={() => edit((h) => void h.blessings!.equipped.splice(i, 1))} aria-label="Remove blessing">
              ✕
            </button>
          </div>
        );
      })}
      <button
        style={{ marginTop: 6 }}
        disabled={equipped.length >= slots}
        onClick={() =>
          edit((h) => {
            const free = choices.find((c) => !(h.blessings?.equipped ?? []).some((x) => x.id === c.id));
            if (!free) return;
            const r = (Object.keys(free.values)[0] ?? 'common') as Rarity;
            const v = free.values[r]!;
            h.blessings = { level, equipped: [...(h.blessings?.equipped ?? []), { id: free.id, rarity: r, value: 'value' in v ? v.value : v.min }] };
          })
        }
      >
        Add blessing
      </button>
    </details>
  );
}

// ------------------------------------------------------------------ gear

const SLOTS = [
  ['weapon', 'weapon', 0],
  ['shield', 'shield', 0],
  ['rings', 'ring', 0],
  ['rings', 'ring', 1],
  ['gloves', 'glove', 0],
  ['gloves', 'glove', 1],
] as const;

/** The 6 gear slots, each with its rarity and tier and a button to put it in the bag. */
export function GearEditor({ data, profile, update, loadout, onPlace }: { data: GameData; profile: Profile; update: Update; loadout: Loadout; onPlace: (g: Gear) => void }) {
  const cfg = data.config!;
  // Count copies, so with two identical rings placing one still leaves the other to place.
  const placed = new Map<string, number>();
  for (const e of loadout.entries.values()) if (e.kind === 'gear') placed.set(e.def.id, (placed.get(e.def.id) ?? 0) + 1);
  const seen = new Map<string, number>();
  return (
    <>
      {SLOTS.map(([field, slot, idx]) => {
        const ref: GearRef | null = field === 'weapon' || field === 'shield' ? profile.gear[field] : (profile.gear[field][idx] ?? null);
        const gear = ref ? data.gear.get(ref.id) : undefined;
        const copy = gear ? (seen.get(gear.id) ?? 0) : 0;
        if (gear) seen.set(gear.id, copy + 1);
        const set = (r: GearRef | null) =>
          update((p) => {
            if (field === 'weapon' || field === 'shield') p.gear[field] = r;
            else {
              const list = [...p.gear[field]];
              if (r) list[idx] = r;
              else list.splice(idx, 1);
              p.gear[field] = list.filter(Boolean);
            }
          });
        const maxTier = ref ? (cfg.gear.max_tier[ref.rarity] ?? 0) : 0;
        // A second ring / glove slot only once the first is filled.
        if (idx === 1 && !(field === 'rings' || field === 'gloves' ? profile.gear[field][0] : null)) return null;
        return (
          <div key={`${field}${idx}`} className="gear-row">
            <div className="row small">
              <GearIcon icon={gear?.icon} />
              <select
                aria-label={`${slot} ${idx + 1}`}
                value={ref?.id ?? ''}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => set(e.target.value ? { id: e.target.value, rarity: ref?.rarity ?? 'common', tier: 0, level: ref?.level ?? 1 } : null)}
              >
                <option value="">— {slot} —</option>
                {[...data.gear.values()]
                  .filter((g) => g.slot === slot)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.s_rank ? ' ⭐S' : ''}
                    </option>
                  ))}
              </select>
              {ref && (
                <>
                  <select aria-label="Rarity" value={ref.rarity} onChange={(e) => set({ ...ref, rarity: e.target.value as Rarity, tier: 0 })}>
                    {cfg.rarities.gear.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  {maxTier > 0 && (
                    <select aria-label="Tier" value={ref.tier} onChange={(e) => set({ ...ref, tier: Number(e.target.value) })}>
                      {Array.from({ length: maxTier + 1 }, (_, t) => (
                        <option key={t} value={t}>
                          +{t}
                        </option>
                      ))}
                    </select>
                  )}
                  {gear?.shape === null ? (
                    <span className="badge err" title="Enter its shape in the Item editor">
                      needs shape
                    </span>
                  ) : copy < (placed.get(ref.id) ?? 0) ? (
                    <span className="badge" title="Placed in the bag">
                      in bag
                    </span>
                  ) : (
                    gear && (
                      <button className="small" onClick={() => onPlace(gear)} title="Put it in the bag">
                        Place
                      </button>
                    )
                  )}
                </>
              )}
            </div>
            {ref && <BonusInput ref_={ref} text={gear?.bonus?.text} known={weaponBonusValue(cfg, { ...ref, bonus_value: undefined }, !!gear?.s_rank)?.amount} onChange={(v) => set({ ...ref, bonus_value: v })} />}
          </div>
        );
      })}
    </>
  );
}

/**
 * A weapon's bonus stat as shown in game. It grows with rarity and tier and only some values are known
 * (config gear.bonus_stat_known), so any other one has to be typed in: red until it is.
 */
function BonusInput({ ref_, text, known, onChange }: { ref_: GearRef; text?: string; known?: number; onChange: (v: number | undefined) => void }) {
  if (!text) return null;
  const stat = text.replace(/\s*\+.*$/, '');
  const missing = ref_.bonus_value === undefined && known === undefined;
  return (
    <label className={`small ${missing ? 'field-error' : 'muted'}`} style={{ display: 'block', margin: '2px 0 0 26px' }} title={`Wiki: ${text} (base). The value grows with rarity and tier.`}>
      {stat} +
      <input
        type="number"
        min={0}
        step="0.01"
        aria-label={`${stat} bonus as shown in game`}
        placeholder={known !== undefined ? String(known) : 'in game?'}
        value={ref_.bonus_value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)))}
        style={{ width: 64, ...(missing ? { borderColor: 'var(--error)', background: 'var(--error-bg)' } : {}) }}
      />
      %{missing && <b> enter it: not applied until you do</b>}
      {!missing && ref_.bonus_value === undefined && <span> (known for {ref_.rarity} +{ref_.tier})</span>}
    </label>
  );
}

// ------------------------------------------------------------------ pets

export function petCost(data: GameData, id: string, stars: number): number {
  const pet = data.pets.get(id);
  if (!pet) return 0;
  return Math.max(0, pet.activation_cost + pet.star_effects.filter((s) => s.stars <= stars).reduce((a, s) => a + (s.activation_cost_delta ?? 0), 0));
}

/** Active pets' activation cost against the points every hero has per run. */
export function petPoints(data: GameData, profile: Profile): { used: number; max: number } {
  return { used: profile.pets.filter((p) => p.active).reduce((a, p) => a + petCost(data, p.id, p.stars), 0), max: data.config!.pets.activation_points };
}

export function PetsEditor({ data, profile, update, account = false }: { data: GameData; profile: Profile; update: Update; account?: boolean }) {
  const cfg = data.config!;
  const { used, max } = petPoints(data, profile);
  const sorted = sortPets([...data.pets.values()]);
  return (
    <>
      <div className={`meter${used > max ? ' over' : ''}`} title={`Active pets cost ${used} / ${max} points`}>
        <div style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
      </div>
      {profile.pets.map((pet, i) => {
        const def = data.pets.get(pet.id);
        const shown = def ? petSkillText(def.skill.text, def.star_effects, pet.stars) : null;
        return (
          <div key={i} style={{ marginTop: 4 }}>
            <div className="row small">
              <select
                value={pet.id}
                aria-label={`Pet ${i + 1}`}
                style={{ flex: 1, minWidth: 0 }}
                onChange={(e) => update((p) => void (p.pets[i] = { ...pet, id: e.target.value, stars: p.owned_pets.find((o) => o.id === e.target.value)?.stars ?? 0 }))}
              >
                {sorted.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.rarity.toUpperCase()} · {d.name}
                    {d.role === 'economy' ? ' — shop only' : ''}
                    {d.ignored ? ' — not simulated' : ''}
                  </option>
                ))}
              </select>
              <select value={pet.stars} aria-label="Pet stars" title="Your account's stars for this pet (the same in every build)" onChange={(e) => update((p) => void (p.pets[i]!.stars = Number(e.target.value)))}>
                {Array.from({ length: cfg.pets.max_stars + 1 }, (_, s) => (
                  <option key={s} value={s}>
                    {s}★
                  </option>
                ))}
              </select>
              <label title="Its skill is used this run (costs points)">
                <input type="checkbox" checked={pet.active} onChange={(e) => update((p) => void (p.pets[i]!.active = e.target.checked))} /> active
              </label>
              <span className="muted" title="Activation cost">
                {petCost(data, pet.id, pet.stars)} pt
              </span>
              <button aria-label="Remove pet" onClick={() => update((p) => void p.pets.splice(i, 1))}>
                ✕
              </button>
            </div>
            {def && shown && (
              <div className="small muted pet-text" title={[shown.text, ...shown.extra].join('\n')}>
                {def.skill.name}: {shown.text}
                {shown.extra.map((x) => (
                  <div key={x}>{x}</div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {profile.pets.length < cfg.pets.max_equipped && (
        <button
          style={{ marginTop: 6 }}
          onClick={() =>
            update((p) => {
              // Pets I own first.
              const pick = [...p.owned_pets.map((o) => o.id), ...sorted.map((d) => d.id)].find((id) => data.pets.has(id) && !p.pets.some((x) => x.id === id)) ?? sorted[0]!.id;
              p.pets.push({ id: pick, stars: p.owned_pets.find((o) => o.id === pick)?.stars ?? 0, active: true });
            })
          }
        >
          Add pet
        </button>
      )}
      {account && <div className="small muted" style={{ marginTop: 4 }}>Stars are your account's (also in the Profile tab): the same in every build.</div>}
    </>
  );
}

// ------------------------------------------------------------------ skins

export const skinFor = (skin: Skin, hero: Hero | undefined) => {
  const a = skin.available;
  return !!hero && !!a && (a.all || (a.classes ?? []).includes(hero.class) || (a.heroes ?? []).includes(hero.id));
};

/** The skins this build's hero can bring (up to 2), each with its stars and whether its quest is done. */
export function SkinsEditor({ data, profile, update, account = false }: { data: GameData; profile: Profile; update: Update; account?: boolean }) {
  const hero = profile.active_hero ? data.heroes.get(profile.active_hero) : undefined;
  const equipped = profile.equipped_skins ?? [];
  const all = [...data.skins.values()].filter((s) => s.skill && !s.enemy_only);
  // The ones this hero can use, plus any brought that it can't (so they can be taken off).
  const shown = all.filter((s) => skinFor(s, hero) || equipped.includes(s.id));
  if (!hero) return <div className="small muted">Pick a hero to see the skins they can use.</div>;
  if (shown.length === 0) return <div className="small muted">No skin skill is available to {hero.name}.</div>;
  return (
    <>
      {shown.map((s) => {
        const on = equipped.includes(s.id);
        const stars = profile.skins?.find((x) => x.id === s.id)?.stars ?? 0;
        return (
          <div key={s.id} style={{ marginTop: 4 }}>
            <div className="row small">
              <label className="check-line" style={{ flex: 1, minWidth: 0 }} title={`${s.skill!.reward}${s.skill!.by_grade ? `\nBy grade: ${s.skill!.by_grade}` : ''}\nQuest: ${s.skill!.quest}`}>
                <input
                  type="checkbox"
                  aria-label={`Bring ${s.name}`}
                  disabled={!on && equipped.length >= 2}
                  checked={on}
                  onChange={(e) =>
                    update((p) => {
                      p.equipped_skins = (p.equipped_skins ?? []).filter((x) => x !== s.id);
                      p.skin_quests_done = (p.skin_quests_done ?? []).filter((x) => x !== s.id);
                      if (e.target.checked) {
                        p.equipped_skins = [...p.equipped_skins, s.id].slice(0, 2);
                        // Bringing a skin means owning it.
                        if (!(p.skins ?? []).some((x) => x.id === s.id)) p.skins = [...(p.skins ?? []), { id: s.id, stars }];
                      }
                    })
                  }
                />
                <span>
                  <b>{s.skill!.name}</b> <span className="muted">({s.name})</span>
                  {s.status === 'shop' && <span className="muted"> · shop only</span>}
                  {s.status === 'needs_values' && <span className="warn"> · not simulated</span>}
                </span>
              </label>
              <select aria-label={`${s.name} stars`} title="Your account's stars for this skin (the same in every build)" value={String(stars)} onChange={(e) => update((p) => void (p.skins = [...(p.skins ?? []).filter((x) => x.id !== s.id), { id: s.id, stars: Number(e.target.value) }]))}>
                {Array.from({ length: 6 }, (_, k) => (
                  <option key={k} value={k}>
                    {k}★
                  </option>
                ))}
              </select>
              <label title="The skill only works once its quest is done in the run (some quests the bag meets by itself)">
                <input
                  type="checkbox"
                  aria-label={`${s.name} quest done`}
                  disabled={!on}
                  checked={on && (profile.skin_quests_done ?? []).includes(s.id)}
                  onChange={(e) =>
                    update((p) => {
                      const list = (p.skin_quests_done ?? []).filter((x) => x !== s.id);
                      p.skin_quests_done = e.target.checked ? [...list, s.id] : list;
                    })
                  }
                />{' '}
                quest
              </label>
            </div>
            {on && !skinFor(s, hero) && <div className="small warn">Not available to {hero.name}: it does nothing with this hero.</div>}
          </div>
        );
      })}
      {account && <div className="small muted" style={{ marginTop: 4 }}>Which skins this build brings is saved with it; their stars are your account's (also in the Profile tab).</div>}
    </>
  );
}

// ------------------------------------------------------------------ stats

/** HP, ATK and Block as typed in, and every other stat as calculated from gear, blessings and auras. */
export function BuildStats({ data, profile, update, account: mine = false, readOnly = false, open }: { data: GameData; profile: Profile; update: Update; account?: boolean; readOnly?: boolean; open?: boolean }) {
  const account = computeAccountStats(data, profile, profile.active_hero);
  const fmtStat = (n: number) => String(Math.round(n * 100) / 100);
  const stats = [...data.stats.values()];
  const shown = stats.filter((s) => s.group === 'detailed' && s.id !== 'hp_pct' && s.id !== 'atk_pct').filter((s) => (account.detailed[s.id] ?? 0) !== 0);
  return (
    <>
      {mine && <div className="small muted">HP, ATK and Block are your account's (Profile tab), as the game's Stat Details screen shows them: the same in every build.</div>}
      <div className="row small" title="As the game's Stat Details screen shows them">
        {stats
          .filter((s) => s.group === 'basic')
          .map((s) => {
            const key = s.id === 'initial_block' ? 'initial_block' : (s.id as 'hp' | 'atk');
            return (
              <label key={s.id} className="muted">
                {s.name === 'Initial Block' ? 'Block' : s.name}{' '}
                {readOnly ? <b>{String(profile.basic_stats[key])}</b> : <AbbrevInput label={s.name} value={profile.basic_stats[key]} onCommit={(v) => update((p) => void (p.basic_stats[key] = v))} width={70} />}
              </label>
            );
          })}
      </div>
      <details style={{ marginTop: 6 }} open={open}>
        <summary className="small">
          Calculated stats <span className="muted">({shown.length}, from gear, blessings and auras)</span>
        </summary>
        <table className="stats" aria-label="Calculated stats">
          <tbody>
            {shown.map((s) => (
              <tr key={s.id}>
                <td title={s.notes}>{s.name}</td>
                <td>
                  {fmtStat(account.detailed[s.id] ?? 0)}
                  {s.unit === 'pct' ? '%' : ''}
                </td>
                <td className="small muted">
                  {[s.default ? `base ${s.default}` : '', ...account.parts.filter((p) => p.stat === s.id).map((p) => `${p.label} ${p.amount >= 0 ? '+' : ''}${fmtStat(p.amount)}`)].filter(Boolean).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      {account.notes.map((n) => (
        <div key={n} className="issue warning small">
          {n}
        </div>
      ))}
    </>
  );
}
