/**
 * App settings (the gear in the top bar, user 2026-10-20), kept in this browser: whether items visibly turn
 * when rotated (and how long it takes), and what a held item turns around when space is pressed while
 * dragging it — square items and the others each have their own choice.
 */
import { useSyncExternalStore } from 'react';

export type Pivot = 'cursor' | 'center';

export interface Settings {
  /** Items turn smoothly instead of jumping. */
  animateRotation: boolean;
  /** How long a turn takes (ms). */
  rotationMs: number;
  /** While dragging: what a square item (as wide as it's tall) turns around. */
  squarePivot: Pivot;
  /** While dragging: what any other item turns around. */
  otherPivot: Pivot;
}

export const DEFAULT_SETTINGS: Settings = { animateRotation: false, rotationMs: 150, squarePivot: 'cursor', otherPivot: 'cursor' };

const KEY = 'og-sim/settings';
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Settings>;
    const pivot = (v: unknown): Pivot => (v === 'center' ? 'center' : 'cursor');
    return {
      animateRotation: raw.animateRotation === true,
      rotationMs: typeof raw.rotationMs === 'number' && raw.rotationMs >= 0 ? Math.min(2000, raw.rotationMs) : DEFAULT_SETTINGS.rotationMs,
      squarePivot: pivot(raw.squarePivot),
      otherPivot: pivot(raw.otherPivot),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = load();

export const getSettings = (): Settings => current;

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(current));
  } catch {
    /* a convenience only */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
