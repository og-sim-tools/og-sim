# Data history: comments from the old wiki / manual layer files

Kept when the layers were merged into one database per category (2026-11-07). The files themselves are in git history (before that commit).

## items/manual/corrections.yaml

```
# My confirmed fixes and additions, from docs/wiki-data/corrections.md.
# Same id as a wiki entry = override field by field. `replaces:` = rename a wiki entry.
# ---------------------------------------------------------------- §1 items missing from the wiki
# Observed with HP 6.9M, ATK 696.3K.
# ---------------------------------------------------------------- §2 corrections to wiki items
# Observed with HP 6.9M, ATK 696.3K unless noted.
# Mithril Ingot: the wiki's "For each [dot] Armor" (user confirmed 2026-10-17).
# Hero's Circlet is ## (user, 2026-10-17; the wiki shows #).
# The three wizard hats are ## / oo (user, 2026-10-17; the wiki shows ## / ## / oo).
# Widow Spider is ## / ## / oo (user, 2026-10-22; the wiki shows oo / ##).
```

## items/manual/effects_batch_1.yaml

```
# Structured item effects — batch 1 (SPEC §5.2). AWAITING REVIEW: verified: false until confirmed.
#
# Scope: "Start of Battle" flat % bonuses to the items under an item's dots (haste, damage,
# accuracy, crit damage). Each effect's `text` is the exact part of effect_text it encodes.
# Items marked "partial" have other effect parts that are still text only (later batches).
#
# Left out of this batch on purpose (questions in the phase 3 summary):
#   rope_trap, spiked_gloves, boulder — "slowed by N%": negative haste or a Freeze-like multiplier?
#   miracle_sword — "[dot] Armor Increase DMG by 25%": armor doesn't deal damage.
#   lance — "This item and [dot] Weapon gain 10% haste": once at start, or on every hit?
#   greatsword, mithril_ingot, anvil, plate_armor, … — "per [dot] X" counts (batch 2).
```

## items/manual/effects_batch_2.yaml

```
# Structured item effects — batch 2 (SPEC §5.2). AWAITING REVIEW: verified: false until confirmed.
#
# Scope: what the combat MVP can run — spell activation, statuses on hit / at start, block,
# heals, block removal, extra attacks, cooldown refunds, multi-hit. Each effect's `text` is the
# exact part of effect_text it encodes. Items marked "partial" still have text-only parts.
#
# Assumptions to check (also in the phase 5 summary):
#   - "Every Ns" on tools (HP Potion, Venomous Insect, …) is treated as the item's cooldown, like
#     you confirmed for Steel Spike, so haste and Freeze change it.
#   - "Attack 2 times" / "Attacks two times" = 2 hits per attack (stats.hits).
#   - "Start of Battle: Attack" = one extra attack at battle start that doesn't touch the cooldown.
# ---------------------------------------------------------------- spell activation
# ---------------------------------------------------------------- statuses on hit
# ---------------------------------------------------------------- statuses and block at the start of battle
# ---------------------------------------------------------------- heals and timed tools ("Every Ns" = cooldown, see top)
# ---------------------------------------------------------------- block removal, multi-hit, once per battle
# ---------------------------------------------------------------- extra attacks and refunds
```

## items/manual/effects_batch_3.yaml

```
# Structured item effects — batch 3 (SPEC §5.2). AWAITING REVIEW: verified: false until confirmed.
#
# Scope: phase 6 mechanics — Stun, timed statuses, Heal Amount Reduction, per-stack bonuses,
# cleanse / remove / steal, damage reduction, "On Attacked: chance to reduce DMG taken", and the
# pet-spawned items (eggs hatching, spiders and bugs). Each `text` is the exact part of effect_text.
#
# Assumptions to check (also in the phase 6 summary):
#   - "within 3s hatches": hatches at exactly 3 s. (confirmed)
#   - "Every Ns" on items without a cooldown = their cooldown (same rule as batch 2).
#   - Heal Amount Reduction "15%" = 15 stacks of heal_amount_reduction (1% each); it behaves like a stat
#     and can't be cleansed or stolen. (confirmed)
#   - Broom "Cleanse Remove 5 random debuff(s)" = cleanse 5 removable debuff stacks; Bloody Crown "Remove
#     Buff Steal 5 random buff(s)" = steal 5. (confirmed)
# ---------------------------------------------------------------- pet-spawned items
# ---------------------------------------------------------------- Stun
# ---------------------------------------------------------------- timed statuses and Heal Amount Reduction
# ---------------------------------------------------------------- bonuses per status stack
# ---------------------------------------------------------------- cleanse / remove / steal
# ---------------------------------------------------------------- damage reduction, blood
```

