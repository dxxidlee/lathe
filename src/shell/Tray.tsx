import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { assets as store, assetUrl, loadInto } from '../lib/assets';
import { downloadBlob } from '../lib/download';
import { formatBytes, formatDims } from '../lib/format';
import { TOOLS, isReady } from '../tools/registry';
import type { Asset } from '../tools/types';
import { useAssets } from './useAssets';
import { useShell } from './state';
import { matchesAccept } from '../tools/types';

export const ASSET_MIME = 'application/x-lathe-asset';

/** Ready tools that can take this asset. */
export function sendTargets(a: Asset) {
  return TOOLS.filter(t => isReady(t) && matchesAccept(a.type, t.accepts));
}

export function sendAsset(a: Asset, toolId: string, navigate: (p: string) => void) {
  navigate(`/t/${toolId}`);
  loadInto(a, toolId);
}

/* Rendered in a portal: the tray scrolls horizontally and would clip an in-place popover. */
function SendMenu({ asset, anchor, onDone }: { asset: Asset; anchor: HTMLElement; onDone: () => void }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const targets = sendTargets(asset);
  const r = anchor.getBoundingClientRect();
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onDone(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onDone, anchor]);
  return createPortal(
    <div className="menu" role="menu" ref={ref} style={{ left: r.left, bottom: window.innerHeight - r.top }}>
      <div className="menu__label">Send to</div>
      {targets.map(t => (
        <button key={t.id} type="button" role="menuitem" className="menu__item"
          onClick={() => { onDone(); sendAsset(asset, t.id, navigate); }}>{t.name}</button>
      ))}
      {!targets.length && <div className="menu__empty">No tool takes {asset.type || 'this file'} yet</div>}
    </div>,
    document.body,
  );
}

function TrayItem({ a }: { a: Asset }) {
  const [menu, setMenu] = useState(false);
  const sendBtn = useRef<HTMLButtonElement>(null);
  const shell = useShell();
  const isImage = a.type.startsWith('image/');
  return (
    <li className="tray__item" draggable
      onDragStart={e => { e.dataTransfer.setData(ASSET_MIME, a.id); e.dataTransfer.effectAllowed = 'copy'; }}>
      <div className="tray__thumb">
        {isImage ? <img src={assetUrl(a)} alt="" draggable={false} /> : <span className="tray__ext">{a.name.split('.').pop()}</span>}
      </div>
      <div className="tray__meta">
        <span className="tray__name" title={a.name}>{a.name}</span>
        <span className="tray__info tabular">{[formatDims(a.width, a.height), formatBytes(a.size)].filter(Boolean).join('  ')}</span>
        <span className="tray__source">{a.source === 'export' ? `Export · ${a.origin ?? ''}` : a.source}</span>
      </div>
      <div className="tray__actions">
        <button type="button" className="l-btn" ref={sendBtn} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(v => !v)}>Send to</button>
        <button type="button" className="l-btn" onClick={() => downloadBlob(a.blob, a.name)}>Save</button>
        <button type="button" className="l-btn" onClick={() => { void store.remove(a.id); shell.toast(`Removed ${a.name}`); }} aria-label={`Remove ${a.name}`}>Remove</button>
      </div>
      {menu && sendBtn.current && <SendMenu asset={a} anchor={sendBtn.current} onDone={() => setMenu(false)} />}
    </li>
  );
}

export function Tray() {
  const list = useAssets();
  const shell = useShell();
  if (!shell.trayOpen) return null;
  return (
    <section className="tray" id="tray" aria-label="Asset tray">
      {list.length ? (
        <ul className="tray__list">{list.map(a => <TrayItem key={a.id} a={a} />)}</ul>
      ) : (
        <p className="tray__empty">Every file you drop, fetch or export lands here, usable by every tool.</p>
      )}
    </section>
  );
}
