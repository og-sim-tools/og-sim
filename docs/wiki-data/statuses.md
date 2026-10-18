# Stats, statuses and effects

_Transcribed from the Overgeared Hero wiki ([Stats_and_Effects](https://overgearedhero.fandom.com/wiki/Stats_and_Effects)) on 2026-10-15. Wiki data is unverified; see REVIEW.md for known problems._

Where my in-game observations disagree with the wiki, the **Simulator** note wins.

**General rules (mine, not on the wiki):** stacks last the whole battle unless applied with a duration; a chance (e.g. 50%) is rolled once for all stacks; Poison and Regen tick on a global 2 s timer from battle start; all damage hits Block before HP (except Rose’s *Impale*).


## Hero Stats

| Name | Description | Simulator |
|---|---|---|
| ATK | All damage scales with ATK and uses the hero's total ATK value to determine how much damage they deal. |  |
| HP | HP determines how much damage a hero or enemy can take before being defeated. Its total value also determines how much healing effects scale. |  |
| Block | Block acts as an additional defensive value that absorbs incoming damage before HP is lost. You start with Initial Block and can gain more during battle from armor, shields, and other defensive items. |  |

## Weapon Stats

| Name | Description | Simulator |
|---|---|---|
| Attack DMG | The amount of damage dealt by the weapon. |  |
| Cooldown | Determines how quickly the weapon attacks or applies effects. |  |
| Accuracy | Higher Accuracy reduces the chance of missing an attack. |  |
| Crit Rate | Crit Rate determines the chance for the weapon to land a critical hit. Crit Rate starts at 0% unless increased by an item or effect. Critical hits deal 200% damage by default, and Crit DMG can be increased separately. |  |

## Effects

| Name | Description | Simulator |
|---|---|---|
| Coin | Indicates effects that generate, grant, or otherwise interact with Coins. |  |
| Critical Hit | An attack that deals increased damage when a critical hit occurs. |  |
| DMG Increase | Increases the damage dealt by the affected attack, item, or effect. |  |
| Block Gain | Increases the amount of Block gained. |  |
| Max HP Increase | Increases maximum HP. |  |
| Item Haste | Increases item activation speed. |  |
| Heal | Restores HP. |  |
| Extra Attack | Causes an additional attack or hit. |  |
| Cooldown Return | Refunds or reduces an item or weapon's current Cooldown. |  |
| Block Remove | Removes Block from the target. |  |

## Buffs

| Name | Description | Simulator |
|---|---|---|
| Focus | Gain 1% Accuracy per Focus stack. |  |
| Dodge | Dodge Rate increases by 1% per Dodge stack.<br>_Enemy weapon Accuracy cannot be reduced below 25%._ |  |
| Swift | Items activate 1% faster per Swift stack. |  |
| Vamp | On Hit, 50% chance to Heal 0.01x HP per Vamp stack. | Simulator uses **0.005x HP** per stack (observed 20.0K at 4M HP). Wiki's 0.01x is wrong. |
| Regen | Every 2s, Heal 0.01x HP per Regen stack. | Simulator uses **0.005x HP** per stack (observed: 6 stacks healed 7.24M on 241.6M HP). Wiki's 0.01x is wrong. |
| Spike | On Attacked, 50% chance to deal 0.01x ATK DMG per Spike stack. | Simulator uses **0.1x ATK** per stack (wiki says 0.01x — typo; observed 61.1K at 610.9K ATK). |
| Invincible | Take no DMG. Ignore all enemy attacks. |  |

## Debuffs

| Name | Description | Simulator |
|---|---|---|
| Poison | Take 0.01x ATK DMG every 2s per Poison stack. | Simulator uses **0.1x ATK** of the inflicter per stack (wiki says 0.01x — typo). |
| Burn | On Attacked, 50% chance to take 0.01x ATK DMG per Burn stack. | Simulator uses **0.1x ATK** of the inflicter per stack (wiki says 0.01x — typo). |
| Freeze | Items activate 1% slower per Freeze stack. |  |
| Stun | Item Cooldown does not progress. |  |
| Heal Amount Reduction | Reduces HP Healing from items, Vamp, and Regen by the listed percentage.<br>_Increasing healing amount can counter this value._ |  |
| Seal | Temporarily prevents a sealed weapon or item from functioning. |  |

## Resistance & Immunity

| Name | Description | Simulator |
|---|---|---|
| All Debuff Resist | Reduces Burn, Poison, and Freeze received by the listed percentage. |  |
| Burn Resistance | Reduces Burn received or applied to the target. |  |
| Poison Resistance | Reduces Poison received or applied to the target. |  |
| Freeze Resistance | Reduces Freeze received or applied to the target. |  |
| Stun Resistance | Chance for the target to be stunned is reduced. |  |
| Burn Immunity | The target is immune to Burn. |  |
| Poison Immunity | The target is immune to Poison. |  |
| Freeze Immunity | The target is immune to Freeze. |  |
| Stun Immunity | The target is immune to Stun. |  |
| Weapon Attack Immunity | Weapon Attack damage taken is reduced to 1. |  |
| Spike Immunity | Spike damage taken is reduced to 1. |  |

## Damage Modifiers

| Name | Description | Simulator |
|---|---|---|
| Attack DMG Reduction | Reduces DMG taken from weapon attacks by the listed percentage.<br>_DMG taken cannot be reduced below 25%._ |  |
| Burn DMG Reduction | Reduces DMG taken from Burn. |  |
| Poison DMG Reduction | Reduces DMG taken from Poison. |  |
| Spike DMG Reduction | Reduces DMG taken from Spike. |  |
| DMG Reduction | Reduces DMG taken from Weapon attacks, Burn, Poison, and Spike by the listed percentage.<br>_DMG taken cannot be reduced below 25%._ |  |
| Attack DMG Vulnerability | Increases DMG taken from weapon attacks. |  |
| Burn Vulnerability | Increases DMG taken from Burn. |  |
| Poison Vulnerability | Increases DMG taken from Poison. |  |
| Spike Vulnerability | Increases DMG taken from Spike. |  |
| Critical Hit Vulnerability | Increases DMG taken from Critical Hits. |  |

## Removal & Cleansing

| Name | Description | Simulator |
|---|---|---|
| Cleanse Debuff | Upon activation remove random debuff(s). |  |
| Remove Buff | Upon activation remove random buff(s). |  |
| Remove Block | Removes Block from the target. |  |

## Berserk (from my observations; not on the wiki)

- Starts when the battle timer reaches **10.00 s**.
- **Who:** only the enemy in chapter modes (Stage, Gauntlet, Boss Rush); both sides in PvP.
- Stack 1: **+25% DMG, +25% Item Haste, +0% Accuracy**.
- **+1 stack every 1 s**; each stack adds **+5** to each of those (stack 2: +30% / +30% / +5%).
- The DMG bonus adds to All DMG Increase.
- Enemies with the trait **Short Time Limit** never go berserk.

## Enemy traits (70)  — [LATER]

Descriptions only. A trait with several variants lists them separated by “ / or: ”.


### General Combat

| Trait | Description |
|---|---|
| Standard Enemy | A standard enemy with no notable traits. |
| Faster Standard Enemy | A standard enemy that attacks slightly faster. |
| Critical Hit | The enemy's attacks can land as Critical Hit. |
| High Accuracy | The enemy's weapon has high Accuracy. |
| Multi-Hit Attacks | The enemy's weapon DMG is low, but hits multiple times per attack. |
| Accelerating Attacks | The enemy's attacks become faster over time. / or: The enemy becomes faster over time. |
| Fast Start | The enemy Attacks very quickly, but slows down over time. |
| Fast at High HP | It attacks quickly at first, but grows weaker as it loses HP. |

### Healing & Recovery

| Trait | Description |
|---|---|
| Continuous Healing | The enemy continuously Heals HP. / or: The enemy continuously Heals. |
| Regen | Enemies with Regen continuously Heal. |
| Vamp | The enemy has Vamp, triggering Heal on attack. |
| Heal Amount Reduction | Enemies Heal Amount Reduction the recovery of the Hero. |
| Heal Reduction Weakness | Enemies are somewhat susceptible to Heal Amount Reduction. |
| Extreme Heal Reduction Weakness | Enemies are highly vulnerable to Heal Amount Reduction. |

### Block & Defense

| Trait | Description |
|---|---|
| Massive HP | The enemy has very high Max HP and DMG Reduction. |
| Massive Block | At start of battle, the enemy gains a large amount of Block. |
| Block Gain | The enemy gains Block. |
| Block Damage | The enemy's weapon deals additional DMG to your Block. |
| Block Damage Reduction | DMG taken greatly reduced while enemy Block is maintained. |
| Block Damage Increase | While Block is maintained, DMG dealt gradually increases. / or: Enemy DMG dealt increases while they have Block. |
| HP-to-Block Conversion | The enemy continuously converts a portion of current HP into additional Block. |
| Debuff Resistance | The enemy's Debuff Resist is very high. |
| Continuous Cleanse | The enemy continuously Cleanses debuffs. |
| Debuff Resistance & Cleanse | The enemy has high Debuff Resist and continuously Cleanses debuffs. |

### Dodge & Evasion

| Trait | Description |
|---|---|
| Dodge | The enemy has Dodge, occasionally evading attacks. |
| Continuous Dodge Gain | The enemy continuously gains Dodge, making Attacks harder to land. / or: The enemy continuously gains Dodge. |
| High-Dodge DMG Increase | When the enemy has 40 or more Dodge stacks, DMG dealt by the enemy increases significantly. |
| Dodge Counterattack | The enemy evades the Hero's attack and sometimes strikes back with a stronger attack. / or: The enemy evades the Hero's attack and strikes back with a stronger attack. |

### Status Effects & Control

| Trait | Description |
|---|---|
| Poison Attacks | Enemies inflict Poison on Hero. |
| Burn Attacks | Enemies inflict Burn on Hero. |
| Freeze Attacks | The enemy inflicts Freeze on the Hero. |
| Continuous Freeze | The enemy continuously inflicts Freeze on the Hero. |
| Freeze Threshold DMG Increase | Enemies deal greater DMG when Hero's Freeze stacks reach 20 or more. |
| Stun Attacks | Getting hit by the enemy's Hammer will Stun you. |
| Stun Strike | Enemies Stun the Hero with powerful attacks. |
| Stun Scaling DMG | DMG dealt increases each time the enemy Stuns the Hero. |
| Seal | When hit, has a chance to Seal the Hero's Weapon for a set duration. |
| Buff Steal | The enemy continuously steals the Hero's buffRemove Buff ,<br>When your buff is removed, DMG dealt by the enemy increases. |

### Resistance & Immunity

| Trait | Description |
|---|---|
| Burn Resistance | The enemy is resistant to Burn, inflicting reduced Burn DMG. |
| Poison Resistance | The enemy is resistant to Poison, inflicting reduced Poison DMG. |
| Freeze Resistance | The enemy is resistant to Freeze, inflicting reduced Freeze DMG. |
| Stun Resistance | Chance for enemies to be stunned is reduced. |
| Burn Immunity | This enemy is immune to Burn. |
| Poison Immunity | This enemy is immune to Poison. |
| Freeze Immunity | This enemy is immune to Freeze. |
| Stun Immunity | This enemy is immune to Stun. |
| Weapon Attack Immunity | Always takes only 1 DMG from Attack DMG weapon attacks. |
| Spike Immunity | DMG taken from Spike becomes 1. |

### Vulnerabilities & Damage Modifiers

| Trait | Description |
|---|---|
| Multi-Hit Weakness | Whenever the enemy gets hit 10 times, the enemy takes DMG based on its Max HP. |
| Burn Vulnerability | Increase DMG taken by Burn. |
| Poison Vulnerability | The enemy's DMG taken from Poison is significantly increased. / or: Increase DMG taken by Poison. |
| Spike Vulnerability | The enemy attacks quickly and DMG dealt by Spike increases significantly. / or: Increase DMG taken by Spike. |
| Freeze-Stack Vulnerability | Whenever hit by Attack DMG , takes extra DMG proportional to Freeze stacks. |
| Critical Hit Vulnerability | DMG taken from Critical Hits is greatly increased. |
| Weapon Attack Vulnerability | DMG taken from Attack DMG weapon attacks is increased. |
| Weapon DMG Reduction | The enemy takes significantly reduced DMG from Weapon attacks. / or: Enemies take reduced DMG from weapon attacks. |
| Non-Poison Damage Reduction | The enemy takes significantly reduced DMG from sources other than Poison. |
| Spike DMG Reduction | DMG taken from Spike is reduced. |

### Conditional & Triggered Effects

| Trait | Description |
|---|---|
| Spike | The enemy has Spike, dealing counter DMG when attacked. |
| Spike Counterattack | The enemy has Spike, so you take counterattack DMG whenever you attack.<br>Also, the enemy gains Spike whenever they attack. |
| Low-HP Punish | This enemy strikes the moment its opponent weakens. Be careful not to let your HP drop to half or below. |
| Low-HP Critical Hit | Delivers critical attacks to weakened enemies. You must keep your HP high. |
| Block Counterattack | If Block exists, being attacked triggers a counterattack that inflicts various Debuff effects. |
| Non-Crit Seal | Whenever hit by an attack that is not Critical Hit, Seal the attacking Attack DMG weapon temporarily. |
| Burn Counterattack | Whenever taking DMG, counterattacks to inflict Burn. |
| Burn Counter & Overheal Cleanse | If the opponent has Block, counterattacks cannot inflict Burn, and whenever the opponent overheals, they cleanse Burn. |
| Low-HP Invincibility | When HP is low, temporarily becomes Invincible. |
| Unseal on Invincibility | Every time the Invincible state is entered, weapons with Seal are unsealed. |

### Encounter Rules

| Trait | Description |
|---|---|
| Immortal Raid Boss | This enemy cannot die. Ignores _if your stacks exceed the opponent's current HP %, Execute the opponent._ effects and is immune to DMG based on HP. |
| Short Time Limit | Battle Time Limit is short, and it does not go berserk. |
