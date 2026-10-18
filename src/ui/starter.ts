/** A first visit to the hosted site: an empty account gets one example build to look at (user, 2026-10-18). */
import { readBuild, writeBuild } from '../engine/saves';
import type { SaveStore } from './saves';
import exampleText from './starter/example.yaml?raw';

const SEEDED = 'og-sim/seeded';

/** Put the starter build in an empty store, once. Never touches a store that has an account or a build. */
export async function seedStarter(store: SaveStore, storage: Storage | undefined = globalThis.localStorage, text = exampleText): Promise<boolean> {
  try {
    if (!storage || storage.getItem(SEEDED)) return false;
    storage.setItem(SEEDED, '1');
  } catch {
    return false;
  }
  if ((await store.readAccount()) !== null || (await store.listBuilds()).length > 0) return false;
  await store.writeBuild('example', writeBuild({ ...readBuild(text).layout, name: 'example' }));
  return true;
}
