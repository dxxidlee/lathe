import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ToolEntry } from '../tools/registry';
import { findTool } from '../tools/registry';
import type { Asset, DefaultsManifest, EmitFn, MountContext, MountResult } from '../tools/types';
import { assets, loadAssets, loadInto, markMounted } from '../lib/assets';
import { loadSettings } from '../lib/settings';
import { changedKeys, effective, loadApplied, loadEdits, same, saveApplied, saveEdits, type Edits } from '../lib/defaults';
import { forkTool } from '../lib/fork';
import { useShell } from './state';
import { DefaultsPanel } from './DefaultsPanel';
import { ASSET_MIME } from './Tray';

type Phase = 'loading' | 'ready' | 'error';

/** Mounts a ready tool into shell-owned DOM nodes (stage, inspector) with its effective defaults.
    Editing a default saves it and remounts the tool, so the change applies at once. */
export function ToolHost({ entry }: { entry: ToolEntry }) {
  const shell = useShell();
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState<DefaultsManifest>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [version, setVersion] = useState(0);
  const editsRef = useRef<Edits>({});
  editsRef.current = edits;

  useEffect(() => {
    const stage = stageRef.current!, inspector = inspectorRef.current!;
    let cancelled = false;
    let result: MountResult | null = null;
    let unmarkMounted: (() => void) | null = null;
    setPhase('loading'); setError('');

    const emit: EmitFn = ((event: 'send' | 'toast', a: Asset | string, target?: string) => {
      if (event === 'toast') shell.toast(String(a));
      else if (event === 'send' && typeof a === 'object' && target) {
        const t = findTool(target);
        if (!t?.load) { shell.toast(`${t?.name ?? target} is not built yet`); return; }
        navigate(`/t/${target}`);
        loadInto(a, target);
      }
    }) as EmitFn;

    (async () => {
      try {
        const [tool, settings, savedEdits, applied] = await Promise.all([
          entry.load!(), loadSettings(entry.id), loadEdits(entry.id), loadApplied(entry.id), loadAssets(),
        ]);
        if (cancelled) return;
        // Drop edits for keys the manifest no longer has.
        const known = new Set(tool.defaults.map(d => d.key));
        const live: Edits = Object.fromEntries(Object.entries(savedEdits).filter(([k]) => known.has(k)));
        const values = effective(tool.defaults, live);
        const changed = changedKeys(applied, values);
        // A changed default replaces the working value saved under the same key.
        for (const k of changed) settings.remove(k);
        void saveApplied(entry.id, values);
        setManifest(tool.defaults); setEdits(live);
        const ctx: MountContext = {
          defaults: values, changedDefaults: changed,
          stage, inspector, assets, settings, emit,
          statusbar: { set: info => shell.setStatus(info), clear: () => shell.setStatus({}) },
        };
        shell.forkRef.current = () => void doFork(tool.defaults);
        result = tool.mount(ctx);
        shell.exportRef.current = typeof result === 'object' && result.export ? result.export : null;
        setPhase('ready');
        unmarkMounted = markMounted(entry.id);
      } catch (e) {
        console.error(`[lathe] ${entry.id} failed to mount`, e);
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setPhase('error'); }
      }
    })();

    return () => {
      cancelled = true;
      unmarkMounted?.();
      shell.exportRef.current = null;
      shell.forkRef.current = null;
      try { if (result) (typeof result === 'function' ? result : result.unmount)(); }
      catch (e) { console.error(`[lathe] ${entry.id} failed to unmount`, e); }
      stage.replaceChildren();
      inspector.replaceChildren();
      shell.setStatus({});
    };
    // Shell callbacks are stable; remount when the tool or its defaults change.
  }, [entry.id, version]);

  async function doFork(m: DefaultsManifest) {
    try {
      const r = await forkTool({ id: entry.id, name: entry.name, group: entry.group, manifest: m, edits: editsRef.current });
      const n = Object.keys(editsRef.current).length;
      shell.toast(`Forked ${entry.name}: ${r.files.length} files, ${n} ${n === 1 ? 'change' : 'changes'} from the maker`);
    } catch (e) {
      console.error('[lathe] fork failed', e);
      shell.toast('Fork failed');
    }
  }

  const persist = async (next: Edits, remount: boolean) => {
    setEdits(next); editsRef.current = next;
    await saveEdits(entry.id, next);
    if (remount) setVersion(v => v + 1);
  };
  const onEdit = (key: string, value: unknown) => {
    const d = manifest.find(x => x.key === key)!;
    const next = { ...edits };
    if (same(value, d.value)) delete next[key];
    else next[key] = { value, reason: edits[key]?.reason, at: Date.now() };
    void persist(next, true);
  };
  const onReason = (key: string, reason: string) => {
    if (!edits[key] || (edits[key].reason ?? '') === reason) return;
    void persist({ ...edits, [key]: { ...edits[key], reason } }, false);
  };
  const onResetRow = (key: string) => { const next = { ...edits }; delete next[key]; void persist(next, true); };
  const onResetAll = () => void persist({}, true);

  return (
    <>
      <section className="stage" aria-label={`${entry.name} stage`}>
        <div className="stage__tool" ref={stageRef} data-tool={entry.id} />
        {phase === 'loading' && <div className="stage__note">Loading {entry.name}</div>}
        {phase === 'error' && (
          <div className="stage__note stage__note--error">
            <p>{entry.name} failed to start. {error}</p>
            {Object.keys(edits).length > 0 && <button type="button" className="l-btn l-btn--primary" onClick={onResetAll}>Reset to maker’s defaults</button>}
          </div>
        )}
      </section>
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector__tool" ref={inspectorRef} />
        <DefaultsPanel manifest={manifest} edits={edits} onEdit={onEdit} onReason={onReason}
          onResetRow={onResetRow} onResetAll={onResetAll} onFork={() => shell.runFork()} />
      </aside>
    </>
  );
}

