import type { ReactNode } from 'react';
import type { ToolEntry } from '../tools/registry';
import { TopBar } from './TopBar';
import { NavRail } from './NavRail';
import { StatusBar } from './StatusBar';
import { Tray } from './Tray';
import { useShell } from './state';
import { useStageDrop } from './ToolHost';

/** Figma-like frame: top bar, tool rail, stage + inspector (children), tray, status bar. */
export function ShellLayout({ tool, title, children }: { tool?: ToolEntry; title?: string; children: ReactNode }) {
  const shell = useShell();
  const drop = useStageDrop(tool);
  return (
    <div className={`shell${shell.navCollapsed ? ' nav-collapsed' : ''}${shell.trayOpen ? ' tray-open' : ''}`} {...drop.handlers}>
      <TopBar tool={tool} title={title} />
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
