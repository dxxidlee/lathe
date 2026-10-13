import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { numberedTools } from '../tools/registry';
import { useShell } from './state';

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

/** Global shortcuts: 1–9 switch tools, Cmd+K palette, Cmd+E export, Alt+W close tab, etc. */
export function Keyboard() {
  const shell = useShell();
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && !e.shiftKey && !e.altKey && k === 'k') { e.preventDefault(); shell.setPaletteOpen(!shell.paletteOpen); return; }
      if (mod && !e.shiftKey && !e.altKey && k === 'e') { e.preventDefault(); shell.runExport(); return; }
      if (mod && k === '\\') { e.preventDefault(); shell.toggleRail(); return; }
      if (e.altKey && !mod && k === 'w') { e.preventDefault(); shell.closeTab(shell.activeTabId); return; }
      if (e.altKey && e.shiftKey && k === '[') { e.preventDefault(); shell.prevTab(); return; }
      if (e.altKey && e.shiftKey && k === ']') { e.preventDefault(); shell.nextTab(); return; }
      if (mod || e.altKey || typing(e.target) || shell.paletteOpen || shell.sheetOpen) return;
      if (e.key === '?') { e.preventDefault(); shell.setSheetOpen(true); return; }
      if (/^[1-9]$/.test(e.key)) {
        const t = numberedTools()[Number(e.key) - 1];
        if (t) { e.preventDefault(); shell.openTab(t.id); navigate(`/t/${t.id}`); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shell, navigate]);
  return null;
}
