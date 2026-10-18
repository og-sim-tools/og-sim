/** Talks to the dev-server file API (src/server). */
import type { SourceFile } from '../engine/loader';

export interface Snapshot {
  data: SourceFile[];
  profile: string | null;
  layouts: string[];
}

async function check(res: Response): Promise<Response> {
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

export const fetchSnapshot = async (): Promise<Snapshot> => (await check(await fetch('/api/files'))).json() as Promise<Snapshot>;

export const fetchLayout = async (name: string): Promise<string> =>
  (await check(await fetch(`/api/layouts/${encodeURIComponent(name)}`))).text();

export async function saveLayout(name: string, yaml: string): Promise<void> {
  await check(await fetch(`/api/layouts/${encodeURIComponent(name)}`, { method: 'PUT', body: yaml }));
}

export async function deleteLayout(name: string): Promise<void> {
  await check(await fetch(`/api/layouts/${encodeURIComponent(name)}`, { method: 'DELETE' }));
}

export async function saveProfile(yaml: string): Promise<void> {
  await check(await fetch('/api/profile', { method: 'PUT', body: yaml }));
}

export async function saveManualEntry(category: string, entry: Record<string, unknown>): Promise<void> {
  await check(
    await fetch(`/api/manual/${encodeURIComponent(category)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }),
  );
}

/** Offer text as a file download (profile export). */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/yaml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteManualEntry(category: string, id: string): Promise<void> {
  await check(await fetch(`/api/manual/${encodeURIComponent(category)}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
