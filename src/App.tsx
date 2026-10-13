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
import { findTool, loadCustomEntries } from './tools/registry';
import { Home } from './routes/Home';
import { Make } from './routes/Make';
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
      const path = shell.activeTabId === 'make' ? '/t/make' : `/t/${shell.activeTabId}`;
      navigate(path, { replace: true });
    }
  }, [shell.activeTabId]);

  const activeEntry = shell.activeTabId === 'make' ? undefined : findTool(shell.activeTabId);
  const drop = useStageDrop(activeEntry);

  useEffect(() => {
    document.title = activeEntry ? `${activeEntry.name} \u00b7 Lathe` : 'Make a tool \u00b7 Lathe';
  }, [activeEntry]);

  return (
    <div className={`shell${shell.trayOpen ? ' tray-open' : ''}`} {...drop.handlers}>
      <TopBar />
      <NavRail />
      <div className="shell__panes">
        {shell.tabs.map(tab => {
          const isActive = tab.id === shell.activeTabId;
          const entry = tab.id === 'make' ? undefined : findTool(tab.id);
          return (
            <div key={tab.id} className="shell__pane" data-active-tab={isActive || undefined}
              style={{ display: isActive ? 'contents' : 'none' }}>
              {tab.id === 'make' ? (
                <Make />
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
