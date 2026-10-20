/** First-run guide: how to get from an empty account to a battle. Shown until dismissed; the "?" button brings it back. */

const KEY = 'og-sim/guide-done';

export const guideDone = {
  get: (): boolean => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  },
  set: (done: boolean) => {
    try {
      if (done) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* a convenience only */
    }
  },
};

interface Props {
  /** The account owns no heroes yet. */
  empty: boolean;
  /** "This browser" or the project's files: where saves go. */
  savedIn: string;
  onProfile: () => void;
  /** Ask to start the guided tour. */
  onTour: () => void;
  onClose: () => void;
}

export function Guide({ empty, savedIn, onProfile, onTour, onClose }: Props) {
  return (
    <section className="panel guide" aria-label="How to use the simulator">
      <div className="panel-head">
        <h2>How to use the simulator</h2>
        <button aria-label="Close the guide" onClick={onClose}>
          ✕
        </button>
      </div>
      <p className="small">It plays your backpack the way the game does, so you can try builds and enemies before you spend coins. New here? The tour shows you every part and lets you fill in your profile on the way.</p>
      <ol className="small">
        <li>
          <b>Profile tab:</b> type HP / ATK / Block as the game's Stat Details screen shows them, tick the heroes you own (stars, blessings), and set your pets', skins' and
          auras' stars. This counts for every build.
        </li>
        <li>
          <b>Build tab, left:</b> pick the build's hero, gear, pets and skins.
        </li>
        <li>
          <b>Build tab, right:</b> click an item to put it in the bag, or drag it. Click it in the bag to select it, again to rotate it; <b>Item details</b> shows what it does
          and what it's worth. The Starting equipment tab has what your hero can bring.
        </li>
        <li>
          <b>Battle tab:</b> pick an opponent (a monster, one of your builds, or one you type in) and press <b>Run battle</b>.
        </li>
        <li>
          <b>Build box</b> (top): the Temp build is for trying things; Save it under a name to keep it. Saves are kept in {savedIn}; <b>Export account</b> (top right)
          downloads everything as a backup you can import later.
        </li>
      </ol>
      <div className="row">
        <button className="primary" onClick={onTour}>
          Take the tour
        </button>
        {empty && <button onClick={onProfile}>Start in the Profile tab</button>}
        <button onClick={onClose}>Got it</button>
      </div>
    </section>
  );
}
