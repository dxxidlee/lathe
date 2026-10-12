import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { ShellProvider, useShell } from './shell/state';
import { ShellLayout } from './shell/ShellLayout';
import { PlannedTool, ToolHost } from './shell/ToolHost';
import { CommandPalette } from './shell/CommandPalette';
import { ShortcutSheet } from './shell/ShortcutSheet';
import { Keyboard } from './shell/Keyboard';
import { findTool, loadCustomEntries } from './tools/registry';
import { Home } from './routes/Home';
import { Make } from './routes/Make';
import { useEffect, useState } from 'react';
import { modKey } from './lib/format';

function ToolRoute() {
  const { toolId } = useParams();
  const entry = findTool(toolId);
  useEffect(() => { document.title = entry ? `${entry.name} · Lathe` : 'Lathe'; }, [entry]);
  if (!entry) {
    return (
      <ShellLayout title="Not found">
        <section className="stage stage--planned" aria-label="Not found">
          <div className="planned">
            <h1 className="planned__name">No tool called “{toolId}”</h1>
            <p className="planned__blurb">Press {modKey()}K to find one.</p>
          </div>
        </section>
        <aside className="inspector" aria-label="Inspector" />
      </ShellLayout>
    );
  }
  return (
    <ShellLayout tool={entry}>
      {entry.load ? <ToolHost key={entry.id} entry={entry} /> : <PlannedTool entry={entry} />}
    </ShellLayout>
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
          <Route path="/t/:toolId" element={<ToolRoute />} />
          <Route path="/make" element={<Make />} />
          <Route path="/resize" element={<Navigate to="/t/resize" replace />} />
          <Route path="*" element={<Home />} />
        </Routes>
        <Overlays />
        <Keyboard />
      </ShellProvider>
    </BrowserRouter>
  );
}
