import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StatusInfo } from '../tools/types';
import { loadShellPrefs, saveShellPrefs } from '../lib/settings';

interface Toast { id: number; message: string }

interface ShellState {
  navCollapsed: boolean;
  toggleNav: () => void;
  trayOpen: boolean;
  toggleTray: (open?: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  sheetOpen: boolean;
  setSheetOpen: (v: boolean) => void;
  status: StatusInfo;
  setStatus: (s: StatusInfo) => void;
  toasts: Toast[];
  toast: (message: string) => void;
  /** Set by the mounted tool when it answers Cmd+E. */
  exportRef: React.MutableRefObject<(() => void) | null>;
  /** Set by the tool host while a built tool is mounted. */
  forkRef: React.MutableRefObject<(() => void) | null>;
  runExport: () => void;
  runFork: () => void;
}

const Ctx = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState<StatusInfo>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const exportRef = useRef<(() => void) | null>(null);
  const forkRef = useRef<(() => void) | null>(null);
  const prefsLoaded = useRef(false);

  useEffect(() => {
    loadShellPrefs().then(p => {
      if (typeof p.navCollapsed === 'boolean') setNavCollapsed(p.navCollapsed);
      if (typeof p.trayOpen === 'boolean') setTrayOpen(p.trayOpen);
      prefsLoaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (prefsLoaded.current) saveShellPrefs({ navCollapsed, trayOpen });
  }, [navCollapsed, trayOpen]);

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400);
  }, []);

  const runExport = useCallback(() => {
    if (exportRef.current) exportRef.current();
    else toast('Nothing to export here yet');
  }, [toast]);
  const runFork = useCallback(() => {
    if (forkRef.current) forkRef.current();
    else toast('Open a built tool to fork it');
  }, [toast]);

  const value = useMemo<ShellState>(() => ({
    navCollapsed, toggleNav: () => setNavCollapsed(v => !v),
    trayOpen, toggleTray: (open?: boolean) => setTrayOpen(v => (open === undefined ? !v : open)),
    paletteOpen, setPaletteOpen, sheetOpen, setSheetOpen,
    status, setStatus, toasts, toast, exportRef, forkRef, runExport, runFork,
  }), [navCollapsed, trayOpen, paletteOpen, sheetOpen, status, toasts, toast, runExport, runFork]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside ShellProvider');
  return v;
}