/** Stage + inspector for tools that are not built yet. */
export function PlannedTool({ entry }: { entry: ToolEntry }) {
  return (
    <>
      <section className="stage stage--planned" aria-label={`${entry.name} stage`}>
        <div className="planned">
          <div className="planned__group">{entry.group}</div>
          <h1 className="planned__name">{entry.name}</h1>
          <p className="planned__blurb">{entry.blurb}</p>
          <p className="planned__when tabular">Arrives in milestone {entry.milestone}</p>
        </div>
      </section>
      <aside className="inspector" aria-label="Inspector">
        <section className="l-section">
          <h3 className="l-section__title">Inspector</h3>
          <p className="l-note">Controls appear when {entry.name} is built. Dropped files still land in the tray.</p>
        </section>
      </aside>
    </>
  );
}

/* ---- Drop anywhere: files and tray items load into the active tool ---- */
export function useStageDrop(entry: ToolEntry | undefined) {
  const shell = useShell();
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  const hasPayload = (e: React.DragEvent) => {
    const types = Array.from(e.dataTransfer.types);
    return types.includes('Files') || types.includes(ASSET_MIME);
  };

  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => { if (!hasPayload(e)) return; depth.current++; setOver(true); },
      onDragOver: (e: React.DragEvent) => { if (!hasPayload(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
      onDrop: async (e: React.DragEvent) => {
        if (!hasPayload(e)) return;
        e.preventDefault();
        depth.current = 0; setOver(false);
        const id = e.dataTransfer.getData(ASSET_MIME);
        let first: Asset | undefined = id ? assets.get(id) : undefined;
        if (!first) {
          const files = Array.from(e.dataTransfer.files);
          for (const f of files) {
            const a = await assets.add(f, { source: 'drop' });
            first ??= a;
          }
        }
        if (!first) return;
        if (entry?.load) loadInto(first, entry.id);
        else shell.toast(`Added ${first.name} to the tray`);
      },
    },
  };
}
