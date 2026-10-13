import { useNavigate } from 'react-router-dom';
import { findTool } from '../tools/registry';
import { toolIcon } from './icons';
import { Mark } from '../brand/Wordmark';
import { useShell } from './state';

export function MobileTabSwitcher() {
  const shell = useShell();
  const navigate = useNavigate();

  const activate = (id: string) => {
    shell.openTab(id);
    navigate(`/t/${id}`);
    shell.setTabSwitcherOpen(false);
  };

  return (
    <>
      <div className="tab-switcher__scrim" onClick={() => shell.setTabSwitcherOpen(false)} />
      <div className="tab-switcher">
        {shell.tabs.map(tab => {
          const tool = findTool(tab.id);
          const label = tab.id === 'make' ? 'Make a tool' : tab.id === 'library' ? 'Library' : tool?.name ?? tab.id;
          const Icon = toolIcon(tab.id);
          return (
            <div key={tab.id} className={`tab-switcher__item${tab.id === shell.activeTabId ? ' is-active' : ''}`}>
              {tab.id === 'make' ? <Mark className="tab-switcher__icon" /> : Icon ? <Icon size={16} strokeWidth={1.5} className="tab-switcher__icon" /> : null}
              <button type="button" className="tab-switcher__name" onClick={() => activate(tab.id)} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', cursor: 'pointer', padding: 0 }}>
                {label}
              </button>
              {!tab.pinned && (
                <button type="button" className="tab-switcher__close" onClick={() => shell.closeTab(tab.id)}>&times;</button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
