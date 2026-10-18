/**
 * Where the account and builds are saved. Locally (`npm run dev`) they're the project's files through the
 * dev server (profile/profile.yaml, layouts/<name>.yaml), so the CLI sees them too. On the hosted static
 * site there's no server: they live in this browser's storage, and the account export is the backup.
 * The text stored is always a saved-file format (src/engine/saves), so it loads in any later version.
 */
import { createContext, useContext } from 'react';
import type { SourceFile } from '../engine/loader';
import { BUILD_NAME_RE, BUILD_NAME_RULE } from '../engine/saves/names';
import { BROWSER_EDITS_FILE, USER_EDITS_FILE, readEdits, removeEdit, upsertEdit, writeEdits } from '../engine/userEdits';
import { deleteManualEntry, fetchSnapshot, saveManualEntry } from './api';
import { bundledData } from './staticData';

export interface SaveStore {
  kind: 'files' | 'browser';
  /** Where a build (or, without a name, the account) is saved, for messages. */
  where(name?: string): string;
  readAccount(): Promise<string | null>;
  writeAccount(text: string): Promise<void>;
  listBuilds(): Promise<string[]>;
  readBuild(name: string): Promise<string>;
  writeBuild(name: string, text: string): Promise<void>;
  deleteBuild(name: string): Promise<void>;
  /** The game data files, with the item editor's edits. */
  readData(): Promise<SourceFile[]>;
  /** Item editor: save the changed fields of one entry (they override the wiki field by field), or drop all edits to it. */
  writeEdit(category: string, entry: Record<string, unknown>): Promise<void>;
  deleteEdit(category: string, id: string): Promise<void>;
  /** Where item editor edits go, for messages. */
  editsWhere(category: string): string;
  /** Item editor edits this store keeps itself (the browser), by category, for the account export. Locally they're project files. */
  listEdits(): Promise<{ category: string; text: string }[]>;
  /** Replace one category's edits (account import); missing where edits are project files. */
  writeEdits?(category: string, text: string): Promise<void>;
}

function checkName(name: string) {
  if (!BUILD_NAME_RE.test(name)) throw new Error(`"${name}" can't be a build name (${BUILD_NAME_RULE}).`);
}

async function ok(res: Response): Promise<Response> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res;
}

/** The dev server's file API (src/server). */
export function fileStore(): SaveStore {
  const url = (name: string) => `/api/layouts/${encodeURIComponent(name)}`;
  return {
    kind: 'files',
    where: (name) => (name === undefined ? 'profile/profile.yaml' : `layouts/${name}.yaml`),
    readAccount: async () => ((await (await ok(await fetch('/api/profile'))).json()) as { text: string | null }).text,
    writeAccount: async (text) => void (await ok(await fetch('/api/profile', { method: 'PUT', body: text }))),
    listBuilds: async () => (await (await ok(await fetch('/api/layouts'))).json()) as string[],
    readBuild: async (name) => (await ok(await fetch(url(name)))).text(),
    writeBuild: async (name, text) => {
      checkName(name);
      await ok(await fetch(url(name), { method: 'PUT', body: text }));
    },
    deleteBuild: async (name) => void (await ok(await fetch(url(name), { method: 'DELETE' }))),
    readData: async () => (await fetchSnapshot()).data,
    writeEdit: (category, entry) => saveManualEntry(category, entry),
    deleteEdit: (category, id) => deleteManualEntry(category, id),
    editsWhere: (category) => `data/${category}/manual/${USER_EDITS_FILE}`,
    listEdits: async () => [],
  };
}

const PREFIX = 'og-sim/';
const ACCOUNT_KEY = `${PREFIX}account`;
const BUILD_KEY = `${PREFIX}build/`;
const EDITS_KEY = `${PREFIX}edits/`;

