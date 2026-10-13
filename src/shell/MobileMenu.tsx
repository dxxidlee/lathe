import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TOOLS, isReady, toolsByGroup, allTools, HIDDEN_TOOLS } from '../tools/registry';
import { toolIcon } from './icons';
import { Wordmark } from '../brand/Wordmark';
import { useShell } from './state';
import { signInWithProvider, signOut } from '../lib/auth';

export function MobileMenu() {
  const shell = useShell();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const custom = allTools().filter(t => t.custom);

  const open = (id: string) => {
    shell.openTab(id);
    navigate(`/t/${id}`);
    shell.toggleMenu();
  };

  const filtered = search.trim()
    ? [...TOOLS, ...HIDDEN_TOOLS].filter(t => t.name.toLowerCase().includes(search.toLowerCase()) && isReady(t))
    : null;

  return (
    <div className="mobile-menu">
      <div className="mobile-menu__header">
        <Wordmark />
        <button type="button" className="mobile-menu__close" onClick={shell.toggleMenu}>&times;</button>
      </div>
      <input className="mobile-menu__search" type="search" placeholder="Search tools..."
        value={search} onChange={e => setSearch(e.target.value)} autoFocus />

      {filtered ? (
        filtered.map(t => {
          const Icon = toolIcon(t.id);
          return (
            <button key={t.id} type="button" className={`mobile-menu__item${shell.activeTabId === t.id ? ' mobile-menu__item--active' : ''}`}
              onClick={() => open(t.id)}>
              {Icon && <Icon size={16} strokeWidth={1.5} className="mobile-menu__icon" />}
              <span>{t.name}</span>
            </button>
          );
        })
      ) : (
        <>
          {toolsByGroup().map(({ group, tools }) => (
            <div key={group}>
              <div className="mobile-menu__group">{group}</div>
              {tools.filter(t => !t.custom && isReady(t)).map(t => {
                const Icon = toolIcon(t.id);
                return (
                  <button key={t.id} type="button" className={`mobile-menu__item${shell.activeTabId === t.id ? ' mobile-menu__item--active' : ''}`}
                    onClick={() => open(t.id)}>
                    {Icon && <Icon size={16} strokeWidth={1.5} className="mobile-menu__icon" />}
                    <span>{t.name}</span>
                  </button>
                );
              })}
            </div>
          ))}

          {custom.length > 0 && (
            <>
              <div className="mobile-menu__group">Your Tools</div>
              {custom.map(t => (
                <button key={t.id} type="button" className="mobile-menu__item" onClick={() => open(t.id)}>
                  <span>{t.name}</span>
                </button>
              ))}
            </>
          )}

          <div className="mobile-menu__divider" />
          <button type="button" className="mobile-menu__item" onClick={() => open('library')}>Library</button>
          <button type="button" className="mobile-menu__item" onClick={() => open('make')}>Make a tool</button>
        </>
      )}

      <div className="mobile-menu__account">
        {shell.user ? (
          <>
            <span style={{ color: 'var(--text-2)', fontSize: 'var(--text-meta)' }}>{shell.user.email}</span>
            <button type="button" className="l-btn" onClick={() => { void signOut(); shell.toggleMenu(); }}>Sign out</button>
          </>
        ) : (
          <>
            <button type="button" className="l-btn" onClick={() => void signInWithProvider('google')}>Sign in with Google</button>
            <button type="button" className="l-btn" onClick={() => void signInWithProvider('github')}>Sign in with GitHub</button>
          </>
        )}
      </div>
    </div>
  );
}
