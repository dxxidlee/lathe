import { createElement } from 'react';
import { Link } from 'react-router-dom';
import { PanelLeft } from 'lucide-react';
import { Wordmark } from '../brand/Wordmark';
import { useShell } from './state';
import { modKey } from '../lib/format';
import { TabBar } from './TabBar';
import { AuthMenu } from './AuthMenu';

export function TopBar() {
  const shell = useShell();
  const mod = modKey();
  return (
    <header className="topbar">
      <button type="button" className="topbar__rail-toggle" onClick={shell.toggleRail}
        aria-label={shell.railOpen ? 'Close rail' : 'Open rail'} title={`${mod}\\`}>
        {createElement(PanelLeft, { size: 16, strokeWidth: 1.5 })}
      </button>
      <Link to="/" className="topbar__brand" aria-label="Lathe home"><Wordmark /></Link>
      <TabBar tabs={shell.tabs} activeTabId={shell.activeTabId}
        onActivate={shell.openTab} onClose={shell.closeTab} onReorder={shell.reorderTabs} />
      <button type="button" className="topbar__search" onClick={() => shell.setPaletteOpen(true)}>
        <span>Search</span>
        <span className="l-kbd">{mod}K</span>
      </button>
      <AuthMenu />
      <div className="topbar__actions">
        <button type="button" className="l-btn" onClick={shell.runExport} title={`Export (${mod}E)`}>Export</button>
      </div>
    </header>
  );
}
