import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Palette as PaletteIcon, Image, Code2, Search } from 'lucide-react';
import { useShell } from '../shell/state';

import { cloudLoadLibrary, cloudDeleteItem, cloudUpdateItem, type LibraryItem } from '../lib/cloud-library';
import { loadCustomTools, type CustomTool } from '../lib/custom-tools';
import { loadBoards, createBoard, deleteBoard, toggleSharing, type Board } from '../lib/boards';
import { signOut } from '../lib/auth';

const TYPES = ['all', 'board', 'deck', 'brand-audit', 'palette', 'image', 'tool'] as const;
const TYPE_LABELS: Record<string, string> = {
  all: 'All', board: 'Boards', deck: 'Decks', 'brand-audit': 'Brand Audits',
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

/* ---- Shared card shell ---- */
function CardMenu({ actions }: { actions: { label: string; danger?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lib__board-menu-btn" onClick={() => setOpen(o => !o)}>{'\u22EF'}</button>
      {open && (
        <div className="lib__board-menu">
          {actions.map((a, i) => (
            <button key={i} type="button" className={a.danger ? 'lib__board-menu-danger' : undefined}
              onClick={() => { a.onClick(); setOpen(false); }}>{a.label}</button>
          ))}
        </div>
      )}
    </>
  );
}

/* ---- Board card (existing) ---- */
function BoardCard({ board, onOpen, onShare, onDelete }: { board: Board; onOpen: () => void; onShare: () => void; onDelete: () => void }) {
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
        <CardMenu actions={[
          { label: 'Open', onClick: onOpen },
          { label: board.visibility === 'unlisted' ? 'Make private' : 'Share link', onClick: onShare },
          { label: 'Delete', danger: true, onClick: onDelete },
        ]} />
      </div>
      <div className="lib__board-meta">{board.items.length} image{board.items.length !== 1 ? 's' : ''} &middot; {age}</div>
    </div>
  );
}

/* ---- Deck card ---- */
function DeckCover({ deck }: { deck: any }) {
  const slide = deck?.slides?.[0];
  const brand = slide?.brand;
  if (brand?.palette?.length) {
    const bg = deck?.theme === 'light' ? '#fff' : '#000';
    const logoBg = brand.logo?.bgColor || '#222';
    return (
      <div style={{ width: '100%', height: '100%', background: bg, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 2, padding: 2, borderRadius: 'var(--radius-control)', overflow: 'hidden' }}>
        <div style={{ background: '#141414', borderRadius: 2, gridRow: '1/3' }} />
        <div style={{ background: logoBg, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Layers size={16} strokeWidth={1.5} style={{ color: bg === '#000' ? '#fff' : '#000', opacity: 0.5 }} />
        </div>
        <div style={{ display: 'flex', borderRadius: 2, overflow: 'hidden' }}>
          {brand.palette.slice(0, 4).map((c: string, i: number) => <div key={i} style={{ flex: 1, background: c }} />)}
        </div>
        <div style={{ background: '#141414', borderRadius: 2 }} />
        <div style={{ background: '#141414', borderRadius: 2 }} />
      </div>
    );
  }
  return <div className="lib__board-empty" style={{ background: deck?.theme === 'light' ? '#fff' : '#000' }}><Layers size={32} strokeWidth={1} style={{ color: 'var(--text-3)' }} /></div>;
}

function DeckCard({ item, onOpen, onRename, onDelete }: { item: LibraryItem; onOpen: () => void; onRename: (name: string) => void; onDelete: () => void }) {
  const deck = item.data as any;
  const slideCount = deck?.slides?.length ?? 0;
  const age = formatAge(item.createdAt);
  return (
    <div className="lib__board">
      <div className="lib__board-cover lib__board-cover--1" onClick={onOpen}>
        <DeckCover deck={deck} />
      </div>
      <div className="lib__board-info">
        <span className="lib__board-name" onClick={onOpen}>{item.name}</span>
        <CardMenu actions={[
          { label: 'Open', onClick: onOpen },
          { label: 'Rename', onClick: () => { const n = prompt('Rename deck', item.name); if (n?.trim()) onRename(n.trim()); } },
          { label: 'Delete', danger: true, onClick: onDelete },
        ]} />
      </div>
      <div className="lib__board-meta">{slideCount} slide{slideCount !== 1 ? 's' : ''} &middot; {age}</div>
    </div>
  );
}

/* ---- Palette card ---- */
function PaletteCard({ item, onOpen, onDelete }: { item: LibraryItem; onOpen: () => void; onDelete: () => void }) {
  const data = item.data as any;
  const colors: string[] = data?.colors ?? data?.palette ?? [];
  const age = formatAge(item.createdAt);
  return (
    <div className="lib__board">
      <div className="lib__board-cover lib__board-cover--1" onClick={onOpen}>
        {colors.length ? (
          <div className="lib__palette-stripes">
            {colors.slice(0, 8).map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
          </div>
        ) : (
          <div className="lib__board-empty"><PaletteIcon size={32} strokeWidth={1} style={{ color: 'var(--text-3)' }} /></div>
        )}
      </div>
      <div className="lib__board-info">
        <span className="lib__board-name" onClick={onOpen}>{item.name}</span>
        <CardMenu actions={[
          { label: 'Open', onClick: onOpen },
          { label: 'Delete', danger: true, onClick: onDelete },
        ]} />
      </div>
      <div className="lib__board-meta">{colors.length} color{colors.length !== 1 ? 's' : ''} &middot; {age}</div>
    </div>
  );
}

/* ---- Image card ---- */
function ImageCard({ item, onDelete }: { item: LibraryItem; onDelete: () => void }) {
  const data = item.data as any;
  const src = data?.url ?? data?.dataUri ?? data?.thumbUrl ?? null;
  const age = formatAge(item.createdAt);
  return (
    <div className="lib__board">
      <div className="lib__board-cover lib__board-cover--1">
        {src ? <img src={src} alt={item.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div className="lib__board-empty"><Image size={32} strokeWidth={1} style={{ color: 'var(--text-3)' }} /></div>}
      </div>
      <div className="lib__board-info">
        <span className="lib__board-name">{item.name}</span>
        <CardMenu actions={[{ label: 'Delete', danger: true, onClick: onDelete }]} />
      </div>
      <div className="lib__board-meta">Image &middot; {age}</div>
    </div>
  );
}

/* ---- Brand audit card ---- */
function BrandAuditCard({ item, onOpen, onDelete }: { item: LibraryItem; onOpen: () => void; onDelete: () => void }) {
  const age = formatAge(item.createdAt);
  return (
    <div className="lib__board">
      <div className="lib__board-cover lib__board-cover--1" onClick={onOpen}>
        <div className="lib__board-empty"><Search size={32} strokeWidth={1} style={{ color: 'var(--text-3)' }} /></div>
      </div>
      <div className="lib__board-info">
        <span className="lib__board-name" onClick={onOpen}>{item.name}</span>
        <CardMenu actions={[
          { label: 'Open', onClick: onOpen },
          { label: 'Delete', danger: true, onClick: onDelete },
        ]} />
      </div>
      <div className="lib__board-meta">Brand audit &middot; {age}</div>
    </div>
  );
}

/* ---- Custom tool card ---- */
function ToolCard({ tool, onOpen, onDelete }: { tool: CustomTool; onOpen: () => void; onDelete: () => void }) {
  const age = formatAge(tool.createdAt);
  const preview = (tool as any).thumbnailUrl ?? null;
  return (
    <div className="lib__board">
      <div className="lib__board-cover lib__board-cover--1" onClick={onOpen}>
        {preview ? <img src={preview} alt={tool.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div className="lib__board-empty" style={{ background: 'var(--bg)' }}>
              <Code2 size={32} strokeWidth={1} style={{ color: 'var(--text-3)' }} />
            </div>}
      </div>
      <div className="lib__board-info">
        <span className="lib__board-name" onClick={onOpen}>{tool.name}</span>
        <CardMenu actions={[
          { label: 'Open', onClick: onOpen },
          { label: 'Delete', danger: true, onClick: onDelete },
        ]} />
      </div>
      <div className="lib__board-meta">Custom tool &middot; {age}</div>
    </div>
  );
}

/* ---- Library page ---- */
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
        setItems(lib); setTools(t); setBoards(b);
      } else {
        const [t, b] = await Promise.all([loadCustomTools(), loadBoards()]);
        setTools(t); setBoards(b);
      }
      setLoading(false);
    })();
  }, [shell.user]);

  const removeItem = async (id: string) => {
    if (shell.user) await cloudDeleteItem(shell.user.id, id);
    setItems(items.filter(i => i.id !== id));
    shell.toast('Removed from library');
  };
  const renameItem = async (id: string, name: string) => {
    if (shell.user) await cloudUpdateItem(shell.user.id, id, { name });
    setItems(items.map(i => i.id === id ? { ...i, name } : i));
  };
  const deleteTool = async (id: string) => {
    if (!window.confirm('Delete this custom tool?')) return;
    const { deleteCustomTool } = await import('../lib/custom-tools');
    await deleteCustomTool(id);
    setTools(tools.filter(t => t.id !== id));
    shell.toast('Tool deleted');
  };
  async function deleteBoard_(id: string) {
    if (!window.confirm('Delete this board? This cannot be undone.')) return;
    await deleteBoard(id);
    setBoards(await loadBoards());
    shell.toast('Board deleted');
  }
  async function shareBoard(board: Board) {
    const updated = await toggleSharing(board);
    setBoards(await loadBoards());
    if (updated.visibility === 'unlisted' && updated.shareSlug) {
      await navigator.clipboard.writeText(`${window.location.origin}/b/${updated.shareSlug}`);
      shell.toast('Link copied');
    } else { shell.toast('Board is now private'); }
  }
  function openBoard(id: string) { shell.openTab(`board-${id}`); navigate(`/t/board-${id}`); }
  function openDeck(id: string) { shell.openTab(`deck-${id}`); navigate(`/t/deck-${id}`); }
  function openTool() { shell.openTab('make'); navigate('/t/make'); }

  // Collect all cards by type for filtering
  const allCards: { type: string; key: string; el: React.ReactNode }[] = [];

  // Boards
  if (filter === 'all' || filter === 'board') {
    for (const b of boards) {
      allCards.push({ type: 'board', key: `board-${b.id}`, el: (
        <BoardCard key={b.id} board={b} onOpen={() => openBoard(b.id)} onShare={() => void shareBoard(b)} onDelete={() => void deleteBoard_(b.id)} />
      )});
    }
  }
  // Decks
  if (filter === 'all' || filter === 'deck') {
    for (const item of items.filter(i => i.type === 'deck')) {
      allCards.push({ type: 'deck', key: item.id, el: (
        <DeckCard key={item.id} item={item} onOpen={() => openDeck(item.id)} onRename={name => void renameItem(item.id, name)} onDelete={() => void removeItem(item.id)} />
      )});
    }
  }
  // Brand audits
  if (filter === 'all' || filter === 'brand-audit') {
    for (const item of items.filter(i => i.type === 'brand-audit')) {
      allCards.push({ type: 'brand-audit', key: item.id, el: (
        <BrandAuditCard key={item.id} item={item} onOpen={() => { shell.openTab('brand-audit'); navigate('/t/brand-audit'); }} onDelete={() => void removeItem(item.id)} />
      )});
    }
  }
  // Palettes
  if (filter === 'all' || filter === 'palette') {
    for (const item of items.filter(i => i.type === 'palette')) {
      allCards.push({ type: 'palette', key: item.id, el: (
        <PaletteCard key={item.id} item={item} onOpen={() => { shell.openTab('palette'); navigate('/t/palette'); }} onDelete={() => void removeItem(item.id)} />
      )});
    }
  }
  // Images
  if (filter === 'all' || filter === 'image') {
    for (const item of items.filter(i => i.type === 'image')) {
      allCards.push({ type: 'image', key: item.id, el: (
        <ImageCard key={item.id} item={item} onDelete={() => void removeItem(item.id)} />
      )});
    }
  }
  // Custom tools
  if (filter === 'all' || filter === 'tool') {
    for (const t of tools) {
      allCards.push({ type: 'tool', key: t.id, el: (
        <ToolCard key={t.id} tool={t} onOpen={() => openTool()} onDelete={() => void deleteTool(t.id)} />
      )});
    }
  }

  const email = shell.user?.email ?? '';
  const username = email.split('@')[0] || 'You';
  const initial = username[0]?.toUpperCase() || '?';
  const memberSince = shell.user?.created_at
    ? new Date(shell.user.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';

  return (
    <>
      <section className="stage stage--full" aria-label="Library">
        <div className="lib">
          {shell.user ? (
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
          )}
          <div className="lib__create">
            <button type="button" className="l-btn l-btn--primary" onClick={async () => { await createBoard('Untitled board'); setBoards(await loadBoards()); shell.openTab('subject-audit'); navigate('/t/subject-audit'); }}>+ Create board</button>
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
          {!loading && !allCards.length && <p className="l-note">Nothing saved yet. Use &ldquo;Save to Library&rdquo; in any tool.</p>}
          <div className="lib__boards">
            {allCards.map(c => c.el)}
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