/** This browser's localStorage (the hosted site). Every access can throw (private windows, blocked storage). */
export function browserStore(storage: Storage = globalThis.localStorage, readBase: () => Promise<SourceFile[]> = bundledData): SaveStore {
  const guard = <T>(what: string, fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      const full = e instanceof DOMException && /quota/i.test(e.name);
      throw new Error(full ? `Your browser's storage is full: couldn't ${what}. Export your account and delete builds you don't need.` : `Your browser blocked its storage: couldn't ${what} (${(e as Error).message}).`);
    }
  };
  const keys = (prefix: string) =>
    guard('list what is saved', () => {
      const out: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out.sort();
    });
  return {
    kind: 'browser',
    where: (name) => (name === undefined ? 'your account (this browser)' : `"${name}" (this browser)`),
    readAccount: async () => guard('read the account', () => storage.getItem(ACCOUNT_KEY)),
    writeAccount: async (text) => guard('save the account', () => storage.setItem(ACCOUNT_KEY, text)),
    listBuilds: async () => keys(BUILD_KEY),
    readBuild: async (name) =>
      guard(`read "${name}"`, () => {
        const text = storage.getItem(BUILD_KEY + name);
        if (text === null) throw new Error(`No build "${name}".`);
        return text;
      }),
    writeBuild: async (name, text) => {
      checkName(name);
      guard(`save "${name}"`, () => storage.setItem(BUILD_KEY + name, text));
    },
    deleteBuild: async (name) => guard(`delete "${name}"`, () => storage.removeItem(BUILD_KEY + name)),
    readData: async () => {
      const base = await readBase();
      const edits = keys(EDITS_KEY).map((category) => ({ path: `${category}/manual/${BROWSER_EDITS_FILE}`, text: storage.getItem(EDITS_KEY + category) ?? '' }));
      return [...base, ...edits];
    },
    writeEdit: async (category, entry) => {
      const list = upsertEdit(readEdits(guard('read your item edits', () => storage.getItem(EDITS_KEY + category))), entry);
      guard('save the item edit', () => storage.setItem(EDITS_KEY + category, writeEdits(list)));
    },
    deleteEdit: async (category, id) => {
      const list = removeEdit(readEdits(guard('read your item edits', () => storage.getItem(EDITS_KEY + category))), id);
      guard('save the item edits', () => (list.length ? storage.setItem(EDITS_KEY + category, writeEdits(list)) : storage.removeItem(EDITS_KEY + category)));
    },
    editsWhere: () => 'this browser (and your account export)',
    listEdits: async () => keys(EDITS_KEY).map((category) => ({ category, text: storage.getItem(EDITS_KEY + category) ?? '' })),
    writeEdits: async (category, text) => {
      readEdits(text); // a list, or it throws
      guard('save the item edits', () => storage.setItem(EDITS_KEY + category, text));
    },
  };
}

/** The store the app saves to, for components deep in the tree (the item editors). */
export const StoreContext = createContext<SaveStore | null>(null);
export const useStore = (): SaveStore => useContext(StoreContext) ?? fileStore();

// ------------------------------------------------------------------ unsaved changes

const DRAFT_KEY = `${PREFIX}draft`;

/** The build being edited, kept while it has unsaved changes so closing the tab doesn't lose them. */
export interface Draft {
  /** The saved build it started from ('' = a new build). */
  name: string;
  /** The build, as a build file. */
  text: string;
  /** ISO time. */
  at: string;
}

export function readDraft(storage: Storage | undefined = globalThis.localStorage): Draft | null {
  try {
    const raw = storage?.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return typeof d.text === 'string' ? { name: typeof d.name === 'string' ? d.name : '', text: d.text, at: typeof d.at === 'string' ? d.at : '' } : null;
  } catch {
    return null;
  }
}

export function writeDraft(draft: Draft | null, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    if (draft) storage?.setItem(DRAFT_KEY, JSON.stringify(draft));
    else storage?.removeItem(DRAFT_KEY);
  } catch {
    /* a convenience only */
  }
}

const LAST_KEY = `${PREFIX}last-build`;
export const lastBuild = {
  get: (storage: Storage | undefined = globalThis.localStorage): string | null => {
    try {
      return storage?.getItem(LAST_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set: (name: string, storage: Storage | undefined = globalThis.localStorage) => {
    try {
      if (name) storage?.setItem(LAST_KEY, name);
      else storage?.removeItem(LAST_KEY);
    } catch {
      /* a convenience only */
    }
  },
};