## items/manual/effects_batch_4.yaml

```
# Effects batch 4 (2026-10-17): the spike and dodge archetypes (Bjorn spikes, Raven dodge). Structured from the
# wiki text; unverified until checked in game.
```

## items/manual/effects_batch_5.yaml

```
# Effects batch 5 (2026-10-17): every item effect not simulated before, structured from the wiki text.
# Unverified until checked in game. Readings the text doesn't settle carry an `assumption` (shown in battle).
# Lists replace earlier ones whole, so partly done items repeat their existing effects here.
# ---------------------------------------------------------------- universal / economy
# ---------------------------------------------------------------- warrior weapons
# ---------------------------------------------------------------- warrior armor / tools
# ---------------------------------------------------------------- universal tools / potions / creatures
# ---------------------------------------------------------------- ranger
# ---------------------------------------------------------------- wizard: staffs, hats, robes
# ---------------------------------------------------------------- wizard: spells
```

## items/manual/effects_spirits.yaml

```
# Erwen's Spirits (corrections.md §1 text), structured. Unverified reading: "for 10s, inflict 12 Burn"
# = 12 Burn that lasts 10s; "gain 10 Swift for 10s" likewise. The [Spirit] Burn Inflict & Swift Gain
# blessing raises both (item_inflict_statuses).
```

## items/manual/images.yaml

```
# Item sprite images from the wiki (tools/fetch-icons.ts, 2026-10-16). image_size is the sprite's native pixel size.
```

## items/manual/observed_2026-10-17.yaml

```
# Seen in game (user screenshots, 2026-10-17; ATK 1.61M, HP 5.29M as Trixie). In-game values beat the wiki.
```

## items/manual/observed_2026-11-06.yaml

```
# Seen in game (user, 2026-11-06). In-game values beat the wiki.
```

## items/manual/skin_spawn.yaml

```
# Items a skin skill puts in the bag (user's screenshots, 2026-10-17).
# Sprite redrawn by hand from the user's in-game screenshot (2026-11-06): tools/sprites/blood_moon_familiar.py.
```

## items/manual/values_2026-10-17.yaml

```
# Item values the wiki showed as ? (user, in game, 2026-10-17). Pet-spawned items are worth 0.
```

## gear/manual/corrections.yaml

```
# My confirmed fixes, from docs/wiki-data/corrections.md. Same id = override field by field.
# Shapes, dots and weapon basic attacks still need entering for every gear piece (item editor, phase 4).
# ---------------------------------------------------------------- S-rank weapons (tags from me, corrections.md §7)
# ---------------------------------------------------------------- other weapons (type from the name)
# Type not obvious from the name — only `weapon` until confirmed.
```

## gear/manual/effects_batch_1.yaml

```
# Structured gear effects — batch 1 (SPEC §4.5, §5.2). AWAITING REVIEW: verified: false until confirmed.
#
# Skills, gear effects and rarity effects of all 38 gear pieces, from data/gear/wiki/gear.yaml (+ my
# corrections). Each `text` is the exact line it encodes. Shapes, dots and basic attacks still need
# entering by hand; nothing here depends on them except "[dot]" lines, which reach whatever the dots cover.
#
# Rules used throughout (assumptions to check):
#   A1. The gear effect is always on. A rarity line that repeats it (S-rank "uncommon" lines, ring
#       "rare" lines) is the same effect, not a second copy.
#   A2. Plain stat lines (ATK +25%, Crit DMG +35%, Block Gain +20%, Stun Rate +20%, Healing power
#       +20%, Freeze Inflict +20%, Attack DMG +25%, DMG against Stunned enemies +50%, HP …) are already
#       in Stat Details and are not applied again.
#   A3. "On Basic Attack Hit" / gear "On Hit" = the gear's own basic attack (on_hit, watch self);
#       "On Skill Hit" = its skill hits; "On [dot] Weapon Hit" = weapons under its dots.
#   A4. "X, additionally Y" at a higher rarity = a second effect on top (totals add up).
#   A5. Skills "Activates every 8 seconds" = 8 s timer; "Deal 3.0x ATK DMG" = 3.0 × ATK.
#   A6. "Refunds 25% Skill Charge" on a timer skill = the 8 s timer jumps forward 25% (2 s).
# Lines still text-only are listed in each entry's notes.
# ================================================================ S-rank weapons
# cast_s: user, 2026-11-06 (in game): the skill hit lands 1.2 s after the 8 s timer (9.2 s, 17.2 s …).
# ================================================================ other weapons (skill 1.5x ATK every 8 s)
# ================================================================ shields
# ================================================================ rings (cooldown and damage need entering as basic_attack)
# ================================================================ gloves ("+2 [dot] Slots" at epic needs extra dots — see notes)
```

