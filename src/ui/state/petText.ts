/**
 * A pet's skill text at its star level: unlocked star lines that change a number in the skill text
 * ("increases its DMG dealt by an additional 10% of the enemy's Max HP") are folded into that number;
 * the rest are returned to show underneath. Generic text rules, not per pet.
 */
interface Rule {
  /** Matches the star line; group 1 is the amount. */
  line: RegExp;
  /** Where the number in the skill text is (group 1 = the number). */
  target: (m: RegExpMatchArray) => RegExp;
  op: 'add' | 'sub' | 'mul_pct';
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUM = '(\\d+(?:\\.\\d+)?)';

const RULES: Rule[] = [
  // "an additional 10% of the enemy's Max HP" / "additional DMG equal to 5% of the enemy's Max HP"
  { line: new RegExp(`additional (?:DMG equal to )?${NUM}% (of [^.]+)`, 'i'), target: (m) => new RegExp(`${NUM}% ${esc(m[2]!)}`, 'i'), op: 'add' },
  // "'s Haste increases by an additional 15%"
  { line: new RegExp(`Haste increases by an additional ${NUM}%`, 'i'), target: () => new RegExp(`${NUM}% Haste|Haste \\+${NUM}%`, 'i'), op: 'add' },
  // "reduces … HP Recovery by an additional 20%"
  { line: new RegExp(`HP Recovery by an additional ${NUM}%`, 'i'), target: () => new RegExp(`${NUM}% Reduction`, 'i'), op: 'add' },
  // "Inflicts an additional 6 Poison"
  { line: new RegExp(`inflicts an additional ${NUM} (\\w+)`, 'i'), target: (m) => new RegExp(`${NUM} ${esc(m[2]!)}`, 'i'), op: 'add' },
  // "summons 4 additional Egg Sack(s)" / "summons 2 additional Egg(s)"
  { line: new RegExp(`summons ${NUM} additional`, 'i'), target: () => new RegExp(`summons ${NUM}`, 'i'), op: 'add' },
  // "Gain 5 additional Spike"
  { line: new RegExp(`Gain ${NUM} additional (\\w+)`, 'i'), target: (m) => new RegExp(`${NUM} ${esc(m[2]!)}`, 'i'), op: 'add' },
  // "increase Block gained (from) by 0.05x HP"
  { line: new RegExp(`Block gained (?:from )?by ${NUM}x HP`, 'i'), target: () => new RegExp(`${NUM}x HP Block`, 'i'), op: 'add' },
  // "Heal an additional 0.02x HP"
  { line: new RegExp(`Heal an additional ${NUM}x HP`, 'i'), target: () => new RegExp(`Heal ${NUM}x HP`, 'i'), op: 'add' },
  // "increases the duration of Burn it inflicts by 5s"
  { line: new RegExp(`duration of \\w+ it inflicts by ${NUM}s`, 'i'), target: () => new RegExp(`for ${NUM}s`, 'i'), op: 'add' },
  // "Lets you merge 1 more item(s)"
  { line: new RegExp(`merge ${NUM} more`, 'i'), target: () => new RegExp(`merge ${NUM}`, 'i'), op: 'add' },
  // "Will Remove 2 more buff(s)" / "Remove 5 more buff(s)"
  { line: new RegExp(`Remove ${NUM} more buff`, 'i'), target: () => new RegExp(`Remove ${NUM} more buff`, 'i'), op: 'add' },
  // "base Cooldown decreases by 1s"
  { line: new RegExp(`Cooldown decreases by ${NUM}s`, 'i'), target: () => new RegExp(`Every ${NUM}s`, 'i'), op: 'sub' },
  // "Stun Rate increases by 50%"
  { line: new RegExp(`Stun Rate increases by ${NUM}%`, 'i'), target: () => new RegExp(`${NUM}% chance to Stun`, 'i'), op: 'add' },
  // "DMG dealt increases by 50%" → × 1.5 on "Nx ATK"
  { line: new RegExp(`DMG dealt increases by ${NUM}%`, 'i'), target: () => new RegExp(`${NUM}x ATK`, 'i'), op: 'mul_pct' },
  // "Haste increases by an additional" is above; "Max Activation Count increases by 5"
  { line: new RegExp(`Max Activation Count increases by ${NUM}`, 'i'), target: () => new RegExp(`Activates ${NUM} time`, 'i'), op: 'add' },
  // "'s duration increases by 5s"
  { line: new RegExp(`'s duration increases by ${NUM}s`, 'i'), target: () => new RegExp(`for ${NUM}s`, 'i'), op: 'add' },
];

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

export function petSkillText(skillText: string, starLines: { stars: number; text: string }[], stars: number): { text: string; extra: string[] } {
  let text = skillText;
  const extra: string[] = [];
  for (const s of starLines) {
    if (s.stars > stars) continue;
    let merged = false;
    for (const rule of RULES) {
      const m = s.text.match(rule.line);
      if (!m) continue;
      const amount = Number(m[1]);
      const target = rule.target(m);
      const t = text.match(target);
      if (!t) continue;
      const groupIndex = t.slice(1).findIndex((g) => g !== undefined) + 1;
      const old = Number(t[groupIndex]);
      const next = rule.op === 'add' ? old + amount : rule.op === 'sub' ? old - amount : old * (1 + amount / 100);
      const whole = t[0];
      text = text.replace(whole, whole.replace(t[groupIndex]!, fmt(next)));
      merged = true;
      break;
    }
    // Activation cost lines change the cost, shown on its own.
    if (!merged && !/activation cost/i.test(s.text)) extra.push(`${s.stars}★: ${s.text}`);
  }
  return { text, extra };
}
