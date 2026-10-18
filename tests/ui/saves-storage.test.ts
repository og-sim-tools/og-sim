// @vitest-environment jsdom
/** Account export / import (zip), browser storage and unsaved-changes drafts. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { readAccount, readBuild } from '../../src/engine/saves';
import { browserStore, lastBuild, readDraft, writeDraft } from '../../src/ui/saves';
import { accountArchive, looksLikeBuild, readAccountArchive } from '../../src/ui/state/accountArchive';
import { crc32, unzipFiles, zipFiles } from '../../src/ui/state/zip';

const FIX = join(__dirname, '..', 'fixtures', 'saves');
beforeEach(() => localStorage.clear());

/** A zip with one deflated file, the way an operating system makes them. */
async function deflatedZip(path: string, text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  const packed = new Uint8Array(await new Response(new Response(data).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const stored = zipFiles([{ path, text }]);
  // Same zip, with the deflated bytes and method 8 instead of stored.
  const name = new TextEncoder().encode(path);
  const out = new Uint8Array(stored.length - data.length + packed.length);
  out.set(stored.subarray(0, 30 + name.length));
  out.set(packed, 30 + name.length);
  out.set(stored.subarray(30 + name.length + data.length), 30 + name.length + packed.length);
  const v = new DataView(out.buffer);
  const cd = 30 + name.length + packed.length;
  for (const [at, method] of [[8, 8], [cd + 10, 8]] as const) v.setUint16(at, method, true);
  v.setUint32(18, packed.length, true);
  v.setUint32(cd + 20, packed.length, true);
  v.setUint32(out.length - 6, cd, true);
  return out;
}

describe('zip', () => {
  it('round-trips files with any characters in their names', async () => {
    const files = [
      { path: 'a/profile.yaml', text: 'version: 2\n' },
      { path: 'a/builds/trixie anti-raven 2 brooms.yaml', text: 'name: ü ✓\n' },
    ];
    expect(await unzipFiles(zipFiles(files))).toEqual(files);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('reads deflated files, and says clearly when it is not a zip', async () => {
    expect(await unzipFiles(await deflatedZip('x/builds/b.yaml', 'placements: []\n'.repeat(50)))).toEqual([{ path: 'x/builds/b.yaml', text: 'placements: []\n'.repeat(50) }]);
    await expect(unzipFiles(new TextEncoder().encode('just text'))).rejects.toThrow(/not a \.zip/);
  });
});

describe('account export / import', () => {
  const account = readFileSync(join(FIX, 'v2', 'profile.yaml'), 'utf8');
  const raven = readFileSync(join(FIX, 'v2', 'builds', 'raven.yaml'), 'utf8');

  it('exports a dated folder with the account, every build and a readme', async () => {
    const { filename, bytes } = accountArchive(account, [{ name: 'raven', text: raven }], new Date(2026, 9, 18, 12));
    expect(filename).toBe('og-sim-account-2026-10-18.zip');
    const files = await unzipFiles(bytes);
    expect(files.map((f) => f.path)).toEqual([
      'og-sim-account-2026-10-18/README.txt',
      'og-sim-account-2026-10-18/manifest.yaml',
      'og-sim-account-2026-10-18/profile.yaml',
      'og-sim-account-2026-10-18/builds/raven.yaml',
    ]);
    const back = readAccountArchive(files);
    expect(back.accountText).toBe(account);
    expect(back.builds).toEqual([{ name: 'raven', text: raven }]);
    expect(back.notes).toEqual([]);
    // What comes back loads like the original.
    expect(readAccount(back.accountText).profile).toEqual(readAccount(account).profile);
    expect(readBuild(back.builds[0]!.text).layout).toEqual(readBuild(raven).layout);
  });

  it("also reads a zip of the project's profile/ and layouts/ folders, fixing names it can't use", () => {
    const back = readAccountArchive([
      { path: 'OG-Simulator\\profile\\profile.yaml', text: 'p' },
      { path: 'OG-Simulator/layouts/raven.yaml', text: 'r' },
      { path: 'OG-Simulator/layouts/Trixie: best!.yaml', text: 't' },
      { path: 'OG-Simulator/data/items/wiki/items.yaml', text: 'x' },
      { path: 'OG-Simulator/tests/fixtures/saves/v1/profile.yaml', text: 'deeper' },
    ]);
    expect(back.accountText).toBe('p');
    expect(back.builds.map((b) => b.name)).toEqual(['raven', 'Trixie_ best_']);
    expect(back.notes.join('\n')).toMatch(/"Trixie: best!" is saved as "Trixie_ best_"[\s\S]*Ignored 1 other file/);
  });

  it('tells a build file from an account file', () => {
    expect(looksLikeBuild(raven)).toBe(true);
    expect(looksLikeBuild(account)).toBe(false);
    expect(looksLikeBuild(': not yaml [')).toBe(false);
  });
});

describe('browser storage', () => {
  it('keeps the account and builds, lists builds by name and refuses unsafe names', async () => {
    const s = browserStore(localStorage);
    expect(await s.readAccount()).toBeNull();
    await s.writeAccount('version: 2\n');
    await s.writeBuild('raven', 'r');
    await s.writeBuild('bjorn spike', 'b');
    localStorage.setItem('something-else', 'x');
    expect(await s.readAccount()).toBe('version: 2\n');
    expect(await s.listBuilds()).toEqual(['bjorn spike', 'raven']);
    expect(await s.readBuild('raven')).toBe('r');
    await expect(s.writeBuild('../evil', 'x')).rejects.toThrow(/can't be a build name/);
    await s.deleteBuild('raven');
    expect(await s.listBuilds()).toEqual(['bjorn spike']);
    await expect(s.readBuild('raven')).rejects.toThrow(/No build "raven"/);
  });

  it('explains a full or blocked storage', async () => {
    const full = { ...localStorage, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } } as unknown as Storage;
    await expect(browserStore(full).writeBuild('raven', 'r')).rejects.toThrow(/storage is full[\s\S]*Export your account/);
  });

  it('keeps unsaved changes as a draft, and the last build opened', () => {
    expect(readDraft()).toBeNull();
    writeDraft({ name: 'raven', text: 'placements: []', at: '2026-10-18T10:00:00Z' });
    expect(readDraft()).toEqual({ name: 'raven', text: 'placements: []', at: '2026-10-18T10:00:00Z' });
    writeDraft(null);
    expect(readDraft()).toBeNull();
    localStorage.setItem('og-sim/draft', '{not json');
    expect(readDraft()).toBeNull();
    lastBuild.set('raven');
    expect(lastBuild.get()).toBe('raven');
    lastBuild.set('');
    expect(lastBuild.get()).toBeNull();
  });
});
