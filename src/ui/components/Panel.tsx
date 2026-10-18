/** A box with a title and a chevron in its top-right corner to fold it away (remembered in this browser). */
import { type ReactNode, useState } from 'react';

const KEY = 'og-sim/folded/';

function readFolded(id: string): boolean {
  try {
    return localStorage.getItem(KEY + id) === '1';
  } catch {
    return false;
  }
}

interface Props {
  /** Remembers whether it's folded; no id = can't be folded. */
  id?: string;
  title: ReactNode;
  /** Shown next to the title (counts, a short status). */
  aside?: ReactNode;
  /** Buttons at the right of the title bar, before the chevron. */
  tools?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Panel({ id, title, aside, tools, className = '', children }: Props) {
  const [folded, setFolded] = useState(() => (id ? readFolded(id) : false));
  const toggle = () =>
    setFolded((f) => {
      try {
        if (id) localStorage.setItem(KEY + id, f ? '0' : '1');
      } catch {
        /* a convenience only */
      }
      return !f;
    });
  const label = typeof title === 'string' ? title : (id ?? 'box');
  return (
    <section className={`panel${folded ? ' folded' : ''} ${className}`} aria-label={typeof title === 'string' ? title : undefined}>
      <div className="panel-head">
        <h2>
          {title}
          {aside && <span className="small muted"> {aside}</span>}
        </h2>
        <span className="panel-tools">
          {!folded && tools}
          {id && (
            <button className="chevron" aria-expanded={!folded} aria-label={`${folded ? 'Show' : 'Hide'} ${label}`} title={folded ? 'Show' : 'Hide'} onClick={toggle}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </span>
      </div>
      {!folded && <div className="panel-body">{children}</div>}
    </section>
  );
}
