import { supabase } from './supabase';
import type { CustomTool } from './custom-tools';

// ---------- Custom tools ----------

export async function cloudLoadTools(userId: string): Promise<CustomTool[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('custom_tools')
    .select('*')
    .eq('user_id', userId)
    .order('created_at');
  if (error) { console.warn('[lathe] cloud load tools', error.message); return []; }
  return (data ?? []).map(row => ({
    id: row.tool_id,
    name: row.name,
    group: row.group,
    description: row.description ?? '',
    defaults: row.defaults ?? [],
    code: row.code,
    createdAt: new Date(row.created_at).getTime(),
    prompt: row.prompt ?? '',
    versions: row.versions ?? [],
    currentVersionIndex: row.current_version ?? 0,
    chat: row.chat ?? [],
  }));
}

export async function cloudSaveTool(userId: string, tool: CustomTool): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('custom_tools')
    .upsert({
      user_id: userId,
      tool_id: tool.id,
      name: tool.name,
      group: tool.group,
      description: tool.description,
      defaults: tool.defaults,
      code: tool.code,
      prompt: tool.prompt,
      versions: tool.versions,
      current_version: tool.currentVersionIndex,
      chat: tool.chat,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tool_id' });
  if (error) console.warn('[lathe] cloud save tool', error.message);
}

export async function cloudDeleteTool(userId: string, toolId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('custom_tools')
    .delete()
    .eq('user_id', userId)
    .eq('tool_id', toolId);
  if (error) console.warn('[lathe] cloud delete tool', error.message);
}

// ---------- Library items ----------

export interface LibraryItem {
  id: string;
  type: string;
  name: string;
  toolId: string | null;
  data: unknown;
  storagePath: string | null;
  thumbnailPath: string | null;
  createdAt: number;
}

export async function cloudLoadLibrary(userId: string): Promise<LibraryItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('library_items')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[lathe] cloud load library', error.message); return []; }
  return (data ?? []).map(row => ({
    id: row.id,
    type: row.type,
    name: row.name,
    toolId: row.tool_id,
    data: row.data,
    storagePath: row.storage_path,
    thumbnailPath: row.thumbnail_path,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

export async function cloudSaveItem(userId: string, item: {
  type: string; name: string; toolId?: string; data?: unknown; storagePath?: string;
}): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('library_items')
    .insert({
      user_id: userId,
      type: item.type,
      name: item.name,
      tool_id: item.toolId ?? null,
      data: item.data ?? null,
      storage_path: item.storagePath ?? null,
    })
    .select('id')
    .single();
  if (error) { console.warn('[lathe] cloud save item', error.message); return null; }
  return data?.id ?? null;
}

export async function cloudUpdateItem(userId: string, itemId: string, patch: {
  name?: string; data?: unknown;
}): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('library_items')
    .update(patch)
    .eq('user_id', userId)
    .eq('id', itemId);
  if (error) console.warn('[lathe] cloud update item', error.message);
}

export async function cloudDeleteItem(userId: string, itemId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('library_items')
    .delete()
    .eq('user_id', userId)
    .eq('id', itemId);
  if (error) console.warn('[lathe] cloud delete item', error.message);
}

// ---------- Storage ----------

export async function cloudUpload(userId: string, itemId: string, file: Blob, filename: string): Promise<string | null> {
  if (!supabase) return null;
  const path = `${userId}/${itemId}/${filename}`;
  const { error } = await supabase.storage.from('library').upload(path, file, { upsert: true });
  if (error) { console.warn('[lathe] cloud upload', error.message); return null; }
  return path;
}

export async function cloudDownload(path: string): Promise<Blob | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from('library').download(path);
  if (error) { console.warn('[lathe] cloud download', error.message); return null; }
  return data;
}

// ---------- IDB migration ----------

export async function migrateIdbToCloud(userId: string): Promise<{ tools: number; items: number }> {
  // Import here to avoid circular deps
  const { loadCustomTools: loadLocal } = await import('./custom-tools');
  const localTools = await loadLocal();
  let tools = 0;
  for (const t of localTools) {
    await cloudSaveTool(userId, t);
    tools++;
  }
  return { tools, items: 0 };
}
