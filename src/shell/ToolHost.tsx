import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ToolEntry } from '../tools/registry';
import { findTool } from '../tools/registry';
import type { Asset, DefaultsManifest, EmitFn, MountContext, MountResult } from '../tools/types';
import { assets, loadAssets, loadInto, markMounted } from '../lib/assets';
import { loadSettings } from '../lib/settings';
import { useShell } from './state';
import { DefaultsList } from './DefaultsList';
import { ASSET_MIME } from './Tray';

type Phase = 'loading' | 'ready' | 'error';

/** Mounts a ready tool into shell-owned DOM nodes: the stage and the inspector. */
export function ToolHost({ entry }: { entry: ToolEntry }) {
  const shell = useShell();
  const navigate = useNavigate();
  const stageRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [defaults, setDefaults] = useState<DefaultsManifest>([]);

  useEffect(() => {
    const stage = stageRef.current!, inspector = inspectorRef.current!;
    let cancelled = false;
    let result: MountResult | null = null;
    let unmarkMounted: (() => void) | null = null;
    setPhase('loading'); setError(''); setDefaults([]);

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
        const [tool, settings] = await Promise.all([entry.load!(), loadSettings(entry.id), loadAssets()]);
        if (cancelled) return;
        const ctx: MountContext = {
          defaults: Object.fromEntries(tool.defaults.map(d => [d.key, d.value])),
          stage, inspector, assets, settings, emit,
          statusbar: { set: info => shell.setStatus(info), clear: () => shell.setStatus({}) },
        };
        result = tool.mount(ctx);
        shell.exportRef.current = typeof result === 'object' && result.export ? result.export : null;
        setDefaults(tool.defaults);
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
      try { if (result) (typeof result === 'function' ? result : result.unmount)(); }
      catch (e) { console.error(`[lathe] ${entry.id} failed to unmount`, e); }
      stage.replaceChildren();
      inspector.replaceChildren();
      shell.setStatus({});
    };
    // Shell callbacks are stable; remount only when the tool changes.
  }, [entry.id]);

  return (
    <>
      <section className="stage" aria-label={`${entry.name} stage`}>
        <div className="stage__tool" ref={stageRef} data-tool={entry.id} />
        {phase === 'loading' && <div className="stage__note">Loading {entry.name}</div>}
        {phase === 'error' && <div className="stage__note">{entry.name} failed to load. {error}</div>}
      </section>
      <aside className="inspector" aria-label="Inspector">
        <div className="inspector__tool" ref={inspectorRef} />
        <DefaultsList defaults={defaults} />
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
