# Wiki data — review status

Problems found while transcribing the wiki on 2026-10-15, and what was decided. **Answers live in [corrections.md](corrections.md)**, which overrides the other files.

## Resolved

| Topic | Decision | Where |
|---|---|---|
| Vamp / Regen values | Wiki's 0.01x HP is wrong; use **0.005x HP** | statuses.md, SPEC §5.3 |
| Spike / Burn / Poison values | Wiki's 0.01x ATK is wrong; use **0.1x ATK** | statuses.md, SPEC §5.3 |
| Spells with no cooldown | They only fire when another item activates them; some spells (e.g. Thunder Dragon) also have their own cooldown | SPEC §4.5 |
| Berserk | +1 stack every 1 s; enemy only in chapters, both sides in PvP; accuracy +0, +5, +10…; DMG adds to All DMG | statuses.md, SPEC §7.6 |
| Missing items | Big Spike, Steel Spike, Lithinum, Lithinum Greatshield, Spirit Stone, Erwen's Bow, Fire Spirit, Wind Spirit, Greatdog added with rarity and price; Fusion Magic: Frost Edge doesn't exist | corrections.md §1 |
| Shape / effect fixes | Plate Helmet, Spiked Gloves, Golden Pig, Spider Fang, Maestro | corrections.md §2 |
| Tags / recipes | No-damage spells (Ignite, Instant Freeze, Charm, Drizzle, Deluge, Spell Amplification, Ice Shield) are Tools, not Weapons; True Sight made from Tracker's Bow + Hawk Feather Talisman | corrections.md §2 |
| Spirit tag | Only items tagged `Spirit` count for Erwen's effects (Frost Spirit and Blazing Spirit don't) | corrections.md §5 |
| Pet Golem | Ignored (no trigger on the wiki, not worth implementing) | corrections.md §4 |
| Elderwood Bow | Skill and gear effect columns were swapped | corrections.md §2 |
| Name variants | Gigantization, That's Mine!, Fairy Bow, Divine Grace are the canonical names | corrections.md §3 |
| Blessing values | Spark → Stun Rate; Venom Mythic → −0.6s; Erwen's two blessings named by effect | corrections.md §3 |
| Merge-recipe columns | "Made from" is the source of truth (37 recipes aren't mirrored in "Merges into") | — |
| Image file misspellings | `Spell_Theif`, `Mithril_Ignot`, `Meow_Missle`, etc. are only image names; item names are correct | — |
| Copy-paste errors in items.md | Clone Potion's effect was Fairy Dust's (real effect: 0.15x HP heal every 5.5s + low-HP Dodge/heal); Deluge renamed **Heavy Rain** and merges into nothing; Flame Robe is made from Leather Armor + Blazing Hound; Large Crow costs 15 | corrections.md §2, §3, §6 |
| Hero count | 23 playable heroes (wiki's 26 includes 2 skins and 1 unknown) | — |

## Still open

- [ ] **Wiki "%" damage that is really flat:** Maestro's "+60% DMG" is actually +0.6x ATK. Other items may have the same problem; check as you go.
- [ ] **Values to observe in-game** (`x` on the wiki):
  - Pets: White Wolf Captain, Jellyfish Princess, Yeti, Flora, Racoon, Sheep, Pink Slime, Hedgehog, Polar Bear (Golem is ignored)
  - Hero skills [LATER]: Bjorn *Flesh Burst*, Darkan *Price of the Pact*, Rebecca *Courage to Protect All*
- [ ] Wiki prices of `?` (20 items: pet-spawned, Fairy Dragon, 13 hero-exclusive) are set to 0.

## Notes

- **Unique blessings** exist for every hero except Fighter, Archer, and Mage (the wiki's "Epic/Legendary only" text is wrong; its table is right).
- **Gear-specific mechanics** to define as custom statuses: *Frostbite* (Everfrozen), *Divine Grace* (Divine Smite), *Charge* (Omnicleaver), *Scream* (Deathrattle), *Wish* (Meteor Hammer), *Skill Gauge* (Thunderbolt Spike, Flowing Blade, Prince's Dagger), *Waterdrop Cushion* (pet Seiren).
- **No item is marked Special Shop** on the Items page.
