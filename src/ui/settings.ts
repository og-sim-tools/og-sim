/**
 * App settings (the gear in the top bar, user 2026-10-20), kept in this browser: whether items visibly turn
 * when rotated and slide into place when dropped (and how long each takes), what an item turns around (in the bag, and while held; square items
 * and the others each have their own choice), and how the rarity colour shows behind items and gear.
 */
import { useSyncExternalStore } from 'react';

/** A corner of the item's cells, or their centre: what stays put when it turns. */
export type Anchor = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
/** While held, it can also turn around the cursor. */
export type Pivot = 'cursor' | Anchor;
export const ANCHORS: Anchor[] = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
/** How an item's rarity colour shows behind its picture: a full background, a ring round its cells, or not at all. */
export type RarityLook = 'full' | 'ring' | 'none';
export const RARITY_LOOKS: RarityLook[] = ['full', 'ring', 'none'];

export interface Settings {
  /** Items turn smoothly instead of jumping. */
  animateRotation: boolean;
  /** How long a turn takes (ms). */
  rotationMs: number;
  /** A dropped item slides from where it was let go into its place, instead of jumping there. */
  animatePlacing: boolean;
  /** How long that slide takes (ms). */
  placeMs: number;
  /** While dragging: what a square item (as wide as it's tall) turns around. */
  squarePivot: Pivot;
  /** While dragging: what any other item turns around. */
  otherPivot: Pivot;
  /** In the bag (not held): what a square item turns around. */
  placedSquarePivot: Anchor;
  /** In the bag (not held): what any other item turns around. */
  placedOtherPivot: Anchor;
  /** Items (not gear): how the rarity colour shows, and how strongly (0–100), normally and when selected. */
  itemLook: RarityLook;
  itemOpacity: number;
  itemSelectedOpacity: number;
  /** Gear: the same. */
  gearLook: RarityLook;
  gearOpacity: number;
  gearSelectedOpacity: number;
}

// In the bag an item has always kept its top-left corner when turned.
export const DEFAULT_SETTINGS: Settings = { animateRotation: false, rotationMs: 150, animatePlacing: true, placeMs: 120, squarePivot: 'cursor', otherPivot: 'cursor', placedSquarePivot: 'top-left', placedOtherPivot: 'top-left',
  // Pictures have always sat on a 55% background, full when selected.
  itemLook: 'full', itemOpacity: 55, itemSelectedOpacity: 100, gearLook: 'full', gearOpacity: 55, gearSelectedOpacity: 100,
};

const KEY = 'og-sim/settings';
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Partial<Settings>;
    const pivot = (v: unknown): Pivot => (ANCHORS.includes(v as Anchor) ? (v as Anchor) : 'cursor');
    const anchor = (v: unknown): Anchor => (ANCHORS.includes(v as Anchor) ? (v as Anchor) : 'top-left');
    const look = (v: unknown): RarityLook => (RARITY_LOOKS.includes(v as RarityLook) ? (v as RarityLook) : 'full');
    const pct = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : d);
    return {
      animateRotation: raw.animateRotation === true,
      rotationMs: typeof raw.rotationMs === 'number' && raw.rotationMs >= 0 ? Math.min(2000, raw.rotationMs) : DEFAULT_SETTINGS.rotationMs,
      animatePlacing: raw.animatePlacing !== false,
      placeMs: typeof raw.placeMs === 'number' && raw.placeMs >= 0 ? Math.min(2000, raw.placeMs) : DEFAULT_SETTINGS.placeMs,
      squarePivot: pivot(raw.squarePivot),
      otherPivot: pivot(raw.otherPivot),
      placedSquarePivot: anchor(raw.placedSquarePivot),
      placedOtherPivot: anchor(raw.placedOtherPivot),
      itemLook: look(raw.itemLook),
      itemOpacity: pct(raw.itemOpacity, DEFAULT_SETTINGS.itemOpacity),
      itemSelectedOpacity: pct(raw.itemSelectedOpacity, DEFAULT_SETTINGS.itemSelectedOpacity),
      gearLook: look(raw.gearLook),
      gearOpacity: pct(raw.gearOpacity, DEFAULT_SETTINGS.gearOpacity),
      gearSelectedOpacity: pct(raw.gearSelectedOpacity, DEFAULT_SETTINGS.gearSelectedOpacity),
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
