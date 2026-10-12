import { Link } from 'react-router-dom';
import { Wordmark } from '../brand/Wordmark';
import type { ToolEntry } from '../tools/registry';
import { useShell } from './state';
import { modKey } from '../lib/format';

export function TopBar({ tool, title }: { tool?: ToolEntry; title?: string }) {
  const shell = useShell();
  const mod = modKey();
  return (
    <header className="topbar">
      <Link to="/" className="topbar__brand" aria-label="Lathe home"><Wordmark /></Link>
      <div className="topbar__current" aria-live="polite">
        {tool ? (<><span className="topbar__group">{tool.group}</span><span className="topbar__tool">{tool.name}</span></>)
          : <span className="topbar__tool">{title}</span>}
      </div>
      <button type="button" className="topbar__search" onClick={() => shell.setPaletteOpen(true)}>
        <span>Search tools and actions</span>
        <span className="l-kbd">{mod}K</span>
      </button>
      <div className="topbar__actions">
        <button type="button" className="l-btn l-btn--primary" onClick={shell.runExport} title={`Export (${mod}E)`}>Export</button>
      </div>
    </header>
  );
}
