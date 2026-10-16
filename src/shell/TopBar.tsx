import { createElement, useState } from 'react';
import { Link } from 'react-router-dom';
import { PanelLeft, Menu } from 'lucide-react';
import { Wordmark } from '../brand/Wordmark';
import { useShell } from './state';
import { modKey } from '../lib/format';
import { TabBar } from './TabBar';
import { signOut } from '../lib/auth';
import { findTool } from '../tools/registry';

function UserMenu({ user }: { user: { email?: string | null } }) {
  const [open, setOpen] = useState(false);
  const initial = (user.email?.[0] ?? '?').toUpperCase();
  return (
    <div className="topbar__user" style={{ position: 'relative' }}>
      <button type="button" className="topbar__avatar" onClick={() => setOpen(o => !o)} title="Account">{initial}</button>
      {open && (
        <div className="topbar__user-menu">
          <div className="topbar__user-email">{user.email}</div>
          <button type="button" onClick={() => { setOpen(false); void signOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const shell = useShell();
  const mod = modKey();
  const activeEntry = findTool(shell.activeTabId);
  const activeLabel = shell.activeTabId === 'make' ? 'Make a tool'
    : shell.activeTabId === 'library' ? 'Library'
    : shell.activeTabId.startsWith('board-') ? (shell.tabLabels[shell.activeTabId] ? `Board \u00b7 ${shell.tabLabels[shell.activeTabId]}` : 'Board')
    : shell.activeTabId.startsWith('deck-') ? (shell.tabLabels[shell.activeTabId] ? `Deck \u00b7 ${shell.tabLabels[shell.activeTabId]}` : 'Deck')
    : activeEntry?.name ?? shell.activeTabId;
  return (
    <header className="topbar">
      <button type="button" className="topbar__rail-toggle" onClick={shell.isMobile ? shell.toggleMenu : shell.toggleRail}
        aria-label={shell.railOpen ? 'Close rail' : 'Open rail'} title={`${mod}\\`}>
        {createElement(PanelLeft, { size: 16, strokeWidth: 1.5 })}
      </button>
      <Link to={shell.user ? '/t/library' : '/'} className="topbar__brand" aria-label="Lathe home"
        onClick={() => { if (shell.user) shell.openTab('library'); }}><Wordmark /></Link>
      <TabBar tabs={shell.tabs} activeTabId={shell.activeTabId}
        onActivate={shell.openTab} onClose={shell.closeTab} onReorder={shell.reorderTabs} />
      {shell.isMobile && (
        <button type="button" className="topbar__tool-name" onClick={() => shell.setTabSwitcherOpen(true)}>
          {activeLabel} &#x25BE;
        </button>
      )}
      <button type="button" className="topbar__search" onClick={() => shell.setPaletteOpen(true)}>
        <span>Search</span>
        <span className="l-kbd">{mod}K</span>
      </button>
      {shell.user ? (
        <UserMenu user={shell.user} />
      ) : (
        <button type="button" className="l-btn" onClick={() => shell.showAuthModal()}>Log in</button>
      )}
      <div className="topbar__actions">
        <button type="button" className="l-btn" onClick={() => { if (!shell.user) { shell.showAuthModal(shell.runExport); return; } shell.runExport(); }} title={`Export (${mod}E)`}>Export</button>
      </div>
      {shell.isMobile && (
        <button type="button" className="topbar__menu-btn" onClick={shell.toggleMenu}>
          {createElement(Menu, { size: 20, strokeWidth: 1.5 })}
        </button>
      )}
    </header>
  );
}
