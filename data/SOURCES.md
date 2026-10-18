# Data sources

Log of everything taken from the wiki or other websites: date, URL, what was extracted, and which data files changed.

## 2026-10-15 — wiki-data docs converted to YAML (no web fetch)

No website was contacted. `tools/wiki-to-yaml/convert.ts` converted the markdown in `docs/wiki-data/`, which was transcribed from the wiki on 2026-10-15. Every generated entry has `source: wiki`, its page URL, and `verified: false`.

| Wiki page | Extracted | Data files |
|---|---|---|
| https://overgearedhero.fandom.com/wiki/Items | 222 items (28 universal, 58 warrior, 66 ranger, 64 wizard, 6 pet-spawned): rarity, tags, stats, effect text, footprint, value, merges into, made from, hero-exclusive marks | `data/items/wiki/*.yaml` |
| https://overgearedhero.fandom.com/wiki/Gear | 38 gear pieces (slot, S-rank, bonus stat, skill, gear effect, effects by rarity); 6 auras | `data/gear/wiki/gear.yaml`, `data/auras/wiki/auras.yaml` |
| https://overgearedhero.fandom.com/wiki/Heroes and the 23 hero pages | 23 heroes: class, rarity, base Supply Ability, skills, skill links, exclusive items, supplies by star, skins | `data/heroes/wiki/*.yaml` |
| https://overgearedhero.fandom.com/wiki/Dragon's_Blessing | 13 common, 9 class, 40 unique blessings with values per rarity; slots by level | `data/blessings/wiki/*.yaml`, `data/config.yaml` (`blessings.slots_by_level`) |
| https://overgearedhero.fandom.com/wiki/Pets | 28 pets: rarity, activation cost, active skill, star effects | `data/pets/wiki/pets.yaml` |
| https://overgearedhero.fandom.com/wiki/Stats_and_Effects | 13 statuses (7 buffs, 6 debuffs), wiki numbers kept as written; 70 enemy traits | `data/statuses/wiki/statuses.yaml`, `data/enemy_traits/wiki/enemy_traits.yaml` |

My corrections (`docs/wiki-data/corrections.md`, the "Simulator" notes in statuses.md, and SPEC §5.3) went into `data/*/manual/` with `source: observed` or `manual`. They aren't from the web.

## 2026-10-16 — wiki pages read in the in-app browser (WebFetch is blocked with HTTP 402)

| Wiki page | Extracted | Data files |
|---|---|---|
| https://overgearedhero.fandom.com/wiki/Stats_and_Effects | Read only, to check Burn: "On Attacked, 50% chance to take 0.01x ATK DMG per Burn stack" (matches our copy; 0.1x stays per corrections). Nothing new on status crits. | none |
| https://overgearedhero.fandom.com/wiki/Gear | Read only: Primal Flame / Archwizard's Ring text matches our copy (Primal Flame bonus stat "Crit Rate +12.5%"). Later: the 38 gear icon file names (Gear-Icon-*.png, 24×24, 7.5 KB total). | none yet |
| https://overgearedhero.fandom.com/wiki/Items | The 222 item sprite file names and sizes (pixel art, 9–41 px wide, 44.9 KB total, largest 484 bytes). Not downloaded yet. | none yet |

## 2026-10-16 — item sprites and gear icons downloaded (user approved)

`tools/fetch-icons.ts` downloaded the original PNGs from `https://static.wikia.nocookie.net/backpack-arena/images/…/revision/latest?format=original` (the plain URL serves WebP). 259 files, 128.5 KB.

| Source | Extracted | Data files |
|---|---|---|
| https://overgearedhero.fandom.com/wiki/Items (sprite in each item row) | 221 item sprites, native pixel size kept | `data/images/items/<id>.png`, `data/items/manual/images.yaml` (`image`, `image_size`, `source: wiki`, `verified: false`) |
| https://overgearedhero.fandom.com/wiki/Gear (Gear-Icon-*.png) | 38 gear icons, 24×24 (the wiki has no in-bag gear sprites) | `data/images/gear/<id>.png`, `data/gear/manual/images.yaml` |

