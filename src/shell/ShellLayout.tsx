import type { ReactNode } from 'react';
import type { ToolEntry } from '../tools/registry';
import { TopBar } from './TopBar';
import { NavRail } from './NavRail';
import { StatusBar } from './StatusBar';
import { Tray } from './Tray';
import { useShell } from './state';
import { useStageDrop } from './ToolHost';

/** Standalone shell frame for pages outside the tab system (e.g. Home). */
export function ShellLayout({ tool, title, children }: { tool?: ToolEntry; title?: string; children: ReactNode }) {
  const shell = useShell();
  const drop = useStageDrop(tool);
  return (
    <div className={`shell${shell.trayOpen ? ' tray-open' : ''}`} {...drop.handlers}>
      <TopBar />
      <NavRail />
      {children}
      <Tray />
      <StatusBar />
      {drop.over && (
        <div className="dropzone" aria-hidden="true">
          <span>{tool?.load ? `Drop to load into ${tool.name}` : 'Drop to add to the tray'}</span>
        </div>
      )}
    </div>
  );
}
