import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { StatusInfo } from '../tools/types';
import { loadShellPrefs, saveShellPrefs } from '../lib/settings';
import { getUser, onAuthChange, type AuthUser } from '../lib/auth';
import { setAuthUser } from '../lib/custom-tools';
import { setBoardUser } from '../lib/boards';
import { MOBILE_QUERY } from '../lib/mobile';

interface Toast { id: number; message: string }

export interface Tab {
  id: string;      // toolId or 'make'
  pinned: boolean;
}

interface ShellState {
  railOpen: boolean;
  toggleRail: () => void;
  /** @deprecated Use railOpen / toggleRail instead */
  navCollapsed: boolean;
  /** @deprecated Use railOpen / toggleRail instead */
  toggleNav: () => void;
  trayOpen: boolean;
  toggleTray: (open?: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  sheetOpen: boolean;
  setSheetOpen: (v: boolean) => void;
  status: StatusInfo;
  setStatus: (s: StatusInfo, tabId?: string) => void;
  toasts: Toast[];
  toast: (message: string) => void;
  /** Set by the mounted tool when it answers Cmd+E. */
  exportRef: React.MutableRefObject<(() => void) | null>;
  /** Set by the mounted tool host: forget this tool's settings and reopen it fresh. */
  resetToolRef: React.MutableRefObject<(() => void) | null>;
  runExport: () => void;
  isMobile: boolean;
  menuOpen: boolean;
  toggleMenu: () => void;
  tabSwitcherOpen: boolean;
  setTabSwitcherOpen: (v: boolean) => void;
  inspectorExpanded: boolean;
  setInspectorExpanded: (v: boolean) => void;
  tabs: Tab[];
  activeTabId: string;
  openTab: (toolId: string) => void;
  closeTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  nextTab: () => void;
  prevTab: () => void;
  tabLabels: Record<string, string>;
  setTabLabel: (tabId: string, label: string) => void;
  user: AuthUser;
  authModalOpen: boolean;
  authModalView: string | null;
  showAuthModal: (cb?: () => void, view?: string) => void;
  hideAuthModal: () => void;
  authCallback: React.MutableRefObject<(() => void) | null>;
}

const Ctx = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const [railOpen, setRailOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([{ id: 'library', pinned: true }]);
  const [activeTabId, setActiveTabId] = useState('library');
  const [tabLabels, setTabLabelsRaw] = useState<Record<string, string>>({});
  const setTabLabel = useCallback((tabId: string, label: string) => {
    setTabLabelsRaw(prev => prev[tabId] === label ? prev : { ...prev, [tabId]: label });
  }, []);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalView, setAuthModalView] = useState<string | null>(null);
  const authCallback = useRef<(() => void) | null>(null);
  const showAuthModal = useCallback((cb?: () => void, view?: string) => { authCallback.current = cb ?? null; setAuthModalView(view ?? null); setAuthModalOpen(true); }, []);
  const hideAuthModal = useCallback(() => { setAuthModalOpen(false); setAuthModalView(null); authCallback.current = null; }, []);
  const statusMap = useRef(new Map<string, StatusInfo>());
  const [status, setStatusRaw] = useState<StatusInfo>({});
  const activeTabRef = useRef(activeTabId);
  activeTabRef.current = activeTabId;
  const setStatus = useCallback((info: StatusInfo, tabId?: string) => {
    const id = tabId ?? activeTabRef.current;
    statusMap.current.set(id, info);
    if (id === activeTabRef.current) setStatusRaw(info);
  }, []);
  const [user, setUser] = useState<AuthUser>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);
  const [inspectorExpanded, setInspectorExpanded] = useState(false);
  const exportRef = useRef<(() => void) | null>(null);
  const resetToolRef = useRef<(() => void) | null>(null);
  const prefsLoaded = useRef(false);
  const migrationChecked = useRef(false);

  useEffect(() => {
    loadShellPrefs().then(p => {
      if (typeof p.railOpen === 'boolean') setRailOpen(p.railOpen);
      // migrate old pref
      else if (typeof p.navCollapsed === 'boolean') setRailOpen(!p.navCollapsed);
      if (typeof p.trayOpen === 'boolean') setTrayOpen(p.trayOpen);
      if (Array.isArray(p.tabs) && p.tabs.length > 0) setTabs(p.tabs as Tab[]);
      if (typeof p.activeTabId === 'string') setActiveTabId(p.activeTabId as string);
      prefsLoaded.current = true;
    });
    getUser().then(u => { setUser(u); setAuthUser(u?.id ?? null); setBoardUser(u?.id ?? null); });
    return onAuthChange((u, event) => {
      setUser(u); setAuthUser(u?.id ?? null); setBoardUser(u?.id ?? null);
      if (event === 'PASSWORD_RECOVERY') showAuthModal(undefined, 'set-password');
    });
  }, []);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setStatusRaw(statusMap.current.get(activeTabId) ?? {});
  }, [activeTabId]);

  useEffect(() => {
    if (prefsLoaded.current) saveShellPrefs({ railOpen, trayOpen, tabs, activeTabId });
  }, [railOpen, trayOpen, tabs, activeTabId]);

  const toast = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, message }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2400);
  }, []);

  // Offer to migrate local IDB tools to the cloud on first sign-in
  useEffect(() => {
    if (!user || migrationChecked.current) return;
    migrationChecked.current = true;
    (async () => {
      const { idbGet, idbSet } = await import('../lib/idb');
      const migrated = await idbGet<boolean>('settings', `__migrated:${user.id}`);
      if (migrated) return;
      const { loadCustomTools: loadLocal } = await import('../lib/custom-tools');
      const local = await loadLocal();
      if (local.length && window.confirm(`Import ${local.length} local tool${local.length > 1 ? 's' : ''} into your account?`)) {
        const { migrateIdbToCloud } = await import('../lib/cloud-library');
        const r = await migrateIdbToCloud(user.id);
        toast(`Imported ${r.tools} tool${r.tools !== 1 ? 's' : ''}`);
      }
      await idbSet('settings', `__migrated:${user.id}`, true);
    })().catch(e => console.warn('[lathe] migration check failed', e));
  }, [user, toast]);

  const runExport = useCallback(() => {
    if (exportRef.current) exportRef.current();
    else toast('Nothing to export here yet');
  }, [toast]);

  const openTab = useCallback((toolId: string) => {
    setTabs(prev => {
      const existing = prev.find(t => t.id === toolId);
      if (existing) { setActiveTabId(toolId); return prev; }
      const lastPinned = prev.reduce((acc, t, i) => t.pinned ? i : acc, -1);
      const inserted = [...prev];
      inserted.splice(lastPinned + 1, 0, { id: toolId, pinned: false });
      setActiveTabId(toolId);
      return inserted;
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const tab = prev.find(t => t.id === id);
      if (!tab || tab.pinned) return prev;
      const idx = prev.indexOf(tab);
      const next = prev.filter(t => t.id !== id);
      setActiveTabId(cur => {
        if (cur !== id) return cur;
        // activate the tab to the left, or the first tab
        return next[Math.min(idx, next.length - 1)]?.id ?? next[0]?.id ?? 'make';
      });
      return next;
    });
  }, []);

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs(prev => {
      if (prev[from]?.pinned || prev[to]?.pinned) return prev;
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const arr = [...prev];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr;
    });
  }, []);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const nextTab = useCallback(() => {
    setActiveTabId(cur => {
      const t = tabsRef.current;
      const idx = t.findIndex(x => x.id === cur);
      return t[(idx + 1) % t.length].id;
    });
  }, []);

  const prevTab = useCallback(() => {
    setActiveTabId(cur => {
      const t = tabsRef.current;
      const idx = t.findIndex(x => x.id === cur);
      return t[(idx - 1 + t.length) % t.length].id;
    });
  }, []);

  const toggleRail = useCallback(() => setRailOpen(v => !v), []);
  const toggleMenu = useCallback(() => setMenuOpen(v => !v), []);

  const value = useMemo<ShellState>(() => ({
    railOpen, toggleRail,
    // compat aliases
    navCollapsed: !railOpen, toggleNav: toggleRail,
    trayOpen, toggleTray: (open?: boolean) => setTrayOpen(v => (open === undefined ? !v : open)),
    paletteOpen, setPaletteOpen, sheetOpen, setSheetOpen,
    status, setStatus, toasts, toast, exportRef, resetToolRef, runExport,
    isMobile, menuOpen, toggleMenu, tabSwitcherOpen, setTabSwitcherOpen,
    inspectorExpanded, setInspectorExpanded,
    tabs, activeTabId, openTab, closeTab, reorderTabs, nextTab, prevTab,
    tabLabels, setTabLabel,
    user,
    authModalOpen, authModalView, showAuthModal, hideAuthModal, authCallback,
  }), [railOpen, toggleRail, trayOpen, paletteOpen, sheetOpen, status, toasts, toast, runExport,
       isMobile, menuOpen, toggleMenu, tabSwitcherOpen, inspectorExpanded,
       tabs, activeTabId, openTab, closeTab, reorderTabs, nextTab, prevTab, tabLabels, user, authModalOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShell() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside ShellProvider');
  return v;
}
