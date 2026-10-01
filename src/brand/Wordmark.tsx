import { MARK_PATH, MARK_VIEWBOX } from './mark-path';
import './brand.css';

/** The mark, inline so it takes the current text color. */
export function Mark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg className={`lathe-mark ${className ?? ''}`} viewBox={MARK_VIEWBOX} fill="currentColor"
      role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d={MARK_PATH} />
    </svg>
  );
}

/** "Lathe" in Helvetica Neue Medium followed by the mark at cap height. Never an image. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`lathe-wordmark ${className ?? ''}`} aria-label="Lathe" role="img">
      <span className="lathe-wordmark__text" aria-hidden="true">Lathe</span>
      <Mark className="lathe-wordmark__mark" />
    </span>
  );
}
