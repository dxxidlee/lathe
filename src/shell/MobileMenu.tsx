import { useState, createElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { TOOLS, isReady, toolsByGroup, allTools } from '../tools/registry';
import { toolIcon } from './icons';
import { useShell } from './state';

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
    ? TOOLS.filter(t => !t.hidden && !t.dev && t.name.toLowerCase().includes(search.toLowerCase()) && isReady(t))
    : null;

  return (
    <div className="mobile-menu">
      <div className="mobile-menu__header">
        <input className="mobile-menu__search" type="search" placeholder="Search tools..."
          value={search} onChange={e => setSearch(e.target.value)} autoFocus />
        <button type="button" className="mobile-menu__close" onClick={shell.toggleMenu} aria-label="Close">
          {createElement(X, { size: 18, strokeWidth: 1.5 })}
        </button>
      </div>

      <div className="mobile-menu__body">
        {filtered ? (
          filtered.map(t => {
            const Icon = toolIcon(t.id);
            return (
              <button key={t.id} type="button" className={`mobile-menu__item${shell.activeTabId === t.id ? ' mobile-menu__item--active' : ''}`}
                onClick={() => open(t.id)}>
                {Icon && createElement(Icon, { size: 16, strokeWidth: 1.5 })}
                <span>{t.name}</span>
              </button>
            );
          })
        ) : (
          <>
            {toolsByGroup().map(({ group, tools }) => {
              const visible = tools.filter(t => !t.custom && !t.hidden && !t.dev && isReady(t));
              if (!visible.length) return null;
              return (
                <div key={group}>
                  <div className="mobile-menu__group">{group}</div>
                  {visible.map(t => {
                    const Icon = toolIcon(t.id);
                    return (
                      <button key={t.id} type="button" className={`mobile-menu__item${shell.activeTabId === t.id ? ' mobile-menu__item--active' : ''}`}
                        onClick={() => open(t.id)}>
                        {Icon && createElement(Icon, { size: 16, strokeWidth: 1.5 })}
                        <span>{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}

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
          </>
        )}
      </div>
    </div>
  );
}
