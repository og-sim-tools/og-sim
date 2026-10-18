/**
 * Saved builds: one dropdown. Each row loads that build; its green arrow saves the build being edited over
 * it and its red bin deletes it (both ask first). Below: Save (to the open build), New build, Import, Export.
 */
import { useEffect, useRef, useState } from 'react';
import { BUILD_NAME_RE, BUILD_NAME_RULE } from '../../engine/saves/names';
import { Dialog } from './Dialog';

interface Props {
  builds: string[];
  /** The open build ('' = not saved yet). */
  active: string;
  dirty: boolean;
  /** Save stays on even without unsaved changes (an enemy's build, which isn't tracked). */
  saveEnabled?: boolean;
  /** What's being edited, for the questions ("your build", "Raven's build"). */
  what?: string;
  onLoad: (name: string) => void;
  /** Save what's being edited as this name (new or over an existing build). */
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onNew: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
}

type Ask =
  | { kind: 'load'; name: string }
  | { kind: 'overwrite'; name: string }
  | { kind: 'delete'; name: string }
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

export function BuildPicker({ builds, active, dirty, saveEnabled = false, what = 'your build', onLoad, onSave, onDelete, onNew, onImport, onExport }: Props) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [newName, setNewName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const done = () => setAsk(null);
  const lost = dirty ? ` Your unsaved changes${active ? ` to "${active}"` : ''} will be lost.` : '';
  const nameTaken = builds.some((b) => b.toLowerCase() === newName.trim().toLowerCase());
  const nameOk = BUILD_NAME_RE.test(newName.trim());

  const pick = (name: string) => {
    setOpen(false);
    if (dirty) setAsk({ kind: 'load', name });
    else onLoad(name);
  };

  return (
    <div className="build-picker" ref={box}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <button className="picker-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Open, save over or delete a saved build">
          <span className="name">{active || 'New build (not saved)'}</span>
          {dirty && <span className="unsaved" title="Unsaved changes (kept in this browser until you save)">● unsaved</span>}
          <span aria-hidden="true">▾</span>
        </button>
        <button className="primary" disabled={!!active && !dirty && !saveEnabled} onClick={() => setAsk(active ? { kind: 'save' } : { kind: 'name' })} title={active ? `Save the changes to "${active}"` : 'Save as a new build'}>
          Save
        </button>
      </div>
      {open && (
        <div className="picker-list" role="listbox" aria-label="Saved builds">
          {builds.length === 0 && <div className="small muted" style={{ padding: 8 }}>No saved builds yet.</div>}
          {builds.map((b) => (
            <div key={b} className={`picker-row${b === active ? ' current' : ''}`} role="option" aria-selected={b === active}>
              <button className="picker-name" onClick={() => pick(b)} title={`Open "${b}"`}>
                {b}
              </button>
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
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={() => (dirty ? setAsk({ kind: 'new' }) : onNew())} title="Start a new build: same hero, gear, pets and skins, empty bag">
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
            else onImport(f);
          }}
        />
        <button onClick={onExport} title="Download this build as a file to share or keep">
          Export
        </button>
      </div>

      {ask?.kind === 'load' && (
        <Dialog title={`Open "${ask.name}"?`} onCancel={done} actions={[{ label: 'Open it', kind: 'primary', onClick: () => (onLoad(ask.name), done()) }]}>
          <p>{lost.trim()}</p>
        </Dialog>
      )}
      {ask?.kind === 'new' && (
        <Dialog title="Start a new build?" onCancel={done} actions={[{ label: 'New build', kind: 'primary', onClick: () => (onNew(), done()) }]}>
          <p>{lost.trim()}</p>
        </Dialog>
      )}
      {ask?.kind === 'import' && (
        <Dialog title={`Import ${ask.file.name}?`} onCancel={done} actions={[{ label: 'Import', kind: 'primary', onClick: () => (onImport(ask.file), done()) }]}>
          <p>{lost.trim()}</p>
        </Dialog>
      )}
      {ask?.kind === 'save' && (
        <Dialog title={`Save "${active}"?`} onCancel={done} actions={[{ label: 'Save', kind: 'primary', onClick: () => (onSave(active), done()) }]}>
          <p>This replaces the saved "{active}" with {what} as it is now.</p>
        </Dialog>
      )}
      {ask?.kind === 'overwrite' && (
        <Dialog title={`Save over "${ask.name}"?`} onCancel={done} actions={[{ label: 'Save over it', kind: 'primary', onClick: () => (onSave(ask.name), done()) }]}>
          <p>
            The saved build "{ask.name}" is replaced by {what}
            {active && active !== ask.name ? ` ("${active}")` : ''}. This can't be undone.
          </p>
        </Dialog>
      )}
      {ask?.kind === 'delete' && (
        <Dialog title={`Delete "${ask.name}"?`} onCancel={done} actions={[{ label: 'Delete', kind: 'danger', onClick: () => (onDelete(ask.name), done()) }]}>
          <p>The saved build "{ask.name}" is deleted. This can't be undone (an account export keeps a copy).</p>
        </Dialog>
      )}
      {ask?.kind === 'name' && (
        <Dialog
          title="Save as a new build"
          onCancel={done}
          actions={[
            {
              label: nameTaken ? 'Save over it' : 'Save',
              kind: 'primary',
              disabled: !nameOk,
              onClick: () => {
                onSave(newName.trim());
                setNewName('');
                done();
              },
            },
          ]}
        >
          <label className="small">
            Name{' '}
            <input
              aria-label="Build name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !nameOk) return;
                onSave(newName.trim());
                setNewName('');
                done();
              }}
              placeholder="e.g. trixie burn"
              style={{ width: '100%' }}
            />
          </label>
          {!nameOk && newName.trim() !== '' && <div className="field-error">Use {BUILD_NAME_RULE}.</div>}
          {nameTaken && <div className="field-warn">A build called "{newName.trim()}" exists: saving replaces it.</div>}
        </Dialog>
      )}
    </div>
  );
}
