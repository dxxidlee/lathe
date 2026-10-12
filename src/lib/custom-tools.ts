/* Storage and execution layer for user-created custom tools.
   Tools live in IDB 'settings' store under a single key. */

import { idbGet, idbSet } from './idb';
import type { MountContext } from '../tools/types';

export interface CustomTool {
  id: string;
  name: string;
  group: string;
  description: string;
  defaults: Array<{
    key: string; label: string; value: unknown; unit?: string;
    options?: (string | number)[]; min?: number; max?: number; step?: number;
  }>;
  code: string;
  createdAt: number;
  prompt: string;
}

const STORE_KEY = '__custom:tools';

export async function loadCustomTools(): Promise<CustomTool[]> {
  return (await idbGet<CustomTool[]>('settings', STORE_KEY)) ?? [];
}

export async function saveCustomTool(tool: CustomTool): Promise<void> {
  const all = await loadCustomTools();
  const idx = all.findIndex(t => t.id === tool.id);
  if (idx >= 0) all[idx] = tool; else all.push(tool);
  await idbSet('settings', STORE_KEY, all);
}

export async function deleteCustomTool(id: string): Promise<void> {
  const all = await loadCustomTools();
  await idbSet('settings', STORE_KEY, all.filter(t => t.id !== id));
}

export function mountCustomTool(tool: CustomTool, ctx: MountContext): () => void {
  let unmount: (() => void) | null = null;
  try {
    // shortcut: new Function is intentional — user-authored code, same trust as console
    const result = new Function('ctx', tool.code)(ctx);
    if (typeof result === 'function') unmount = result;
    else if (result && typeof result === 'object' && typeof result.unmount === 'function') unmount = result.unmount;
  } catch (e) {
    console.error(`[lathe] custom tool "${tool.id}" crashed on mount`, e);
    ctx.stage.textContent = '';
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:#ff6b6b;padding:1rem;white-space:pre-wrap;font-size:13px';
    pre.textContent = `Custom tool error:\n${e instanceof Error ? e.message : String(e)}`;
    ctx.stage.appendChild(pre);
  }
  return unmount ?? (() => {});
}
