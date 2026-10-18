/** A modal dialog: confirmations (overwrite, delete, import) and short questions. Escape or the backdrop cancels. */
import { type ReactNode, useEffect, useRef } from 'react';

interface Props {
  title: string;
  children?: ReactNode;
  /** Buttons, the main one first. */
  actions: { label: string; onClick: () => void; kind?: 'primary' | 'danger'; disabled?: boolean }[];
  onCancel: () => void;
}

export function Dialog({ title, children, actions, onCancel }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button.primary, button.danger, button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={box} className="dialog panel" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button onClick={onCancel}>Cancel</button>
          {actions.map((a) => (
            <button key={a.label} className={a.kind ?? ''} disabled={a.disabled} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
