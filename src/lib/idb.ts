/* IndexedDB key-value stores. Every call is wrapped: if IndexedDB is missing, blocked
   (private mode, storage pressure) or throws, Lathe keeps working from memory for the session. */

const DB_NAME = 'lathe';
const DB_VERSION = 1;
export const STORES = ['assets', 'settings', 'cache'] as const;
export type StoreName = (typeof STORES)[number];

const memory: Record<StoreName, Map<string, unknown>> = { assets: new Map(), settings: new Map(), cache: new Map() };
let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        try { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); }
        catch (e) { console.warn('[lathe] idb upgrade failed', e); }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { console.warn('[lathe] idb unavailable, using memory', req.error); resolve(null); };
      req.onblocked = () => resolve(null);
    } catch (e) {
      console.warn('[lathe] idb unavailable, using memory', e);
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then(db => new Promise<T | undefined>(resolve => {
    if (!db) return resolve(undefined);
    try {
      const tx = db.transaction(store, mode);
      const req = op(tx.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { console.warn('[lathe] idb', store, req.error); resolve(undefined); };
      tx.onabort = () => resolve(undefined);
    } catch (e) {
      console.warn('[lathe] idb', store, e);
      resolve(undefined);
    }
  }));
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    const db = await open();
    if (!db) return memory[store].get(key) as T | undefined;
    return await run<T>(store, 'readonly', s => s.get(key) as IDBRequest<T>);
  } catch (e) { console.warn('[lathe] idbGet', e); return memory[store].get(key) as T | undefined; }
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  try {
    memory[store].set(key, value);
    const db = await open();
    if (db) await run(store, 'readwrite', s => s.put(value, key));
  } catch (e) { console.warn('[lathe] idbSet', e); }
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  try {
    memory[store].delete(key);
    const db = await open();
    if (db) await run(store, 'readwrite', s => s.delete(key));
  } catch (e) { console.warn('[lathe] idbDelete', e); }
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  try {
    const db = await open();
    if (!db) return [...memory[store].values()] as T[];
    return (await run<T[]>(store, 'readonly', s => s.getAll() as IDBRequest<T[]>)) ?? [];
  } catch (e) { console.warn('[lathe] idbAll', e); return [...memory[store].values()] as T[]; }
}

/* ---- Response cache with TTL (Audit uses 24h) ---- */
interface CacheRow<T> { value: T; expires: number }

export async function cacheGet<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<CacheRow<T>>('cache', key);
  if (!row) return undefined;
  if (row.expires < Date.now()) { void idbDelete('cache', key); return undefined; }
  return row.value;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  return idbSet('cache', key, { value, expires: Date.now() + ttlMs });
}

export async function idbClear(store: StoreName): Promise<void> {
  try {
    memory[store].clear();
    const db = await open();
    if (db) await run(store, 'readwrite', s => s.clear());
  } catch (e) { console.warn('[lathe] idbClear', e); }
}
