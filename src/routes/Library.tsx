import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useShell } from '../shell/state';

import { cloudLoadLibrary, cloudDeleteItem, type LibraryItem } from '../lib/cloud-library';
import { loadCustomTools, type CustomTool } from '../lib/custom-tools';
import { loadBoards, createBoard, deleteBoard, toggleSharing, type Board } from '../lib/boards';
import { signOut } from '../lib/auth';

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

function BoardCard({ board, onOpen, onShare, onDelete }: { board: Board; onOpen: () => void; onShare: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const imgs = board.items.slice(0, 3);
  const age = formatAge(board.updatedAt);
  return (
    <div className="lib__board">
      <div className={`lib__board-cover lib__board-cover--${Math.min(imgs.length, 3)}`} onClick={onOpen}>
        {imgs.map((it, i) => <img key={i} src={it.thumbUrl} alt="" loading="lazy" />)}
        {!imgs.length && <div className="lib__board-empty" />}
        {board.visibility === 'unlisted' && <span className="lib__board-shared" title="Shared">{'\ud83d\udd17'}</span>}
      </div>
      <div className="lib__board-info">
        <span className="lib__board-name" onClick={onOpen}>{board.name}</span>
        <button type="button" className="lib__board-menu-btn" onClick={() => setMenuOpen(o => !o)}>{'\u22EF'}</button>
      </div>
      <div className="lib__board-meta">{board.items.length} image{board.items.length !== 1 ? 's' : ''} &middot; {age}</div>
      {menuOpen && (
        <div className="lib__board-menu">
          <button type="button" onClick={() => { onOpen(); setMenuOpen(false); }}>Open</button>
          <button type="button" onClick={() => { onShare(); setMenuOpen(false); }}>
            {board.visibility === 'unlisted' ? 'Make private' : 'Share link'}
          </button>
          <button type="button" className="lib__board-menu-danger" onClick={() => { onDelete(); setMenuOpen(false); }}>Delete</button>
        </div>
      )}
    </div>
  );
}

export function Library() {
  const shell = useShell();
  const navigate = useNavigate();
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

  const showBoards = filter === 'all' || filter === 'board' || filter === 'subject-audit';
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

  async function handleCreate() {
    await createBoard('Untitled board');
    setBoards(await loadBoards());
    shell.openTab('subject-audit');
    navigate('/t/subject-audit');
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this board? This cannot be undone.')) return;
    await deleteBoard(id);
    setBoards(await loadBoards());
    shell.toast('Board deleted');
  }

  async function handleShare(board: Board) {
    const updated = await toggleSharing(board);
    setBoards(await loadBoards());
    if (updated.visibility === 'unlisted' && updated.shareSlug) {
      await navigator.clipboard.writeText(`${window.location.origin}/b/${updated.shareSlug}`);
      shell.toast('Link copied');
    } else {
      shell.toast('Board is now private');
    }
  }

  function handleOpen(boardId: string) {
    shell.openTab(`board-${boardId}`);
    navigate(`/t/board-${boardId}`);
  }

  // Profile info
  const email = shell.user?.email ?? '';
  const username = email.split('@')[0] || 'You';
  const initial = username[0]?.toUpperCase() || '?';
  const memberSince = shell.user?.created_at
    ? new Date(shell.user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  const profileHeader = shell.user ? (
    <div className="lib__profile">
      <div className="lib__avatar">{initial}</div>
      <div className="lib__username">{username}</div>
      {memberSince && <div className="lib__member">Member since {memberSince}</div>}
      <div className="lib__stats">{boards.length} board{boards.length !== 1 ? 's' : ''} &middot; {items.length} saved</div>
    </div>
  ) : (
    <div style={{ padding: 'var(--space-7)', color: 'var(--text-2)' }}>
      <h2 style={{ margin: 0, fontWeight: 'var(--weight-medium)' as any }}>Library</h2>
      <p>Sign in to save and access your work across devices.</p>
    </div>
  );

  return (
    <>
      <section className="stage stage--full" aria-label="Library">
        <div className="lib">
          {profileHeader}
          <div className="lib__create">
            <button type="button" className="l-btn l-btn--primary" onClick={handleCreate}>+ Create board</button>
          </div>
          <div className="lib__head">
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
              {boards.map(b => (
                <BoardCard key={b.id} board={b}
                  onOpen={() => handleOpen(b.id)}
                  onShare={() => void handleShare(b)}
                  onDelete={() => void handleDelete(b.id)} />
              ))}
            </div>
          )}
          <div className="lib__grid">
            {filtered.map(item => (
              <div key={item.id} className="lib__item">
                <span className="lib__item-type">{TYPE_LABELS[item.type] ?? item.type}</span>
                <span className="lib__item-name">{item.name}</span>
                <span className="lib__item-date tabular">{new Date(item.createdAt).toLocaleDateString()}</span>
                {item.type !== 'tool' && (
                  <button type="button" className="lib__item-del" onClick={() => void remove(item.id, item.type)} title="Remove"><X size={14} strokeWidth={2} /></button>
                )}
              </div>
            ))}
          </div>
          {shell.user && (
            <div className="lib__signout">
              <button type="button" className="l-btn" onClick={() => void signOut()}>Sign out</button>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
