/* The tool contract. Every tool is a framework-agnostic module that the shell mounts
   into DOM nodes it owns. See CLAUDE.md "Tool contract". */

export const GROUPS = ['Workbench', 'Drawer', 'Offcuts'] as const;
export type ToolGroup = (typeof GROUPS)[number];

/** One starting default, shown (and later editable) in the Defaults panel. */
export interface DefaultEntry<V = unknown> {
  key: string;
  label: string;
  value: V;
  unit?: string;
  /* ---- Editing hints for the Defaults panel (all optional) ---- */
  /** Allowed values: a select for scalars, toggle chips for arrays. */
  options?: (string | number)[];
  min?: number;
  max?: number;
  step?: number;
  /** false for descriptive rows the code does not read (shown, not editable). */
  editable?: boolean;
}
export type DefaultsManifest = DefaultEntry[];

/** A file in the shared asset tray. */
export interface Asset {
  id: string;
  name: string;
  type: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
  source: 'drop' | 'paste' | 'export' | 'fetch' | 'tool';
  /** Tool that produced it, for exports. */
  origin?: string;
  blob: Blob;
}

export interface AssetAddOptions {
  name?: string;
  source?: Asset['source'];
  origin?: string;
}

export type AssetEvent =
  | { type: 'add'; asset: Asset }
  | { type: 'remove'; id: string }
  /** An asset was handed to a tool: dropped on its stage, or sent to it from another tool or the tray. */
  | { type: 'load'; asset: Asset; target: string };

export interface AssetsAPI {
  get(id: string): Asset | undefined;
  list(): Asset[];
  add(file: Blob | File, opts?: AssetAddOptions): Promise<Asset>;
  remove(id: string): Promise<void>;
  onChange(cb: (e: AssetEvent) => void): () => void;
}

/** Per-tool settings, loaded before mount so reads are synchronous; writes persist to IndexedDB. */
export interface SettingsAPI {
  get<T>(key: string, fallback: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  all(): Record<string, unknown>;
}

/** Structured status bar: e.g. `hardaun-logo.png  3750×450  31 KB`, state on the right. */
export interface StatusInfo {
  name?: string;
  width?: number;
  height?: number;
  bytes?: number;
  state?: string;
}
export interface StatusbarAPI {
  set(info: StatusInfo): void;
  clear(): void;
}

export interface EmitFn {
  /** Hand an asset to another tool. The shell switches to it and fires a `load` event there. */
  (event: 'send', asset: Asset, targetToolId: string): void;
  /** Transient message in the shell. */
  (event: 'toast', message: string): void;
}

export interface MountContext {
  defaults: Record<string, unknown>;
  changedDefaults: string[];
  stage: HTMLElement;
  inspector: HTMLElement;
  statusbar: StatusbarAPI;
  assets: AssetsAPI;
  settings: SettingsAPI;
  emit: EmitFn;
  onActivate: (cb: (active: boolean) => void) => () => void;
  /** If the user is signed out, opens the auth modal and calls `action` after login. Returns true if auth was needed. */
  requireAuth: (action: () => void) => boolean;
}

export type Unmount = () => void;
/** `mount` returns its unmount function, or an object when the tool also answers shell actions (Cmd+E). */
export type MountResult = Unmount | { unmount: Unmount; export?: () => void };

export interface LatheTool {
  id: string;
  name: string;
  group: ToolGroup;
  defaults: DefaultsManifest;
  /** MIME patterns the tool can load (e.g. 'image/*'). Used for drop hints and "Send to" menus. */
  accepts?: string[];
  mount(ctx: MountContext): MountResult;
}

export function matchesAccept(type: string, accepts: string[] | undefined): boolean {
  if (!accepts || !accepts.length) return false;
  return accepts.some(a => a === '*/*' || a === type || (a.endsWith('/*') && type.startsWith(a.slice(0, -1))));
}