Not matched: the wiki's "Transformation Magic: Deluge" (our data: "Transformation Magic: Heavy Rain" — same item?). No sprite on the wiki: Lithinum, Lithinum Greatshield, Erwen's Bow, Big Spike, Steel Spike, Greatdog, Fire Spirit, Wind Spirit, Spirit Stone.
Misspelled wiki file names (item names are right; files kept as named): Spell_Theif, Hat_Theif, Mithril_Ignot, Crow_at (Crow Hat), Fusion_Magic-_LIghtning_Storm, Intermediate_Magic-_Magic_Missle, Meow_Missle, Giant_Spike_Club, Stone (Rock), Pile_of_Coins (Pile of Gold).

## 2026-10-16 — in-bag gear sprites and the missing item sprites

Found with the wiki API (`https://overgearedhero.fandom.com/api.php?action=query&list=allimages`), downloaded with `tools/fetch-icons.ts --list` (48 files, 22.9 KB, original PNGs).

| Files | Extracted | Data files |
|---|---|---|
| Gear-Ingame-*.png (38) | The in-bag gear sprites (e.g. Primal Flame 13×45, Celestial Shield 13×29); they replace the 24×24 Gear-Icon menu icons | `data/images/gear/<id>.png`, `data/gear/manual/images.yaml` |
| Fire_Spirit, Wind_Spirit, Spirit_Stone, Erwen's_Bow, Lithinum, Lithinum_Greatshield, Big_Spike, Steel_Spike, Greatdog (.png) | Sprites for the 9 items from corrections.md | `data/images/items/<id>.png`, `data/items/manual/images.yaml` |
| Transformation_Magic-_Deluge.png | Used for Transformation Magic: Heavy Rain (user confirmed the wiki's "Deluge" is Heavy Rain) | same |

Every item (231) and gear piece (38) now has a sprite.

## 2026-10-16 — small gear icons downloaded again

The 38 Gear-Icon-*.png menu icons (24×24, 19 KB, original PNGs), now kept separately from the in-bag sprites and shown next to gear names in lists: `data/images/gear_icons/<id>.png`, `data/gear/manual/icons.yaml` (`icon`, `source: wiki`, `verified: false`).

## 2026-10-16 — Items and Gear pages re-checked against the data

Fetched with the wiki API (`https://overgearedhero.fandom.com/api.php?action=parse&page=Items` and `page=Gear`, page HTML only) and searched with `action=query&list=search` for the 10 items in corrections.md. Parsed every table row and compared it field by field with `data/items/wiki/*.yaml` and `data/gear/wiki/*.yaml`.

| Page | Extracted | Result |
|---|---|---|
| Items (222 rows: Universal 28, Warrior 58, Ranger 66, Wizard 64, Pet 6) | Name, grade, every tag, Attack DMG ratio, cooldown, accuracy, value, footprint with dots, effect text, merge recipes, components | Rarity, tags, ratio, cooldown, accuracy, value and footprint match for all 222. Differences are text only: icons the wiki shows without a word (e.g. "Gain 10 {Focus}"), 7 flavour lines we left empty (Training Sword, Club, Training Bow, Pile of Gold, Fire Bolt, Fireball, Energy Bolt), and the corrections in `data/items/manual/` |
| Gear (38 rows) | Bonus stat, skill, gear effect, effect by grade, the grade/tier table | All match. The page says nothing about how the bonus stat grows with tier |
| Search for the 10 corrections.md items | Which pages mention them | Only hero pages (Erwen, Bjorn, Barbarian …), no item rows |

Correction (same day): the recipe icons named **Stone**, **Pile of Coins** and **Mithril Ignot** are image-file names for Rock, Pile of Gold and Mithril Ingot, which are all on the page and in the data. Mithril Ingot's effect: per [dot] **Armor**, as on the wiki (user confirmed 2026-10-17), structured in `data/items/manual/corrections.yaml`.

## 2026-10-17 — hero skins (all 23 hero pages)

Read in the browser (the wiki refuses plain fetches): `https://overgearedhero.fandom.com/wiki/<Hero>` for all 23 heroes, the **Skins** section only (skin name, grade, how it's obtained, ownership effect, skin skill quest / reward / skill by grade, "Available").

| Hero page | Skin | Extracted |
|---|---|---|
| Bjorn | Little Valcan Bjorn (Epic) | Behela!!: shop rates only (Red Dust +15%, Anvil −15%; +5/5/5/5/15% by grade). Available: Bjorn |
| Rebecca | Red Sun Rebecca (Legendary) | Change of Sides: Start of Battle, all Legendary [Sword] attack 1 time each, repeated for each Legendary [Sword]; +1/1/1/1/1 attacks by grade. Available: Warrior |
| Erwen | Romantic Date Erwen (Epic) | Gift for Uncle: shop rates only (Hawk's Claw +15%, Venomous Insect −15%). Available: Ranger |
| Venom | Missha Karlstein (Legendary) | Glacial Beast Skadia: on inflicting 30 Poison or on [Sword] hit, 5 Freeze for 3 s (+1 per grade); Poison Crit Rate and Crit DMG +0.5% per enemy Freeze stack. Available: Ranger |
| Lua | Summer Vacation Lua (Legendary) | Focus anywhere!: on [Bow] hit 25% chance, Beach Ball = 50% of Attack DMG; hit enemies take +5% Weapon Crit DMG (+5/5/5/5/5% by grade). **Available: Erwen** (as written) |
| Cecilia | Arua Raven (Legendary) | Sunspot Sphere: cast after 20 s, damage grows with debuff stacks it removes; Final DMG +50/50/50/100/150% by grade. **No base numbers on the page** |
| Feline Mage | Cool Splash Meow Mage (Legendary) | YOLO Wizard: coins only (+3, then +2/2/3/2/3). Available: All Heroes |
| Rose, Darkan, Talin, Trixie | Summer | "Not obtainable; appears as an enemy", no skill |
| Kai, Spearman, Barbarian, Fighter, Raven, Acrobat, Sniper, Archer, Spark, Fire Mage, Ice Mage, Mage | — | No skins on the page |

Unclear or possibly wrong: Lua's skin says "Available: Erwen"; Cecilia's skin is named "Arua Raven" (spelled as on the wiki); Sunspot Sphere has no damage numbers; Bjorn's quest spells "Lithinum Greatshield" as the wiki does.

Data changed: `data/skins/manual/wiki_skins.yaml` (new, `source: wiki`, `verified: false`). The upcoming skins (Raven, Apostle of Death; Eternal Red Moon Rose with the Blood Moon Familiar; Dream Eater Trixie) come from the user's screenshots: `data/skins/manual/upcoming.yaml`, `data/items/manual/skin_spawn.yaml` (`source: observed`).

User answers (2026-10-17): Lua's skin is Lua only (the wiki's "Available: Erwen" is wrong; `available` changed to Lua). "Arua Raven" is correct: Cecilia's skin is a collab with the manhwa Rafdonia.

## 2026-10-17 — values and numbers from the user (in game, 5.53M HP / 1.65M ATK)

No web fetch. Item values the wiki showed as ?: Fairy Dragon 17, Red Rose Rapier 13, Red Rose 6, Knight's Order Banner 7, Shadow Hunter 32, Spider Fang 4, Black Feather 7, Adrenaline 4, Millennium Dragon 15, Meow Missile 12; every pet-spawned item 0 (`data/items/manual/values_2026-10-17.yaml`). Longsword was already 8. Hero's Longsword (Kai exclusive on the wiki) is still unknown: the user didn't recognise it. Arua Raven's Sunspot Sphere deals 49.64M (30x ATK), then 74.47 / 99.29 / 124.1 / 173.7 / 248.2M at 1★–5★ (`data/skins/manual/wiki_skins.yaml`); the bonus per removed debuff is still unknown. Deep Impact: +165.4K (0.1x ATK) per Burn, as already entered. Gigantization's blessing raises the All DMG at the cap and keeps the HP needed for it (`data/blessings/manual/skill_mods.yaml`). The item readings in `docs/item-readings.md` were checked against the user's screenshots and their warnings removed; True Sight's +80% Crit DMG now lasts once 40 Focus is reached.

User correction (2026-10-18): Flora 2★ + two legendary Forest Keeper's Gloves show 70% Debuff Resist in game, so Flora gives +30% at every star level (`data/pets/manual/battle_effects.yaml`; it was +60% at 2★).
