/**
 * Saved builds: one dropdown, with a search box. The temp build is always first: a scratch build that isn't
 * in the list, kept as it's edited until it's saved under a name. Each saved build's row opens it; its white
 * pencil renames it, its green arrow saves the build being edited over it and its red bin deletes it (all ask
 * first). With "Preview bag" on, the list shows each build's bag under its name, 3 to a row.
 * Beside it: Save (to the open build, or under a new name), New build, Import, Export.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { BUILD_NAME_RE, BUILD_NAME_RULE } from '../../engine/saves/names';
import { Dialog } from './Dialog';

interface Props {
  builds: string[];
  /** The open build ('' = the temp build). */
  active: string;
  dirty: boolean;
  /** Save stays on even without unsaved changes (an enemy's build, which isn't tracked). */
  saveEnabled?: boolean;
  /** What's being edited, for the questions ("your build", "Raven's build"). */
  what?: string;
  /** Show each build's bag in the list. */
  previews?: boolean;
  /** The bag picture for a build (null = the temp build). */
  renderPreview?: (name: string | null) => ReactNode;
  /** The list was opened (previews can be loaded). */
  onOpenList?: () => void;
  /** The temp build has items in it (starting over would lose them). */
  tempHasItems?: boolean;
  /** No temp build here (editing an enemy's build). */
  noTemp?: boolean;
  onLoad: (name: string) => void;
  onOpenTemp?: () => void;
  /** Save what's being edited as this name (new or over an existing build). */
  onSave: (name: string) => void;
  onRename?: (from: string, to: string) => void;
  onDelete: (name: string) => void;
  onNew: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
}

type Ask =
  | { kind: 'load'; name: string | null }
  | { kind: 'overwrite'; name: string }
  | { kind: 'delete'; name: string }
  | { kind: 'rename'; name: string }
  | { kind: 'save' }
  | { kind: 'name' }
  | { kind: 'new' }
  | { kind: 'import'; file: File };

export const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" fill="currentColor" />
  </svg>
);
export const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" fill="currentColor" />
  </svg>
);
export const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor" />
  </svg>
);

/** A name typed in a dialog: allowed characters, and whether another build has it. */
function NameField({ value, onChange, onEnter, taken }: { value: string; onChange: (v: string) => void; onEnter: () => void; taken: boolean }) {
  const ok = BUILD_NAME_RE.test(value.trim());
  return (
    <>
      <label className="small">
        Name{' '}
        <input
          aria-label="Build name"
          value={value}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ok && onEnter()}
          placeholder="e.g. trixie burn"
          style={{ width: '100%' }}
        />
      </label>
      {!ok && value.trim() !== '' && <div className="field-error">Use {BUILD_NAME_RULE}.</div>}
      {taken && <div className="field-warn">A build called "{value.trim()}" exists: saving replaces it.</div>}
    </>
  );
}

