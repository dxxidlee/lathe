import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useShell } from '../shell/state';
import { loadBoards, saveBoard, renameBoard, deleteBoard, toggleSharing, type Board, type BoardItem } from '../lib/boards';
import { proxied, PaletteQueue } from '../tools/audit/api';
import type { Swatch } from '../lib/color';

interface Props {
  boardId: string;
}

export function BoardView({ boardId }: Props) {
  const shell = useShell();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const [palettes, setPalettes] = useState<Record<string, Swatch[]>>({});
  const paletteQRef = useRef<PaletteQueue | null>(null);
  const scrollRef = useRef(0);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const boards = await loadBoards();
      const found = boards.find(b => b.id === boardId);
      setBoard(found ?? null);
      setLoading(false);
    })();
  }, [boardId]);

  useEffect(() => {
    if (board) {
      shell.setStatus({ name: board.name, state: `${board.items.length} images` });
      shell.setTabLabel(`board-${boardId}`, board.name);
    }
  }, [board]);

  // Extract palette for a single item on demand
  const extractPalette = useCallback((item: BoardItem) => {
    if (palettes[item.id] || item.palette?.length) return;
    if (!paletteQRef.current) {
      paletteQRef.current = new PaletteQueue({ k: 6, sample: 64, iterations: 12, minShare: 0.02, minSwatches: 5, cacheHours: 24 }, 2);
    }
    paletteQRef.current.get(item.id, item.thumbUrl).then(r => {
      if (r?.swatches) setPalettes(prev => ({ ...prev, [item.id]: r.swatches }));
    });
  }, [palettes]);

  const openDetail = (idx: number) => {
    scrollRef.current = document.querySelector('.board-view')?.scrollTop ?? 0;
    setDetailIdx(idx);
    if (board) extractPalette(board.items[idx]);
  };

  const closeDetail = useCallback(() => {
    setDetailIdx(null);
    requestAnimationFrame(() => {
      const el = document.querySelector('.board-view');
      if (el) el.scrollTop = scrollRef.current;
    });
  }, []);

  // Keyboard nav in detail
  useEffect(() => {
    if (detailIdx === null || !board) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeDetail(); return; }
      if (e.key === 'ArrowRight' && detailIdx < board.items.length - 1) {
        setDetailIdx(detailIdx + 1);
        extractPalette(board.items[detailIdx + 1]);
        return;
      }
      if (e.key === 'ArrowLeft' && detailIdx > 0) {
        setDetailIdx(detailIdx - 1);
        extractPalette(board.items[detailIdx - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailIdx, board, closeDetail, extractPalette]);

  if (loading) return (
    <>
      <section className="stage" aria-label="Board"><div className="board-view"><p className="l-note">Loading board...</p></div></section>
      <aside className="inspector" aria-label="Inspector" />
    </>
  );

  if (!board) return (
    <>
      <section className="stage" aria-label="Board"><div className="board-view"><p className="l-note">Board not found.</p></div></section>
      <aside className="inspector" aria-label="Inspector" />
    </>
  );

  const removeItem = (itemId: string) => {
    board.items = board.items.filter(i => i.id !== itemId);
    saveBoard(board);
    setBoard({ ...board });
  };

  const handleRename = (name: string) => {
    void renameBoard(board, name);
    setBoard({ ...board, name });
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${board.name}"?`)) return;
    await deleteBoard(board.id);
    shell.closeTab(`board-${boardId}`);
    shell.toast('Board deleted');
  };

  const handleShare = async () => {
    const updated = await toggleSharing(board);
    setBoard({ ...updated });
    if (updated.visibility === 'unlisted' && updated.shareSlug) {
      await navigator.clipboard.writeText(`${window.location.origin}/b/${updated.shareSlug}`);
      shell.toast('Link copied');
    } else {
      shell.toast('Board is now private');
    }
  };

  const openInAudit = () => {
    shell.openTab('subject-audit');
    navigate('/t/subject-audit');
  };

  const renderDetail = (item: BoardItem) => {
    const swatches = item.palette ?? palettes[item.id] ?? [];
    return (
      <div className="board-detail">
        <button type="button" className="board-detail__back" onClick={closeDetail}>&larr; Back to board</button>
        <img className="board-detail__img" src={item.imageUrl || item.thumbUrl} alt={item.title ?? ''}
          onError={e => { const img = e.target as HTMLImageElement; if (!img.src.includes('/api/img')) img.src = proxied(item.imageUrl || item.thumbUrl); }} />
        <div className="board-detail__meta">
          {item.title && <div className="l-stat"><span className="l-stat__label">Title</span><span className="l-stat__value">{item.title}</span></div>}
          {item.creator && <div className="l-stat"><span className="l-stat__label">Artist</span><span className="l-stat__value">{item.creator}</span></div>}
          {item.date && <div className="l-stat"><span className="l-stat__label">Date</span><span className="l-stat__value">{item.date}</span></div>}
          <div className="l-stat"><span className="l-stat__label">Source</span><span className="l-stat__value">{item.source}</span></div>
          <div className="l-stat"><span className="l-stat__label">License</span><span className="l-stat__value">{item.license}</span></div>
          {item.width && item.height && <div className="l-stat"><span className="l-stat__label">Dimensions</span><span className="l-stat__value">{item.width} &times; {item.height}</span></div>}
          {item.sourceUrl && (
            <div className="l-stat"><span className="l-stat__label">Origin</span><span className="l-stat__value"><a href={item.sourceUrl} target="_blank" rel="noopener">Open</a></span></div>
          )}
          <div className="au-detail__pal-block">
            <div className="au-detail__pal-title">Palette</div>
            <div className="au-detail__palette">
              {swatches.length ? swatches.map(s => (
                <button key={s.hex} type="button" className="au-detail__swatch-item" title={`Click to copy ${s.hex}`}
                  onClick={() => { void navigator.clipboard.writeText(s.hex); shell.toast(`Copied ${s.hex}`); }}>
                  <span className="au-detail__swatch" style={{ background: s.hex }} />
                  <span className="au-detail__hex">{s.hex}</span>
                </button>
              )) : <span className="au-detail__hex">Extracting&hellip;</span>}
            </div>
          </div>
        </div>
        <div className="board-detail__actions">
          <button type="button" className="l-btn" onClick={() => { removeItem(item.id); closeDetail(); }}>Remove from board</button>
        </div>
      </div>
    );
  };

  const renderGrid = () => (
    <>
      <div className="board-view__header">
        <h2 className="board-view__name">{board.name}</h2>
        <span className="board-view__count">{board.items.length} image{board.items.length !== 1 ? 's' : ''}</span>
      </div>
      {board.items.length === 0 ? (
        <div className="board-view__empty">
          <p className="l-note">This board is empty.</p>
          <button type="button" className="l-btn l-btn--primary" onClick={openInAudit}>Search for images</button>
        </div>
      ) : (
        <div className="board-view__grid">
          {board.items.map((item, idx) => (
            <div key={item.id} className="board-view__card">
              <img src={item.thumbUrl} alt={item.title ?? ''} loading="lazy"
                onClick={() => openDetail(idx)}
                style={{ cursor: 'pointer' }}
                onError={e => { const img = e.target as HTMLImageElement; if (!img.src.includes('/api/img')) img.src = proxied(item.thumbUrl); }} />
              <button type="button" className="board-view__remove" onClick={() => removeItem(item.id)} title="Remove">
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <>
      <section className="stage" aria-label={board.name}>
        <div className="board-view">
          {detailIdx !== null && board.items[detailIdx] ? renderDetail(board.items[detailIdx]) : renderGrid()}
        </div>
      </section>
      <aside className="inspector" aria-label="Inspector">
        <div className="l-section">
          <h3 className="l-section__title">Board</h3>
          <div className="l-section__body">
            <div className="l-field">
              <label className="l-label">Name</label>
              <input className="l-input" value={board.name} onChange={e => handleRename(e.target.value)} />
            </div>
            <div className="l-stats">
              <div className="l-stat"><span className="l-stat__label">Images</span><span className="l-stat__value">{board.items.length}</span></div>
              <div className="l-stat"><span className="l-stat__label">Sources</span><span className="l-stat__value">{new Set(board.items.map(i => i.source)).size}</span></div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
              <button type="button" className="l-btn" onClick={openInAudit}>Add images</button>
              <button type="button" className="l-btn" onClick={() => void handleShare()}>{board.visibility === 'unlisted' ? 'Copy link' : 'Share'}</button>
              <button type="button" className="l-btn" onClick={() => void handleDelete()}>Delete</button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
