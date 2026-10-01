import { useEffect, useRef, type ReactNode } from 'react';

/** Closes on Escape and on backdrop click, restores focus on close. */
export function Modal({ title, onClose, children, labelledBy }: {
  title?: string; onClose: () => void; children: ReactNode; labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="l-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="l-modal" role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy} ref={ref}>
        {title && (
          <div className="l-modal__head">
            <h2 className="l-modal__title">{title}</h2>
            <button type="button" className="l-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
