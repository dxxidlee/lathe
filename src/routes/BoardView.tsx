import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShell } from '../shell/state';
import { loadBoards, saveBoard, renameBoard, deleteBoard, toggleSharing, type Board } from '../lib/boards';
import { proxied } from '../tools/audit/api';

interface Props {
  boardId: string;
}

export function BoardView({ boardId }: Props) {
  const shell = useShell();
  const navigate = useNavigate();
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);

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
    if (board) shell.setStatus({ name: board.name, state: `${board.items.length} images` });
  }, [board]);

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

  return (
    <>
      <section className="stage" aria-label={board.name}>
        <div className="board-view">
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
              {board.items.map(item => (
                <div key={item.id} className="board-view__card">
                  <img src={item.thumbUrl} alt={item.title ?? ''} loading="lazy"
                    onError={e => { const img = e.target as HTMLImageElement; if (!img.src.includes('/api/img')) img.src = proxied(item.thumbUrl); }} />
                  <button type="button" className="board-view__remove" onClick={() => removeItem(item.id)} title="Remove">&times;</button>
                </div>
              ))}
            </div>
          )}
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