export function BuildPicker(p: Props) {
  const { builds, active, dirty, saveEnabled = false, what = 'your build', previews = false } = p;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [newName, setNewName] = useState('');
  const [query, setQuery] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const isTemp = !active && !p.noTemp;

  useEffect(() => {
    if (!open) return;
    p.onOpenList?.();
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const done = () => {
    setAsk(null);
    setNewName('');
  };
  const lost = dirty ? ` Your unsaved changes${active ? ` to "${active}"` : ''} will be lost.` : '';
  const taken = (name: string, except?: string) => builds.some((b) => b !== except && b.toLowerCase() === name.trim().toLowerCase());
  const nameOk = BUILD_NAME_RE.test(newName.trim());

  /** Open a saved build (name) or the temp build (null), asking first if unsaved changes would be lost. */
  const pick = (name: string | null) => {
    setOpen(false);
    if (name === (active || null)) return;
    if (dirty) setAsk({ kind: 'load', name });
    else if (name === null) p.onOpenTemp?.();
    else p.onLoad(name);
  };
  const q = query.trim().toLowerCase();
  const shown = builds.filter((b) => !q || b.toLowerCase().includes(q));
  const showTemp = !p.noTemp && (!q || 'temp build'.includes(q));

  const icons = (b: string) => (
    <span className="picker-icons">
      {p.onRename && (
        <button
          className="icon-button rename"
          aria-label={`Rename ${b}`}
          title={`Rename "${b}"`}
          onClick={() => {
            setOpen(false);
            setNewName(b);
            setAsk({ kind: 'rename', name: b });
          }}
        >
          <PencilIcon />
        </button>
      )}
      <button
        className="icon-button save-over"
        aria-label={`Save over ${b}`}
        title={`Save ${what} over "${b}"`}
        onClick={() => {
          setOpen(false);
          setAsk({ kind: 'overwrite', name: b });
        }}
      >
        <DownloadIcon />
      </button>
      <button
        className="icon-button delete"
        aria-label={`Delete ${b}`}
        title={`Delete "${b}"`}
        onClick={() => {
          setOpen(false);
          setAsk({ kind: 'delete', name: b });
        }}
      >
        <TrashIcon />
      </button>
    </span>
  );

  return (
    <div className="build-picker" ref={box}>
      <div className="row picker-bar">
        <button className="picker-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Open, rename, save over or delete a saved build">
          <span className="name">{active || (p.noTemp ? 'Not saved' : 'Temp build')}</span>
          {isTemp && <span className="small muted">not in your list</span>}
          {dirty && <span className="unsaved" title="Unsaved changes (kept in this browser until you save)">● unsaved</span>}
          <span aria-hidden="true">▾</span>
        </button>
        <button
          className="primary"
          disabled={!!active && !dirty && !saveEnabled}
          onClick={() => setAsk(active ? { kind: 'save' } : { kind: 'name' })}
          title={active ? `Save the changes to "${active}"` : 'Save the temp build under a name (it joins your list)'}
        >
          Save
        </button>
        <button onClick={() => (dirty || (isTemp && p.tempHasItems) ? setAsk({ kind: 'new' }) : p.onNew())} title="Start over in the temp build: same hero, gear, pets and skins, empty bag">
          New build
        </button>
        <button onClick={() => file.current?.click()} title="Open a build file (.yaml) someone shared">
          Import
        </button>
        <input
          ref={file}
          type="file"
          accept=".yaml,.yml"
          aria-label="Import build"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (dirty) setAsk({ kind: 'import', file: f });
            else p.onImport(f);
          }}
        />
        <button onClick={p.onExport} title="Download this build as a file to share or keep">
          Export
        </button>
      </div>
      {open && (
        <div className={`picker-list${previews ? ' previews' : ''}`} role="listbox" aria-label="Saved builds">
          <input className="picker-search" placeholder="Search builds…" aria-label="Search builds" value={query} autoFocus onChange={(e) => setQuery(e.target.value)} />
          <div className="picker-items">
            {showTemp &&
              (previews ? (
                <div className={`picker-card temp${isTemp ? ' current' : ''}`} role="option" aria-selected={isTemp}>
                  <div className="picker-caption">
                    <button className="picker-name" onClick={() => pick(null)} title="Open the temp build">
                      Temp build
                    </button>
                  </div>
                  <button className="picker-preview" onClick={() => pick(null)} aria-label="Open the temp build" tabIndex={-1}>
                    {p.renderPreview?.(null)}
                  </button>
                </div>
              ) : (
                <div className={`picker-row temp${isTemp ? ' current' : ''}`} role="option" aria-selected={isTemp}>
                  <button className="picker-name" onClick={() => pick(null)} title="A scratch build for trying things out: not in your list, kept until you save it or start over">
                    Temp build <span className="small muted">not in your list</span>
                  </button>
                </div>
              ))}
            {builds.length === 0 && <div className="small muted" style={{ padding: 8 }}>No saved builds yet: save the temp build to start your list.</div>}
            {builds.length > 0 && shown.length === 0 && <div className="small muted" style={{ padding: 8 }}>No build matches "{query}".</div>}
            {shown.map((b) =>
              previews ? (
                <div key={b} className={`picker-card${b === active ? ' current' : ''}`} role="option" aria-selected={b === active}>
                  <div className="picker-caption">
                    <button className="picker-name" onClick={() => pick(b)} title={`Open "${b}"`}>
                      {b}
                    </button>
                    {icons(b)}
                  </div>
                  <button className="picker-preview" onClick={() => pick(b)} aria-label={`Open ${b}`} tabIndex={-1}>
                    {p.renderPreview?.(b)}
                  </button>
                </div>
              ) : (
                <div key={b} className={`picker-row${b === active ? ' current' : ''}`} role="option" aria-selected={b === active}>
                  <button className="picker-name" onClick={() => pick(b)} title={`Open "${b}"`}>
                    {b}
                  </button>
                  {icons(b)}
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {ask?.kind === 'load' && (
        <Dialog
          title={ask.name === null ? 'Open the temp build?' : `Open "${ask.name}"?`}
          onCancel={done}
          actions={[{ label: 'Open it', kind: 'primary', onClick: () => (ask.name === null ? p.onOpenTemp?.() : p.onLoad(ask.name), done()) }]}
        >
          <p>{lost.trim()}</p>
        </Dialog>
      )}
      {ask?.kind === 'new' && (
        <Dialog title="Start a new build?" onCancel={done} actions={[{ label: 'New build', kind: 'primary', onClick: () => (p.onNew(), done()) }]}>
          <p>
            It starts in the temp build with an empty bag (same hero, gear, pets and skins).
            {isTemp && p.tempHasItems ? ' What the temp build has now is replaced.' : ''}
            {lost}
          </p>
        </Dialog>
      )}
      {ask?.kind === 'import' && (
        <Dialog title={`Import ${ask.file.name}?`} onCancel={done} actions={[{ label: 'Import', kind: 'primary', onClick: () => (p.onImport(ask.file), done()) }]}>
          <p>{lost.trim()}</p>
        </Dialog>
      )}
      {ask?.kind === 'save' && (
        <Dialog title={`Save "${active}"?`} onCancel={done} actions={[{ label: 'Save', kind: 'primary', onClick: () => (p.onSave(active), done()) }]}>
          <p>This replaces the saved "{active}" with {what} as it is now.</p>
        </Dialog>
      )}
      {ask?.kind === 'overwrite' && (
        <Dialog title={`Save over "${ask.name}"?`} onCancel={done} actions={[{ label: 'Save over it', kind: 'primary', onClick: () => (p.onSave(ask.name), done()) }]}>
          <p>
            The saved build "{ask.name}" is replaced by {what}
            {active && active !== ask.name ? ` ("${active}")` : isTemp ? ' (the temp build)' : ''}. This can't be undone.
          </p>
        </Dialog>
      )}
      {ask?.kind === 'delete' && (
        <Dialog title={`Delete "${ask.name}"?`} onCancel={done} actions={[{ label: 'Delete', kind: 'danger', onClick: () => (p.onDelete(ask.name), done()) }]}>
          <p>The saved build "{ask.name}" is deleted. This can't be undone (an account export keeps a copy).</p>
        </Dialog>
      )}
      {ask?.kind === 'rename' && (
        <Dialog
          title={`Rename "${ask.name}"`}
          onCancel={done}
          actions={[
            {
              label: 'Rename',
              kind: 'primary',
              disabled: !nameOk || newName.trim() === ask.name || taken(newName, ask.name),
              onClick: () => (p.onRename?.(ask.name, newName.trim()), done()),
            },
          ]}
        >
          <NameField value={newName} onChange={setNewName} taken={false} onEnter={() => newName.trim() !== ask.name && !taken(newName, ask.name) && (p.onRename?.(ask.name, newName.trim()), done())} />
          {taken(newName, ask.name) && <div className="field-error">A build called "{newName.trim()}" exists already.</div>}
        </Dialog>
      )}
      {ask?.kind === 'name' && (
        <Dialog
          title={isTemp ? 'Save the temp build' : 'Save as a new build'}
          onCancel={done}
          actions={[{ label: taken(newName) ? 'Save over it' : 'Save', kind: 'primary', disabled: !nameOk, onClick: () => (p.onSave(newName.trim()), done()) }]}
        >
          <NameField value={newName} onChange={setNewName} taken={taken(newName)} onEnter={() => (p.onSave(newName.trim()), done())} />
          {isTemp && <div className="small muted">It joins your saved builds; the temp build starts empty again.</div>}
        </Dialog>
      )}
    </div>
  );
}
