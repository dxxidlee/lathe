import { createElement, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Layers, Search } from 'lucide-react';
import { Mark } from '../brand/Wordmark';
import { useShell } from './state';

export function MobileNav() {
  const shell = useShell();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(false);
  const [kbOpen, setKbOpen] = useState(false);
  const lastY = useRef(0);

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

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setKbOpen(vv.height / window.innerHeight < 0.75);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, []);

  const isLibrary = shell.activeTabId === 'library';
  const tabCount = shell.tabs.length;

  return (
    <nav className={`mnav${hidden || kbOpen ? ' is-hidden' : ''}`} aria-label="Navigation">
      {/* 1. Library */}
      <button type="button" className={`mnav__item${isLibrary ? ' is-active' : ''}`}
        onClick={() => { shell.openTab('library'); navigate('/t/library'); }} aria-label="Library">
        {createElement(FolderOpen, { size: 20, strokeWidth: 1.5 })}
      </button>

      {/* 2. Tabs with count */}
      <button type="button" className="mnav__item" onClick={() => shell.setTabSwitcherOpen(true)}
        aria-label={`${tabCount} tab${tabCount !== 1 ? 's' : ''} open`}>
        {createElement(Layers, { size: 20, strokeWidth: 1.5 })}
        {tabCount > 0 && <span className="mnav__badge">{tabCount}</span>}
      </button>

      {/* 3. Logomark — center, opens tools menu */}
      <button type="button" className="mnav__item mnav__center" onClick={() => shell.toggleMenu()} aria-label="Tools">
        <Mark />
      </button>

      {/* 4. Search */}
      <button type="button" className="mnav__item" onClick={() => shell.setPaletteOpen(true)} aria-label="Search">
        {createElement(Search, { size: 20, strokeWidth: 1.5 })}
      </button>

      {/* 5. Avatar / Log in */}
      {shell.user ? (
        <button type="button" className="mnav__item mnav__avatar" onClick={() => shell.showAuthModal(undefined, 'set-password')} aria-label="Account">
          {shell.avatarUrl ? <img src={shell.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} /> : (shell.user.email?.[0] ?? '?').toUpperCase()}
        </button>
      ) : (
        <button type="button" className="mnav__item" onClick={() => shell.showAuthModal()} aria-label="Log in">
          <span className="mnav__login">Log in</span>
        </button>
      )}
    </nav>
  );
}
