import { createElement, useState } from 'react';
import { FolderOpen, Menu, Search } from 'lucide-react';
import { Mark } from '../brand/Wordmark';
import { useShell } from './state';
import { modKey } from '../lib/format';
import { TabBar } from './TabBar';
import { signOut } from '../lib/auth';
import { findTool } from '../tools/registry';

function UserMenu({ user }: { user: { email?: string | null } }) {
  const shell = useShell();
  const [open, setOpen] = useState(false);
  const initial = (user.email?.[0] ?? '?').toUpperCase();
  return (
    <div className="topbar__user" style={{ position: 'relative' }}>
      <button type="button" className="topbar__avatar" onClick={() => setOpen(o => !o)} title="Account">{initial}</button>
      {open && (
        <div className="topbar__user-menu">
          <div className="topbar__user-email">{user.email}</div>
          <button type="button" onClick={() => { setOpen(false); shell.showAuthModal(undefined, 'set-password'); }}>Change password</button>
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
    : shell.activeTabId.startsWith('board-') ? (shell.tabLabels[shell.activeTabId] ? `Board \u00b7 ${shell.tabLabels[shell.activeTabId]}` : 'Board')
    : shell.activeTabId.startsWith('deck-') ? (shell.tabLabels[shell.activeTabId] ? `Deck \u00b7 ${shell.tabLabels[shell.activeTabId]}` : 'Deck')
    : activeEntry?.name ?? shell.activeTabId;
  const showingLibrary = shell.activeTabId === 'library';
  return (
    <header className="topbar">
      {/* Logomark = tools menu toggle */}
      <button type="button" className={`topbar__mark${shell.railOpen ? ' is-open' : ''}`}
        onClick={shell.isMobile ? shell.toggleMenu : shell.toggleRail}
        aria-label="Open tools menu" title={`Tools (${mod}\\)`}>
        <Mark />
      </button>

      <TabBar tabs={shell.tabs.filter(t => t.id !== 'library')} activeTabId={showingLibrary ? '' : shell.activeTabId}
        onActivate={shell.openTab} onClose={shell.closeTab} onReorder={shell.reorderTabs} />

      {shell.isMobile && (
        <button type="button" className="topbar__tool-name" onClick={() => shell.setTabSwitcherOpen(true)}>
          {showingLibrary ? 'Library' : activeLabel} &#x25BE;
        </button>
      )}

      {/* Right cluster: Library · Search · Avatar */}
      <div className="topbar__right">
        <button type="button" className={`topbar__icon-btn${showingLibrary ? ' is-active' : ''}`}
          onClick={() => shell.openTab('library')} title="Library">
          {createElement(FolderOpen, { size: 16, strokeWidth: 1.5 })}
        </button>

        <button type="button" className="topbar__icon-btn" onClick={() => shell.setPaletteOpen(true)} title={`Search (${mod}K)`}>
          {createElement(Search, { size: 16, strokeWidth: 1.5 })}
        </button>

        {shell.user ? (
          <UserMenu user={shell.user} />
        ) : (
          <button type="button" className="l-btn" onClick={() => shell.showAuthModal()}>Log in</button>
        )}
      </div>

      {shell.isMobile && (
        <button type="button" className="topbar__menu-btn" onClick={shell.toggleMenu}>
          {createElement(Menu, { size: 20, strokeWidth: 1.5 })}
        </button>
      )}
    </header>
  );
}
