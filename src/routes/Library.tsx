import { useEffect, useState } from 'react';
import { useShell } from '../shell/state';
import { cloudLoadLibrary, cloudDeleteItem, type LibraryItem } from '../lib/cloud-library';
import { loadCustomTools, type CustomTool } from '../lib/custom-tools';

const TYPES = ['all', 'deck', 'subject-audit', 'brand-audit', 'palette', 'image', 'tool'] as const;
const TYPE_LABELS: Record<string, string> = {
  all: 'All', deck: 'Decks', 'subject-audit': 'Subject Audits', 'brand-audit': 'Brand Audits',
  palette: 'Palettes', image: 'Images', tool: 'Custom Tools',
};

export function Library() {
  const shell = useShell();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    shell.setStatus({ name: 'Library', state: loading ? 'Loading...' : `${items.length + tools.length} items` });
    return () => shell.setStatus({});
  }, [loading, items, tools]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      if (shell.user) {
        const [lib, t] = await Promise.all([cloudLoadLibrary(shell.user.id), loadCustomTools()]);
        setItems(lib);
        setTools(t);
      } else {
        setTools(await loadCustomTools());
      }
      setLoading(false);
    })();
  }, [shell.user]);

  const filtered = filter === 'all'
    ? [...tools.map(t => ({ id: t.id, type: 'tool' as const, name: t.name, createdAt: t.createdAt })), ...items.map(i => ({ id: i.id, type: i.type, name: i.name, createdAt: i.createdAt }))]
    : filter === 'tool'
      ? tools.map(t => ({ id: t.id, type: 'tool' as const, name: t.name, createdAt: t.createdAt }))
      : items.filter(i => i.type === filter).map(i => ({ id: i.id, type: i.type, name: i.name, createdAt: i.createdAt }));

  const remove = async (id: string, type: string) => {
    if (type === 'tool') return;
    if (shell.user) await cloudDeleteItem(shell.user.id, id);
    setItems(items.filter(i => i.id !== id));
    shell.toast('Removed from library');
  };

  if (!shell.user) {
    return (
      <>
        <section className="stage" aria-label="Library">
          <div style={{ padding: '2rem', color: 'var(--ink-2)' }}>
            <h2 style={{ margin: 0, fontWeight: 500 }}>Library</h2>
            <p>Sign in to save and access your work across devices.</p>
          </div>
        </section>
        <aside className="inspector" aria-label="Inspector" />
      </>
    );
  }

  return (
    <>
      <section className="stage" aria-label="Library">
        <div className="lib">
          <div className="lib__head">
            <h2 className="lib__title">Library</h2>
            <div className="l-chip-row">
              {TYPES.map(t => (
                <button key={t} type="button" className={`l-chip${filter === t ? ' is-active' : ''}`}
                  onClick={() => setFilter(t)}>{TYPE_LABELS[t]}</button>
              ))}
            </div>
          </div>
          {loading && <p className="l-note">Loading...</p>}
          {!loading && !filtered.length && <p className="l-note">Nothing saved yet. Use "Save to Library" in any tool.</p>}
          <div className="lib__grid">
            {filtered.map(item => (
              <div key={item.id} className="lib__item">
                <span className="lib__item-type">{TYPE_LABELS[item.type] ?? item.type}</span>
                <span className="lib__item-name">{item.name}</span>
                <span className="lib__item-date tabular">{new Date(item.createdAt).toLocaleDateString()}</span>
                {item.type !== 'tool' && (
                  <button type="button" className="lib__item-del" onClick={() => void remove(item.id, item.type)} title="Remove">&times;</button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
      <aside className="inspector" aria-label="Inspector" />
    </>
  );
}
