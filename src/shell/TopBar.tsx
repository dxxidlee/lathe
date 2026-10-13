import { Link } from 'react-router-dom';
import { Wordmark } from '../brand/Wordmark';
import { useShell } from './state';
import { modKey } from '../lib/format';
import { TabBar } from './TabBar';

export function TopBar() {
  const shell = useShell();
  const mod = modKey();
  return (
    <header className="topbar">
      <button type="button" className="topbar__rail-toggle" onClick={shell.toggleRail}
        aria-label={shell.railOpen ? 'Close rail' : 'Open rail'} title={`${mod}\\`}>
        {shell.railOpen ? '\u2190' : '\u2261'}
      </button>
      <Link to="/" className="topbar__brand" aria-label="Lathe home"><Wordmark /></Link>
      <TabBar tabs={shell.tabs} activeTabId={shell.activeTabId}
        onActivate={shell.openTab} onClose={shell.closeTab} onReorder={shell.reorderTabs} />
      <button type="button" className="topbar__search" onClick={() => shell.setPaletteOpen(true)}>
        <span>Search</span>
        <span className="l-kbd">{mod}K</span>
      </button>
      <div className="topbar__actions">
        <button type="button" className="l-btn l-btn--primary" onClick={shell.runExport} title={`Export (${mod}E)`}>Export</button>
      </div>
    </header>
  );
}
