import { useEffect, useState } from 'react';
import { useShell } from '../shell/state';
import { BottomSheet } from '../shell/BottomSheet';
import { cloudLoadLibrary, cloudDeleteItem, type LibraryItem } from '../lib/cloud-library';
import { loadCustomTools, type CustomTool } from '../lib/custom-tools';
import { loadBoards, type Board } from '../lib/boards';

const TYPES = ['all', 'board', 'deck', 'subject-audit', 'brand-audit', 'palette', 'image', 'tool'] as const;
const TYPE_LABELS: Record<string, string> = {
  all: 'All', board: 'Boards', deck: 'Decks', 'subject-audit': 'Subject Audits', 'brand-audit': 'Brand Audits',
  palette: 'Palettes', image: 'Images', tool: 'Custom Tools',
};

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

function BoardCard({ board, onClick }: { board: Board; onClick: () => void }) {
  const imgs = board.items.slice(0, 3);
  const age = formatAge(board.updatedAt);
  return (
    <div className="lib__board" onClick={onClick}>
      <div className={`lib__board-cover lib__board-cover--${Math.min(imgs.length, 3)}`}>
        {imgs.map((it, i) => <img key={i} src={it.thumbUrl} alt="" loading="lazy" />)}
        {!imgs.length && <div className="lib__board-empty" />}
        {board.visibility === 'private' && <span className="lib__board-lock" title="Private">{'\ud83d\udd12'}</span>}
      </div>
      <div className="lib__board-name">{board.name}</div>
      <div className="lib__board-meta">{board.items.length} image{board.items.length !== 1 ? 's' : ''} &middot; {age}</div>
    </div>
  );
}

export function Library() {
  const shell = useShell();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    shell.setStatus({ name: 'Library', state: loading ? 'Loading...' : `${items.length + tools.length + boards.length} items` });
    return () => shell.setStatus({});
  }, [loading, items, tools, boards]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      if (shell.user) {
        const [lib, t, b] = await Promise.all([cloudLoadLibrary(shell.user.id), loadCustomTools(), loadBoards()]);
        setItems(lib);
        setTools(t);
        setBoards(b);
      } else {
        const [t, b] = await Promise.all([loadCustomTools(), loadBoards()]);
        setTools(t);
        setBoards(b);
      }
      setLoading(false);
    })();
  }, [shell.user]);

  const showBoards = filter === 'all' || filter === 'board';
  const filtered = filter === 'all'
    ? [...tools.map(t => ({ id: t.id, type: 'tool' as const, name: t.name, createdAt: t.createdAt })), ...items.map(i => ({ id: i.id, type: i.type, name: i.name, createdAt: i.createdAt }))]
    : filter === 'tool'
      ? tools.map(t => ({ id: t.id, type: 'tool' as const, name: t.name, createdAt: t.createdAt }))
      : filter === 'board'
        ? [] // boards rendered as cards, not list items
        : items.filter(i => i.type === filter).map(i => ({ id: i.id, type: i.type, name: i.name, createdAt: i.createdAt }));

  const remove = async (id: string, type: string) => {
    if (type === 'tool') return;
    if (shell.user) await cloudDeleteItem(shell.user.id, id);
    setItems(items.filter(i => i.id !== id));
    shell.toast('Removed from library');
  };

  if (!shell.user) {
    const inspector = <aside className="inspector" aria-label="Inspector" />;
    return (
      <>
        <section className="stage" aria-label="Library">
          <div style={{ padding: 'var(--space-7)', color: 'var(--text-2)' }}>
            <h2 style={{ margin: 0, fontWeight: 'var(--weight-medium)' as any }}>Library</h2>
            <p>Sign in to save and access your work across devices.</p>
          </div>
        </section>
        {shell.isMobile ? <BottomSheet>{inspector}</BottomSheet> : inspector}
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
          {!loading && !filtered.length && !showBoards && <p className="l-note">Nothing saved yet. Use "Save to Library" in any tool.</p>}
          {showBoards && (
            <div className="lib__boards">
              {boards.map(b => <BoardCard key={b.id} board={b} onClick={() => shell.openTab('subject-audit')} />)}
            </div>
          )}
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
      {shell.isMobile ? <BottomSheet><aside className="inspector" aria-label="Inspector" /></BottomSheet> : <aside className="inspector" aria-label="Inspector" />}
    </>
  );
}
