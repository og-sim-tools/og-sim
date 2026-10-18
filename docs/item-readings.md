# Item readings

Every item and gear effect is simulated. These are the readings of texts the wiki didn't settle; all of them were checked against the user's in-game screenshots (2026-10-17), so none shows an "Assumption" warning any more. Flat numbers in the game (e.g. "161.5K" at 1.61M ATK) are stored as ratios of ATK or HP.

- **Advanced Magic: Meteor**: +0.1x ATK damage per Burn stack on the enemy.
- **Beast Hunter**: "DMG scales with enemy HP, up to 100%" — +100% DMG at the enemy's full HP, falling with the enemy's HP.
- **Blood Frenzy**: every 15% of max HP lost (from anything) adds +0.5x ATK damage, stacking.
- **Cleric's Gloves**: "HP Heal effect increases by 25%" = Healing Power +25% for all healing.
- **Flame Robe**: below 30% HP, one heal of 0.01x Max HP if the enemy has Burn (there's only one enemy), once per battle.
- **Fusion Magic: Deep Impact**: +0.1x ATK damage per Burn stack on the enemy (165.4K per Burn at 1.65M ATK).
- **Hourglass**: +0.1x ATK [dot] Weapon damage for each type of debuff cleansed (user confirmed).
- **Ice Spear Staff**: 0.1x ATK of Block removed per Freeze, so 1.0x ATK for its 10 Freeze.
- **Lightning Gloves**: up to +15% haste at full HP, falling as HP falls; mythic adds 20 points (35%).
- **Maestro**: on attack, hastes the [dot] Creatures by 7% and then activates every [dot] Spell (no Creature needed).
- **Midwinter Brush**: "inflict 5 Freeze" on the enemy when there's no Poison to cleanse.
- **Miracle Sword**: +25% DMG for this sword per Armor under its dots (like Greatsword).
- **Spear**: the Spear itself gains 6% haste per hit.
- **Staff of the Sage**: Spell Burn and Freeze +20% for the Spells under its dots.
- **Staff of Vitality**: Healing Power +25% per skill activation, stacking for the rest of the battle; "excess healing" = overheal.
- **Thunder Dragon**: +7% Crit DMG each time my side stuns the enemy, stacking; always crits while the enemy is stunned.
- **True Sight**: the +80% Crit DMG starts the first time I reach 40 Focus and then lasts the whole battle ("Once 40 Focus Reached").
- **Witch's Mirror**: gains the Block whenever my side removes enemy buffs (not only this mirror's removals). Spending enemy debuffs (Instant Freeze's 25 Freeze) doesn't count.

## Pets

Every battle pet is simulated (only Geezer, Mimic, Mini Mimic and Goblin Scientist are shop-only). Readings, confirmed by the user's in-game data:

- **Seiren**: "healed amount" on Excess Heal = the overheal; "When entering Berserk" fires when the fight's Berserk starts.
- **Hunting Hawk** (5★): the extra steal comes after the removal, from whichever of Focus / Dodge has more then.
- **Ice Reaper**: every enemy heal counts (Regen ticks too); at 5★ the second activation on Berserk adds the Healing Reduction and 15 Freeze again (they stack).
- **Phoenix**: "Fastest weapon" = shortest cooldown at that moment, Haste included.
- **Yeti**: any resisted Stun counts, not only during the immunity.
- **Flora**: Debuff Resist is +30% at every star level (user, 2026-10-18: Flora 2★ + two legendary Forest Keeper's Gloves = 70%, so the 2★ line "increases Debuff Resist by 30%" doesn't add another 30). 5★ "HP Heal effect +30%" = Healing Power +30% for all healing.
- **Tiger**: "All Weapon DMG" = Attack DMG Increase; the 5★ Item Haste goes to all items.
- **Raccoon** (2★): the 10% enemy Max HP part is a separate, fixed (effect) damage hit.
- **Brown Wolf**: "Strongest weapon" = highest damage per attack (base × hits) at the start of battle.

Still flagged in battle: only the Blood Moon Familiar's shape (the skin isn't released).

Shop-only items (Reroll Sale Card, Shop VIP / VVIP Card, the shop parts of Golden Pig and Piggycalibur) do nothing in battle. Divine Smite's "Block from the previous round" never triggers, because the simulator runs one battle, not a run of rounds.
