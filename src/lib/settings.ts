/* Per-tool settings in IndexedDB (store "settings", key = tool id). Loaded before mount so
   tools can read synchronously; each write persists the whole record. */
import type { SettingsAPI } from '../tools/types';
import { idbGet, idbSet } from './idb';
import { REVERSE_ALIASES } from '../tools/registry';

export async function loadSettings(toolId: string): Promise<SettingsAPI> {
  let raw = await idbGet<Record<string, unknown>>('settings', toolId);
  // One-time migration: if no settings under new id, copy from old id
  if ((!raw || Object.keys(raw).length === 0) && REVERSE_ALIASES[toolId]) {
    const old = await idbGet<Record<string, unknown>>('settings', REVERSE_ALIASES[toolId]);
    if (old && typeof old === 'object' && Object.keys(old).length > 0) {
      await idbSet('settings', toolId, old);
      raw = old;
    }
  }
  const data: Record<string, unknown> = raw && typeof raw === 'object' ? { ...raw } : {};
  return {
    get<T>(key: string, fallback: T): T {
      return key in data ? (data[key] as T) : fallback;
    },
    set(key, value) {
      data[key] = value;
      void idbSet('settings', toolId, { ...data });
    },
    remove(key) {
      if (!(key in data)) return;
      delete data[key];
      void idbSet('settings', toolId, { ...data });
    },
    all: () => ({ ...data }),
  };
}

/* Shell preferences (rail collapsed, tray open) share the same store under a reserved key. */
const SHELL_KEY = '__shell';
export async function loadShellPrefs(): Promise<Record<string, unknown>> {
  return (await idbGet<Record<string, unknown>>('settings', SHELL_KEY)) ?? {};
}
export function saveShellPrefs(prefs: Record<string, unknown>) {
  void idbSet('settings', SHELL_KEY, prefs);
}
