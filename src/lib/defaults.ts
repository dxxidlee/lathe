/* Defaults edits: per tool, what the person changed from the maker's manifest and why.
   Stored in IndexedDB (store "settings") under reserved keys, next to the tool's own settings. */
import type { DefaultEntry, DefaultsManifest } from '../tools/types';
import { idbGet, idbSet } from './idb';

export interface DefaultEdit { value: unknown; reason?: string; at: number }
export type Edits = Record<string, DefaultEdit>;

const EDITS = (id: string) => `__defaults:${id}`;
const APPLIED = (id: string) => `__applied:${id}`;

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function loadEdits(toolId: string): Promise<Edits> {
  const e = await idbGet<Edits>('settings', EDITS(toolId));
  return e && typeof e === 'object' ? e : {};
}
export function saveEdits(toolId: string, edits: Edits) { return idbSet('settings', EDITS(toolId), edits); }

/** The values a tool sees: the maker's, with the person's edits applied. */
export function effective(manifest: DefaultsManifest, edits: Edits): Record<string, unknown> {
  return Object.fromEntries(manifest.map(d => [d.key, d.key in edits ? edits[d.key].value : d.value]));
}

/** Effective values at the tool's last mount, to detect what changed in between. */
export async function loadApplied(toolId: string) { return idbGet<Record<string, unknown>>('settings', APPLIED(toolId)); }
export function saveApplied(toolId: string, values: Record<string, unknown>) { return idbSet('settings', APPLIED(toolId), values); }

export function changedKeys(prev: Record<string, unknown> | undefined, next: Record<string, unknown>): string[] {
  if (!prev) return [];
  return Object.keys(next).filter(k => k in prev && !same(prev[k], next[k]));
}

export const isEditable = (d: DefaultEntry) => d.editable !== false;

export function formatValue(v: unknown): string {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.every(x => typeof x !== 'object') ? v.map(formatValue).join(', ') : `${v.length} items`;
  if (v && typeof v === 'object') return `${Object.keys(v).length} entries`;
  return JSON.stringify(v);
}
