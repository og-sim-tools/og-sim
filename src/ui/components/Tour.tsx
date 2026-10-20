/**
 * A guided tour: dims the page, highlights one area at a time ([data-tour="…"]), says what it's for, and
 * switches tabs as it goes. Next / Back / Skip tour; arrow keys move, Escape skips. On "try it" steps the
 * highlighted area can be used (filling in the profile during the tour); everything else stays blocked.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface TourStep {
  /** The tab to show for this step. */
  tab?: string;
  /** [data-tour] of the area to highlight; none = a card in the middle. */
  target?: string;
  title: string;
  text: string;
  /** The highlighted area can be clicked and typed in during this step. */
  interactive?: boolean;
}

interface Props {
  steps: TourStep[];
  onTab: (tab: string) => void;
  onClose: () => void;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const CARD_W = 340;

function placeCard(box: Box | null, cardH: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampLeft = (x: number) => Math.max(12, Math.min(vw - CARD_W - 12, x));
  if (!box) return { top: Math.max(12, vh / 2 - cardH / 2), left: clampLeft(vw / 2 - CARD_W / 2) };
  const below = box.top + box.height + PAD + 10;
  if (below + cardH < vh - 12) return { top: below, left: clampLeft(box.left) };
  const above = box.top - PAD - 10 - cardH;
  if (above > 12) return { top: above, left: clampLeft(box.left) };
  // Tall area: beside it if there's room, else over its bottom corner.
  const right = box.left + box.width + PAD + 10;
  if (right + CARD_W < vw - 12) return { top: Math.max(12, Math.min(vh - cardH - 12, box.top)), left: right };
  const left = box.left - PAD - 10 - CARD_W;
  if (left > 12) return { top: Math.max(12, Math.min(vh - cardH - 12, box.top)), left };
  return { top: vh - cardH - 12, left: clampLeft(vw - CARD_W - 12) };
}

export function Tour({ steps, onTab, onClose }: Props) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(180);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i]!;
  const last = i === steps.length - 1;

  // Show the step's tab, then find its area (once the tab has drawn) and keep the highlight on it while the
  // page scrolls or resizes. A timer, not animation frames: those pause in a background tab.
  useEffect(() => {
    if (step.tab) onTab(step.tab);
    let scrolled = false;
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
      if (el && !scrolled) {
        scrolled = true;
        el.scrollIntoView?.({ block: 'nearest' });
      }
      const r = el?.getBoundingClientRect();
      setBox((old) => {
        const next = r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: Math.min(r.height, window.innerHeight - 24) } : null;
        return JSON.stringify(old) === JSON.stringify(next) ? old : next;
      });
    };
    measure();
    const timer = window.setInterval(measure, 150);
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in the highlighted area isn't a tour key.
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(steps.length - 1, n + 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, steps.length]);

  const pos = placeCard(box, cardH);
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label="Tutorial">
      {/* Catches clicks so the page doesn't change under the tour (around the area only, on "try it" steps). */}
      {box && step.interactive ? (
        <>
          <div className="tour-block" style={{ top: 0, left: 0, right: 0, height: Math.max(0, box.top - PAD) }} />
          <div className="tour-block" style={{ top: box.top + box.height + PAD, left: 0, right: 0, bottom: 0 }} />
          <div className="tour-block" style={{ top: box.top - PAD, left: 0, width: Math.max(0, box.left - PAD), height: box.height + 2 * PAD }} />
          <div className="tour-block" style={{ top: box.top - PAD, left: box.left + box.width + PAD, right: 0, height: box.height + 2 * PAD }} />
        </>
      ) : (
        <div className={`tour-dim${box ? '' : ' full'}`} />
      )}
      {box && <div className="tour-spot" style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD }} />}
      <div ref={card} className="tour-card panel" style={{ top: pos.top, left: pos.left, width: CARD_W }}>
        <div className="small muted">
          {i + 1} / {steps.length}
        </div>
        <h2>{step.title}</h2>
        <p className="small">{step.text}</p>
        {step.interactive && <p className="small muted">Try it: the highlighted box works while the tour is open.</p>}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="small" onClick={onClose}>
            Skip tour
          </button>
          <span className="row">
            {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
            <button className="primary" onClick={() => (last ? onClose() : setI(i + 1))}>
              {last ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** The tour of the whole app, tab by tab. */
export const APP_TOUR: TourStep[] = [
  { tab: 'bag', title: 'Welcome!', text: 'This tour walks you through every part of the simulator, tab by tab, and lets you fill in your profile on the way. It takes a few minutes, and you can skip it at any time (or press Escape).' },
  { target: 'topbar.tabs', title: 'The tabs', text: 'Build is where you make a bag. Battle fights it against an opponent. Optimize improves a build for you. Profile is your account. Item editor and Data are for fixing game data.' },
  { tab: 'profile', target: 'profile.stats', interactive: true, title: 'Your stats', text: "Start here: type HP, ATK and Block as the game's Stat Details screen shows them. They're the same in every build; everything else is calculated." },
  { tab: 'profile', target: 'profile.heroes', interactive: true, title: 'Your heroes', text: "Tick every hero you own and set their stars. Open a hero to enter its Dragon's Blessings and skill links. All of this is your account: it saves itself and counts in every build." },
  { tab: 'profile', target: 'profile.pets', interactive: true, title: 'Pets', text: 'Set the stars of the pets you own. A build picks which ones it brings.' },
  { tab: 'profile', target: 'profile.skins', interactive: true, title: 'Skins', text: 'Set the stars of the skins you own. A build brings up to 2 of their skills.' },
  { tab: 'profile', target: 'profile.auras', interactive: true, title: 'Auras', text: 'Set the stars of the auras you own: their bonuses add to every build.' },
  { tab: 'bag', target: 'battle.build', title: 'Your builds', text: "The Temp build is a scratch build for trying things: it isn't in your list until you Save it under a name. In the list, the pencil renames a build, the green arrow saves what you're editing over it and the red bin deletes it. Preview bag shows each build's bag. Import / Export share one build as a file." },
  { tab: 'bag', target: 'battle.hero', title: 'Hero and blessings', text: 'Pick the hero for this build. Its blessings (up to 5) are the ones from your Profile.' },
  { tab: 'bag', target: 'battle.gear', title: 'Gear', text: 'Choose your weapon, shield, rings and gloves with their rarity and tier, then press Place to put each one in the bag.' },
  { tab: 'bag', target: 'battle.pets', title: 'Pets', text: 'Up to 3 of your pets. Tick "active" for the ones whose skill you use; the bar shows the 5 points every run has.' },
  { tab: 'bag', target: 'battle.skins', title: 'Skins', text: 'The skin skills this hero can use: bring up to 2, and tick "quest" once the quest is done in the run.' },
  { tab: 'bag', target: 'battle.items', title: 'Items', text: 'Find items by name, kind, class or tag, and sort them by name, value or rarity (hover Rarity for one rarity only). Click an item to put it straight in the first free spot, or drag it. The Starting equipment tab has what your hero can bring.' },
  { tab: 'bag', target: 'battle.bag', title: 'The bag', text: "Click an item to select it, click it again (or press space) to rotate it, use the arrows to move it; space also turns an item while you drag it. Item details shows its numbers and what it's worth. Drag items to the storage beside the bag while you rearrange; drag one out of the Bag box to remove it. Bag picks your class's bag size." },
  { tab: 'bag', target: 'battle.checks', title: 'Checks', text: "Problems with the build show up here (overlaps, too much starting equipment, missing values), plus a note when the game data it uses isn't confirmed in game yet." },
  { tab: 'battle', target: 'battle.mode', title: 'Battle: Arena, Raid or Chapter', text: 'Arena: your build against another build. Raid: 15 s against the raid boss, scored by the damage you deal. Chapter: pick a chapter and one of its enemies.' },
  { tab: 'battle', target: 'battle.me', title: 'Battle: you', text: "Your bag, with its hero, blessings, gear, pets, skins and auras. Drag items to try another arrangement (Keep it or Undo). Detailed stats shows every stat and every item's numbers." },
  { tab: 'battle', target: 'battle.opponent', title: 'Battle: the opponent', text: "Who you fight: a build in the Arena, the raid boss, or a chapter enemy (chapters' enemies aren't entered yet, so you pick a stand-in)." },
  { tab: 'battle', target: 'battle.fight', title: 'Fight', text: "Press Run battle; set Runs above 1 for a win rate. Your breakdown and the opponent's show side by side." },
  { tab: 'optimize', target: 'optimize.settings', title: 'Optimize', text: 'Tick saved builds to test against, then Run: it tries moves, rotations and item swaps within your coin budget and keeps the build that scores best.' },
  { tab: 'editor', target: 'editor.head', title: 'Item editor', text: 'Fix or add game data: item shapes and dots, stats and effects. Monster items are for giving a typed-in enemy a bag.' },
  { tab: 'data', target: 'data.about', title: 'Data', text: "What the simulator loaded: problems, entries not confirmed in game yet, and every correction to the wiki's numbers." },
  { tab: 'bag', target: 'topbar.account', title: 'Back up your account', text: 'Your saves live in this browser. Export account downloads everything as one file; Import account brings it back on any browser or computer.' },
  { tab: 'bag', target: 'topbar.tutorial', title: "That's it!", text: 'You can take this tour again any time with the Tutorial button.' },
];
