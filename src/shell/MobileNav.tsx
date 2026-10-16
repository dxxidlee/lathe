import { createElement, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Layers, Search } from 'lucide-react';
import { Mark } from '../brand/Wordmark';
import { useShell } from './state';
import { signOut } from '../lib/auth';

export function MobileNav() {
  const shell = useShell();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const lastY = useRef(0);
  const barRef = useRef<HTMLElement>(null);

  // Hide on scroll down, show on scroll up
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y > lastY.current + 10 && y > 60) setHidden(true);
        else if (y < lastY.current - 5 || y < 10) setHidden(false);
        lastY.current = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Hide when keyboard is open
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => {
      const ratio = vv.height / window.innerHeight;
      setKbOpen(ratio < 0.75);
    };
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);

  const isLibrary = shell.activeTabId === 'library';
  const tabCount = shell.tabs.length;

  return (
    <nav ref={barRef} className={`mnav${hidden || kbOpen ? ' is-hidden' : ''}`} aria-label="Navigation">
      {/* 1. Logomark — tools menu */}
      <button type="button" className="mnav__item" onClick={() => shell.toggleMenu()} aria-label="Tools menu">
        <Mark />
      </button>

      {/* 2. Library */}
      <button type="button" className={`mnav__item${isLibrary ? ' is-active' : ''}`}
        onClick={() => { shell.openTab('library'); navigate('/t/library'); }} aria-label="Library">
        {createElement(FolderOpen, { size: 20, strokeWidth: 1.5 })}
      </button>

      {/* 3. Tabs with count badge */}
      <button type="button" className="mnav__item" onClick={() => shell.setTabSwitcherOpen(true)} aria-label={`${tabCount} tab${tabCount !== 1 ? 's' : ''} open`}>
        {createElement(Layers, { size: 20, strokeWidth: 1.5 })}
        {tabCount > 0 && <span className="mnav__badge">{tabCount}</span>}
      </button>

      {/* 4. Search */}
      <button type="button" className="mnav__item" onClick={() => shell.setPaletteOpen(true)} aria-label="Search">
        {createElement(Search, { size: 20, strokeWidth: 1.5 })}
      </button>

      {/* 5. Avatar / Log in */}
      {shell.user ? (
        <button type="button" className="mnav__item mnav__avatar" onClick={() => void signOut()} aria-label="Sign out">
          {(shell.user.email?.[0] ?? '?').toUpperCase()}
        </button>
      ) : (
        <button type="button" className="mnav__item" onClick={() => shell.showAuthModal()} aria-label="Log in">
          <span className="mnav__login">Log in</span>
        </button>
      )}
    </nav>
  );
}
