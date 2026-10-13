import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { TOOLS, isReady, toolsByGroup, allTools } from '../tools/registry';
import { Mark } from '../brand/Wordmark';
import { useShell } from './state';

export function NavRail() {
  const shell = useShell();
  const collapsed = shell.navCollapsed;
  const [offcutsOpen, setOffcutsOpen] = useState(false);
  const custom = allTools().filter(t => t.custom);
  return (
    <nav className={`nav${collapsed ? ' is-collapsed' : ''}`} aria-label="Tools">
      <button type="button" className="nav__toggle" onClick={shell.toggleNav}
        aria-expanded={!collapsed} aria-label={collapsed ? 'Expand tool rail' : 'Collapse tool rail'}>
        {collapsed ? '\u2192' : '\u2190'}
      </button>
      <div className="nav__scroll">
        {toolsByGroup().map(({ group, tools }) => {
          const isOffcuts = group === 'Offcuts';
          return (
            <div className={`nav__group${isOffcuts && !offcutsOpen ? ' nav__group--collapsed' : ''}`} key={group}>
              <div
                className="nav__group-label"
                {...(isOffcuts ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-expanded': offcutsOpen,
                  onClick: () => setOffcutsOpen(o => !o),
                  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOffcutsOpen(o => !o); } },
                } : {})}
              >
                {group}{isOffcuts ? (offcutsOpen ? ' \u25be' : ' \u25b8') : ''}
              </div>
              {(!isOffcuts || offcutsOpen) && (
                <ul className="nav__list">
                  {tools.filter(t => !t.custom).map(t => {
                    const n = TOOLS.indexOf(t);
                    return (
                      <li key={t.id}>
                        <NavLink to={`/t/${t.id}`} className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}${isReady(t) ? '' : ' is-planned'}`}
                          title={collapsed ? t.name : t.blurb}>
                          <span className="nav__abbr" aria-hidden="true">{t.name.slice(0, 2)}</span>
                          <span className="nav__name">{t.name}</span>
                          <span className="nav__meta">{isReady(t) ? (n < 9 ? n + 1 : '') : `M${t.milestone}`}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
        {custom.length > 0 && (
          <div className="nav__group">
            <div className="nav__group-label">Your Tools</div>
            <ul className="nav__list">
              {custom.map(t => (
                <li key={t.id}>
                  <NavLink to={`/t/${t.id}`} className={({ isActive }) => `nav__item${isActive ? ' is-active' : ''}`}
                    title={collapsed ? t.name : t.blurb}>
                    <span className="nav__abbr" aria-hidden="true">{t.name.slice(0, 2)}</span>
                    <span className="nav__name">{t.name}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <NavLink to="/make" className={({ isActive }) => `nav__make${isActive ? ' is-active' : ''}`} title="Make a tool">
        <Mark className="nav__make-mark" />
        <span className="nav__name">Make a tool</span>
      </NavLink>
    </nav>
  );
}
