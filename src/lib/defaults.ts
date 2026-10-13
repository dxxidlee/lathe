/* Defaults edits: per tool, what the person changed from the maker's manifest and why.
   Stored in IndexedDB (store "settings") under reserved keys, next to the tool's own settings. */
import type { DefaultEntry, DefaultsManifest } from '../tools/types';
import { idbGet, idbSet } from './idb';
import { REVERSE_ALIASES } from '../tools/registry';

export interface DefaultEdit { value: unknown; at: number }
export type Edits = Record<string, DefaultEdit>;

const EDITS = (id: string) => `__defaults:${id}`;
const APPLIED = (id: string) => `__applied:${id}`;

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Keys relevant to each audit sub-tool when migrating from the combined 'audit' defaults
const SUBJECT_AUDIT_KEYS = [
  'resultsPerSource', 'paletteSwatch', 'paletteSpace', 'yearFrom', 'yearTo',
  'publicDomainOnly', 'colorDistance', 'deckTheme',
];
const BRAND_AUDIT_KEYS = [
  'cssColorMerge', 'waybackYears', 'observationModel',
  'paletteSwatch', 'paletteSpace',
];

/** Filter edits to only the keys relevant to a specific audit sub-tool. */
function filterAuditEdits(edits: Edits, toolId: string): Edits {
  const keys = toolId === 'subject-audit' ? SUBJECT_AUDIT_KEYS
    : toolId === 'brand-audit' ? BRAND_AUDIT_KEYS
    : null;
  if (!keys) return edits;
  return Object.fromEntries(Object.entries(edits).filter(([k]) => keys.includes(k)));
}

export async function loadEdits(toolId: string): Promise<Edits> {
  let e = await idbGet<Edits>('settings', EDITS(toolId));
  if ((!e || Object.keys(e).length === 0) && REVERSE_ALIASES[toolId]) {
    const old = await idbGet<Edits>('settings', EDITS(REVERSE_ALIASES[toolId]));
    if (old && typeof old === 'object' && Object.keys(old).length > 0) {
      const migrated = filterAuditEdits(old, toolId);
      await idbSet('settings', EDITS(toolId), migrated);
      e = migrated;
    }
  }
  return e && typeof e === 'object' ? e : {};
}
export function saveEdits(toolId: string, edits: Edits) { return idbSet('settings', EDITS(toolId), edits); }

/** The values a tool sees: the maker's, with the person's edits applied. */
export function effective(manifest: DefaultsManifest, edits: Edits): Record<string, unknown> {
  return Object.fromEntries(manifest.map(d => [d.key, d.key in edits ? edits[d.key].value : d.value]));
}

/** Effective values at the tool's last mount, to detect what changed in between. */
export async function loadApplied(toolId: string) {
  let a = await idbGet<Record<string, unknown>>('settings', APPLIED(toolId));
  if ((!a || Object.keys(a).length === 0) && REVERSE_ALIASES[toolId]) {
    const old = await idbGet<Record<string, unknown>>('settings', APPLIED(REVERSE_ALIASES[toolId]));
    if (old && typeof old === 'object' && Object.keys(old).length > 0) {
      await idbSet('settings', APPLIED(toolId), old);
      a = old;
    }
  }
  return a;
}
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
