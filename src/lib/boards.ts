import { supabase } from './supabase';
import { idbGet, idbSet } from './idb';
import type { Swatch } from './color';

export interface BoardItem {
  id: string;
  sourceId: string;
  source: string;
  title: string | null;
  creator: string | null;
  date: string | null;
  year: number | null;
  imageUrl: string;
  thumbUrl: string;
  width: number | null;
  height: number | null;
  license: string;
  isPublicDomain: boolean;
  sourceUrl: string;
  type: string | null;
  palette?: Swatch[];
  position: number;
}

export interface Board {
  id: string;
  name: string;
  query: string;
  visibility: 'private' | 'unlisted';
  shareSlug: string | null;
  items: BoardItem[];
  createdAt: number;
  updatedAt: number;
}

const IDB_KEY = '__boards';
let _userId: string | null = null;
export function setBoardUser(id: string | null) { _userId = id; }

// 12+ char random slug
function randomSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 14; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ---- IDB (guest mode) ----

async function loadLocal(): Promise<Board[]> {
  return (await idbGet<Board[]>('settings', IDB_KEY)) ?? [];
}

async function saveLocal(boards: Board[]): Promise<void> {
  await idbSet('settings', IDB_KEY, boards);
}

// ---- Supabase ----

async function loadCloud(): Promise<Board[]> {
  if (!supabase || !_userId) return [];
  const { data: rows, error } = await supabase
    .from('boards')
    .select('*, board_items(*)')
    .eq('user_id', _userId)
    .order('updated_at', { ascending: false });
  if (error || !rows) { console.warn('[boards] load error', error?.message); return []; }
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    query: r.query ?? '',
    visibility: r.visibility,
    shareSlug: r.share_slug,
    items: (r.board_items ?? []).sort((a: any, b: any) => a.position - b.position).map((i: any) => ({
      id: i.id,
      sourceId: i.source_id,
      source: i.source,
      title: i.title,
      creator: i.creator,
      date: i.date,
      year: i.year,
      imageUrl: i.image_url,
      thumbUrl: i.thumb_url,
      width: i.width,
      height: i.height,
      license: i.license,
      isPublicDomain: i.is_public_domain,
      sourceUrl: i.source_url,
      type: i.type,
      palette: i.palette,
      position: i.position,
    })),
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
  }));
}

// ---- Public API ----

export async function loadBoards(): Promise<Board[]> {
  if (_userId) {
    const cloud = await loadCloud();
    const local = await loadLocal();
    // Merge: cloud is source of truth, add any local-only boards
    const cloudIds = new Set(cloud.map(b => b.id));
    const merged = [...cloud, ...local.filter(b => !cloudIds.has(b.id))];
    return merged.length ? merged : local;
  }
  return loadLocal();
}

export async function createBoard(name: string, query = ''): Promise<Board> {
  const board: Board = {
    id: crypto.randomUUID(),
    name, query,
    visibility: 'private',
    shareSlug: null,
    items: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (_userId && supabase) {
    const { data, error } = await supabase.from('boards').insert({
      user_id: _userId, name, query,
    }).select('id').single();
    if (data) board.id = data.id;
    if (error) console.warn('[boards] create error', error.message);
  }
  const local = await loadLocal();
  local.push(board);
  await saveLocal(local);
  return board;
}

let saveTimer = 0;
export function saveBoard(board: Board): void {
  board.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveBoardNow(board), 300);
}

async function saveBoardNow(board: Board): Promise<void> {
  // Save to IDB
  const local = await loadLocal();
  const idx = local.findIndex(b => b.id === board.id);
  if (idx >= 0) local[idx] = board; else local.push(board);
  await saveLocal(local);

  // Save to cloud
  if (!_userId || !supabase) return;
  await supabase.from('boards').upsert({
    id: board.id, user_id: _userId, name: board.name, query: board.query,
    visibility: board.visibility, share_slug: board.shareSlug,
  });
  // Sync items: delete all then re-insert (simplest for reorder)
  await supabase.from('board_items').delete().eq('board_id', board.id);
  if (board.items.length) {
    await supabase.from('board_items').insert(board.items.map((it, i) => ({
      board_id: board.id,
      position: i,
      source_id: it.sourceId,
      source: it.source,
      title: it.title,
      creator: it.creator,
      date: it.date,
      year: it.year,
      image_url: it.imageUrl,
      thumb_url: it.thumbUrl,
      width: it.width,
      height: it.height,
      license: it.license,
      is_public_domain: it.isPublicDomain,
      source_url: it.sourceUrl,
      type: it.type,
      palette: it.palette ?? null,
    })));
  }
}

export async function deleteBoard(id: string): Promise<void> {
  const local = await loadLocal();
  await saveLocal(local.filter(b => b.id !== id));
  if (_userId && supabase) {
    await supabase.from('boards').delete().eq('id', id).eq('user_id', _userId);
  }
}

export async function renameBoard(board: Board, name: string): Promise<void> {
  board.name = name;
  saveBoard(board);
}

export async function toggleSharing(board: Board): Promise<Board> {
  if (board.visibility === 'private') {
    board.visibility = 'unlisted';
    board.shareSlug = board.shareSlug ?? randomSlug();
  } else {
    board.visibility = 'private';
  }
  saveBoard(board);
  return board;
}

export async function getSharedBoard(slug: string): Promise<any> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_shared_board', { slug });
  if (error) { console.warn('[boards] shared board error', error.message); return null; }
  return data;
}

// Migration: convert old collections to boards
export function migrateCollections(collections: Array<{ id: string; name: string; items: any[] }>, query: string): Board[] {
  return collections.map(c => ({
    id: c.id,
    name: c.name,
    query,
    visibility: 'private' as const,
    shareSlug: null,
    items: c.items.map((it: any, i: number) => ({
      id: it.id || crypto.randomUUID(),
      sourceId: it.id,
      source: it.source,
      title: it.title,
      creator: it.creator,
      date: it.date,
      year: it.year,
      imageUrl: it.imageUrl,
      thumbUrl: it.thumbUrl,
      width: it.width,
      height: it.height,
      license: it.license,
      isPublicDomain: it.isPublicDomain,
      sourceUrl: it.sourceUrl,
      type: it.type,
      palette: it.swatches,
      position: i,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}
