/**
 * App settings (the gear in the top bar, user 2026-10-20), kept in this browser: whether items visibly turn
 * when rotated (and how long it takes), and what a held item turns around when space is pressed while
 * dragging it — square items and the others each have their own choice.
 */
import { useSyncExternalStore } from 'react';

/** A corner of the item's cells, or their centre: what stays put when it turns. */
export type Anchor = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
/** While held, it can also turn around the cursor. */
export type Pivot = 'cursor' | Anchor;
export const ANCHORS: Anchor[] = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

export interface Settings {
  /** Items turn smoothly instead of jumping. */
  animateRotation: boolean;
  /** How long a turn takes (ms). */
  rotationMs: number;
  /** While dragging: what a square item (as wide as it's tall) turns around. */
  squarePivot: Pivot;
  /** While dragging: what any other item turns around. */
  otherPivot: Pivot;
  /** In the bag (not held): what a square item turns around. */
  placedSquarePivot: Anchor;
  /** In the bag (not held): what any other item turns around. */
  placedOtherPivot: Anchor;
}

// In the bag an item has always kept its top-left corner when turned.
export const DEFAULT_SETTINGS: Settings = { animateRotation: false, rotationMs: 150, squarePivot: 'cursor', otherPivot: 'cursor', placedSquarePivot: 'top-left', placedOtherPivot: 'top-left' };

const KEY = 'og-sim/settings';
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Settings>;
    const pivot = (v: unknown): Pivot => (ANCHORS.includes(v as Anchor) ? (v as Anchor) : 'cursor');
    const anchor = (v: unknown): Anchor => (ANCHORS.includes(v as Anchor) ? (v as Anchor) : 'top-left');
    return {
      animateRotation: raw.animateRotation === true,
      rotationMs: typeof raw.rotationMs === 'number' && raw.rotationMs >= 0 ? Math.min(2000, raw.rotationMs) : DEFAULT_SETTINGS.rotationMs,
      squarePivot: pivot(raw.squarePivot),
      otherPivot: pivot(raw.otherPivot),
      placedSquarePivot: anchor(raw.placedSquarePivot),
      placedOtherPivot: anchor(raw.placedOtherPivot),
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
