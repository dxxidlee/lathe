/* Storage and execution layer for user-created custom tools.
   Tools live in IDB 'settings' store under a single key. */

import { idbGet, idbSet } from './idb';
import type { MountContext } from '../tools/types';

export interface ToolVersion {
  id: string;
  code: string;
  name: string;
  group: string;
  description: string;
  defaults: Array<{
    key: string; label: string; value: unknown; unit?: string;
    options?: (string | number)[]; min?: number; max?: number; step?: number;
  }>;
  createdAt: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  versionId: string | null;
  error?: string;
}

export interface CustomTool {
  id: string;
  name: string;
  group: string;
  description: string;
  defaults: ToolVersion['defaults'];
  code: string;
  createdAt: number;
  prompt: string;
  versions: ToolVersion[];
  currentVersionIndex: number;
  chat: ChatMessage[];
}

const STORE_KEY = '__custom:tools';

function migrate(raw: any): CustomTool {
  if (raw.versions) return raw;
  const v: ToolVersion = {
    id: `v_${Date.now().toString(36)}`,
    code: raw.code || '',
    name: raw.name || 'Custom tool',
    group: raw.group || 'Offcuts',
    description: raw.description || '',
    defaults: raw.defaults || [],
    createdAt: raw.createdAt || Date.now(),
  };
  return {
    ...raw,
    versions: [v],
    currentVersionIndex: 0,
    chat: raw.prompt ? [{ role: 'user' as const, content: raw.prompt, versionId: null }] : [],
  };
}

export async function loadCustomTools(): Promise<CustomTool[]> {
  const raw = (await idbGet<any[]>('settings', STORE_KEY)) ?? [];
  return raw.map(migrate);
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

export function currentVersion(tool: CustomTool): ToolVersion {
  return tool.versions[tool.currentVersionIndex] ?? tool.versions[tool.versions.length - 1];
}

export function addVersion(tool: CustomTool, v: ToolVersion): CustomTool {
  const versions = [...tool.versions, v];
  return {
    ...tool,
    versions,
    currentVersionIndex: versions.length - 1,
    name: v.name,
    group: v.group,
    description: v.description,
    defaults: v.defaults,
    code: v.code,
  };
}

export function restoreVersion(tool: CustomTool, index: number): CustomTool {
  const v = tool.versions[index];
  if (!v) return tool;
  return {
    ...tool,
    currentVersionIndex: index,
    name: v.name,
    group: v.group,
    description: v.description,
    defaults: v.defaults,
    code: v.code,
  };
}

export async function exportLibrary(): Promise<string> {
  const tools = await loadCustomTools();
  return JSON.stringify({ lathe: 'custom-tools', version: 1, exportedAt: new Date().toISOString(), tools }, null, 2);
}

export async function importLibrary(jsonStr: string): Promise<{ imported: number; skipped: number }> {
  const data = JSON.parse(jsonStr);
  if (data?.lathe !== 'custom-tools') throw new Error('Not a Lathe custom tools file');
  const incoming: any[] = Array.isArray(data.tools) ? data.tools : [];
  const existing = await loadCustomTools();
  const ids = new Set(existing.map(t => t.id));
  let imported = 0, skipped = 0;
  for (const raw of incoming) {
    const t = migrate(raw);
    if (ids.has(t.id)) { skipped++; continue; }
    existing.push(t);
    ids.add(t.id);
    imported++;
  }
  await idbSet('settings', STORE_KEY, existing);
  return { imported, skipped };
}

export function mountCustomTool(tool: CustomTool, ctx: MountContext): () => void {
  let unmount: (() => void) | null = null;
  try {
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