## gear/manual/icons.yaml

```
# Small gear icons (Gear-Icon-*.png, 24x24) from the wiki, shown next to gear names in lists (tools/fetch-icons.ts, 2026-10-16).
```

## gear/manual/images.yaml

```
# Gear in-bag sprites (Gear-Ingame-*.png) from the wiki (tools/fetch-icons.ts, 2026-10-16). image_size is the sprite's native pixel size.
```

## gear/manual/rings_gloves.yaml

```
# Ring and glove setup from my rules (2026-10-16). Constant for every piece, so set here rather than one by one.
# Rings: weapon tag, 1x ATK, 6 s base cooldown (S-rank shows 4.5 s: S gear is epic+, so the rare -1.5 s always applies), 85% accuracy, 0% crit, 1 hit, 1x1.
# Gloves: armor tag, o#o below epic, oo#oo from epic ("+2 [dot] Slots"). The editor (user_edits.yaml) still wins over this file.
```

## gear/manual/stat_lines.yaml

```
# Gear stat lines, structured from the wiki text in rarity_effects / bonus_stat (generated once, then hand-kept).
# Stats are calculated from gear, blessings and auras (user, 2026-10-16): each equipped piece adds its
# stat_lines up to its rarity, and its bonus (the in-game value typed on the weapon, or config gear.bonus_stat_known).
```

## gear/manual/user_edits.yaml

```
# Written by the item editor (SPEC §8.2). Same id as a wiki entry = override field by field.
# Safe to hand-edit. Loaded after the other manual/ files, so these edits win.
```

## heroes/manual/skill_effects.yaml

```
# Hero skills in battle (SPEC §4.6, built 2026-10-16 on request). The active hero's own two skills
# and the skills in their link slots run as effects. Wiki text only, so everything is unverified;
# readings I had to choose are in each skill's notes.
# status: complete · partial (part of the text isn't simulated) · shop (no battle effect) ·
#         needs_values (the wiki text has no numbers: _x_ / x?).
# ---------------------------------------------------------------- Ranger
# Purple: Venom's slots (user, 2026-10-19). From the skill text: "Randomly enhance 2 slots".
# ---------------------------------------------------------------- Warrior
# ---------------------------------------------------------------- Wizard
# Green: Cecilia's slot (user, 2026-10-19). From the skill text: "Enhance 1 random slot(s)".
```

## blessings/manual/corrections.yaml

```
# My confirmed fixes, from docs/wiki-data/corrections.md §3. `replaces:` renames a wiki entry.
```

## blessings/manual/skill_mods.yaml

```
# How unique blessings change their hero skill (2026-10-17). The blessing value from the profile is added to
# (or scales) the skill number named by `path`. Values are additive like most things in the game (user).
# The Build tab counts them: Poison Coating's 2 slots + this value (2026-10-19).
```

## blessings/manual/stats.yaml

```
# Which Stat Details stat each blessing raises (SPEC §4.3, §4.6). My mapping — unverified.
# Blessings with a `stat` are already counted in Stat Details, so the simulator never adds them.
# Tag blessings ([Sword] Weapon DMG, …) map to a tag stat ([Sword] DMG Increase) that adds to items with that tag,
# like [Creature] DMG Increase. Skill buffs are [later]; conditional bonuses use combat_bonus.
# Tag blessings → tag stats (item_tags in data/stats.yaml)
# Unique (hero bonus) blessings that are plain stats
# Conditional unique blessings: a battle-only bonus while the condition holds. "DMG" read as All DMG.
```

## pets/manual/battle_effects.yaml

