import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { ShellProvider, useShell } from './shell/state';
import { TopBar } from './shell/TopBar';
import { NavRail } from './shell/NavRail';
import { StatusBar } from './shell/StatusBar';
import { Tray } from './shell/Tray';
import { ToolHost, PlannedTool, useStageDrop } from './shell/ToolHost';
import { CommandPalette } from './shell/CommandPalette';
import { ShortcutSheet } from './shell/ShortcutSheet';
import { Keyboard } from './shell/Keyboard';
import { MobileMenu } from './shell/MobileMenu';
import { MobileTabSwitcher } from './shell/MobileTabSwitcher';
import { findTool, loadCustomEntries } from './tools/registry';
import { toolIcon } from './shell/icons';
import { Home } from './routes/Home';
import { Make } from './routes/Make';
import { Library } from './routes/Library';
import { SharedBoard } from './routes/SharedBoard';
import { BoardView } from './routes/BoardView';
import { useEffect, useState } from 'react';

function ToolView() {
  const { toolId } = useParams();
  const shell = useShell();
  const navigate = useNavigate();

  useEffect(() => {
    if (toolId && toolId !== shell.activeTabId) {
      shell.openTab(toolId);
    }
  }, [toolId]);

  useEffect(() => {
    if (shell.activeTabId && shell.activeTabId !== toolId) {
      const path = `/t/${shell.activeTabId}`;
      navigate(path, { replace: true });
    }
  }, [shell.activeTabId]);

  const isBoard = shell.activeTabId.startsWith('board-');
  const activeEntry = shell.activeTabId === 'make' || shell.activeTabId === 'library' || isBoard ? undefined : findTool(shell.activeTabId);
  const drop = useStageDrop(activeEntry);
  const mobileMode = shell.isMobile ? (activeEntry?.mobile ?? 'full') : null;

  useEffect(() => {
    document.title = activeEntry ? `${activeEntry.name} \u00b7 Lathe` : isBoard ? 'Board \u00b7 Lathe' : shell.activeTabId === 'library' ? 'Library \u00b7 Lathe' : 'Make a tool \u00b7 Lathe';
  }, [activeEntry, shell.activeTabId]);

  return (
    <div className={`shell${shell.trayOpen ? ' tray-open' : ''}${mobileMode === 'view' ? ' shell--view' : ''}${mobileMode === 'desktop' ? ' shell--desktop' : ''}`} {...drop.handlers}>
      <TopBar />
      <NavRail />
      {shell.isMobile && shell.menuOpen && <MobileMenu />}
      {shell.isMobile && shell.tabSwitcherOpen && <MobileTabSwitcher />}
      <div className="shell__panes">
        {shell.tabs.map(tab => {
          const isActive = tab.id === shell.activeTabId;
          const entry = tab.id === 'make' || tab.id === 'library' || tab.id.startsWith('board-') ? undefined : findTool(tab.id);
          const isDesktopOnly = shell.isMobile && entry && (entry.mobile === 'desktop');
          const Icon = entry ? toolIcon(entry.id) : null;
          return (
            <div key={tab.id} className="shell__pane" data-active-tab={isActive || undefined}
              style={{ display: isActive ? 'contents' : 'none' }}>
              {tab.id.startsWith('board-') ? (
                <BoardView boardId={tab.id.slice(6)} />
              ) : tab.id === 'library' ? (
                <Library />
              ) : tab.id === 'make' ? (
                <Make />
              ) : isDesktopOnly ? (
                <section className="stage">
                  <div className="desktop-only">
                    {Icon && <Icon size={48} strokeWidth={1} className="desktop-only__icon" />}
                    <h2 className="desktop-only__name">{entry.name}</h2>
                    <p className="desktop-only__blurb">{entry.blurb}</p>
                    <p className="desktop-only__label">Best on desktop</p>
                  </div>
                </section>
              ) : entry?.load ? (
                <ToolHost entry={entry} active={isActive} />
              ) : entry ? (
                <PlannedTool entry={entry} />
              ) : (
                <section className="stage stage--planned">
                  <div className="planned"><h1 className="planned__name">Tool not found</h1></div>
                </section>
              )}
            </div>
          );
        })}
      </div>
      <Tray />
      <StatusBar />
      {drop.over && (
        <div className="dropzone" aria-hidden="true">
          <span>{activeEntry?.load ? `Drop to load into ${activeEntry.name}` : 'Drop to add to the tray'}</span>
        </div>
      )}
    </div>
  );
}

function Overlays() {
  const shell = useShell();
  return (
    <>
      {shell.paletteOpen && <CommandPalette />}
      {shell.sheetOpen && <ShortcutSheet />}
      <div className="l-toasts" aria-live="polite">
        {shell.toasts.map(t => <div className="l-toast" key={t.id}>{t.message}</div>)}
      </div>
    </>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => { void loadCustomEntries().then(() => setReady(true)); }, []);
  if (!ready) return null;
  return (
    <BrowserRouter>
      <ShellProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          {/* Redirects for renamed tools */}
          <Route path="/t/audit" element={<Navigate to="/t/subject-audit" replace />} />
          <Route path="/t/bento" element={<Navigate to="/t/deck" replace />} />
          <Route path="/t/color-check" element={<Navigate to="/t/contrast" replace />} />
          <Route path="/t/multi-export" element={<Navigate to="/t/logo-export" replace />} />
          <Route path="/t/icon-set" element={<Navigate to="/t/icons" replace />} />
          <Route path="/t/mood-strip" element={<Navigate to="/t/reference" replace />} />
          <Route path="/t/mesh-gradient" element={<Navigate to="/t/gradient" replace />} />
          <Route path="/t/color-swap" element={<Navigate to="/t/recolor" replace />} />
          <Route path="/b/:slug" element={<SharedBoard />} />
          <Route path="/t/:toolId" element={<ToolView />} />
          <Route path="/make" element={<Navigate to="/t/make" replace />} />
          <Route path="/resize" element={<Navigate to="/t/resize" replace />} />
          <Route path="*" element={<Home />} />
        </Routes>
        <Overlays />
        <Keyboard />
      </ShellProvider>
    </BrowserRouter>
  );
}
