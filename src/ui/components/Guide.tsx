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
      <p className="small">It plays your backpack the way the game does, so you can try builds and enemies before you spend coins. New here? The tour shows you every part in about two minutes.</p>
      <ol className="small">
        <li>
          <b>Profile tab:</b> tick the heroes you own and set their stars, and your auras. This counts for every build.
        </li>
        <li>
          <b>Hero box</b> (right): pick the hero, its blessings, gear, pets and skins, and type HP / ATK / Block as the game's Stat Details screen shows them.
        </li>
        <li>
          <b>Items</b> (left): drag items into the bag, or click one and move it with the arrow keys (space rotates, enter places). The Starting equipment tab has what
          your hero can bring. Click an item in the bag to see what it does and what it's worth.
        </li>
        <li>
          <b>Battle</b> (middle): pick an enemy (or type one in, or copy one of your builds as a player) and press <b>Run battle</b>.
        </li>
        <li>
          <b>Build box:</b> save the build. Saves are kept in {savedIn}; <b>Export account</b> (top right) downloads everything as a backup you can import later.
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