```
# Pet skills in battle, structured from the in-game text in observed_batch_{1,2,3}.yaml (2026-10-16).
# One effect per star tier: min_stars / max_stars pick the version that applies at the pet's stars.
# Star lines always add to the skill's value (user rule). Pets ignore Haste / Freeze (timers are fixed).
# Readings of texts that need one are listed in docs/item-readings.md (confirmed by the user's in-game data, 2026-10-17).
# Red Dragon's effects are in observed_batch_1.yaml.
```

## pets/manual/corrections.yaml

```
# My decisions, from docs/wiki-data/corrections.md §4.
```

## pets/manual/observed_batch_1.yaml

```
# In-game screenshots, batch 1 (2026-10-16), taken with HP 4.35M / ATK 701.8K. Text copied as shown.
# Overrides the wiki field by field (star_effects is replaced whole).
# Pets are unaffected by Haste/Freeze; only damage and status modifiers apply to them (user, 2026-10-16).
```

## pets/manual/observed_batch_2.yaml

```
# In-game screenshots, batch 2 (2026-10-16), HP 4.35M / ATK 701.8K. Star lines copied as shown.
# Skill text is stored at 0★ base: shown values include the user's unlocked stars, which are backed out.
# Pets are unaffected by Haste/Freeze; only damage and status modifiers apply to them.
```

## pets/manual/observed_batch_3.yaml

```
# In-game screenshots, batch 3 (2026-10-16), HP 4.35M / ATK 701.8K. Star lines copied as shown.
# Skill text is stored at 0★ base: shown values include the user's unlocked stars, which are backed out.
# Where a star line repeats a value the skill text shows (Hunting Hawk pattern), the two add.
```

## pets/manual/spawns.yaml

```
# Pets that put items into the bag (SPEC §4.5), from the wiki's pet text. Unverified.
# 2026-11-06 (user): "Base Cooldown decreases by 2s" is the cooldown of the spiders hatched from the egg sacks,
# small and big (same cooldown): 6s → 4s.
```

## auras/manual/ownership.yaml

```
# Aura ownership effects from in-game screenshots (2026-10-16): 0★ amount, then 1★–7★.
# The aura's own level bonus (Lv 25 shows HP +30% / ATK +30%) isn't included yet.
```

## skins/manual/upcoming.yaml

```
# Upcoming skins from the user's in-game screenshots (2026-10-17). Each star row (1★ … 5★) adds to the 0★ reward.
```

## skins/manual/wiki_skins.yaml

```
# Hero skins from the wiki hero pages (Skins section), read 2026-10-17 by hand (data/skins/wiki/ is only for generated files). The slash-separated "by grade"
# numbers are what each star (1★ … 5★) adds on top of the 0★ skill, so a 3★ skin has the 0★ value plus
# the first three numbers (the same reading as the in-game star rows in the user's screenshots).
# Ownership effects are ignored (already in my Stat Details, SPEC §1).
# "Summer" skins: the wiki says "Not obtainable; appears as an enemy". No skill.
```

## statuses/manual/gear_mechanics.yaml

```
# Named, gear-specific mechanics defined as statuses (SPEC §4.5), from the wiki's gear and pet
# text. The rules are written out here; values come from the wiki and are unverified.
# Skill Gauge isn't a status: it's built into gear skills (skill.gauge + the charge_skill action).
```

## statuses/manual/observed.yaml

```
# My observations and rules for statuses (SPEC §5.3, docs/wiki-data/statuses.md "Simulator" column).
# These override the wiki values field by field.
```

## enemies/manual/examples.yaml

```
# Example enemies to try the simulator with. MADE UP — not from the game.
# Replace or add real enemies here (or type one into a layout's battle settings).
```

## enemies/manual/raid.yaml

```
# The raid boss (user, 2026-10-20). PLACEHOLDER: the real boss isn't entered yet, so it's a stand-in that
# can't be beaten and barely fights back. You attack for 15 s, take weak hits worth about 4.5% of your max HP
# over the whole fight (0.3% a second), and are defeated when time is up (config modes.raid: timeout_kills).
# What a raid result is about is the damage dealt.
# Berserk would raise its hits past the 5% the user asked for; whether raids have Berserk isn't known.
# SPEC §7.5: a raid boss can't die, ignores Execute and is immune to damage based on its HP; the boss
# Final DMG multiplier applies.
# Its picture: the Dragon item, as a placeholder.
```
