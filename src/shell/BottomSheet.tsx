import { useRef, useState, useEffect, useCallback, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  collapsed?: ReactNode; // content shown in collapsed state (primary action)
}

const COLLAPSED = 48;
const HALF_RATIO = 0.45;
const FULL_RATIO = 0.85;
type Snap = 'collapsed' | 'half' | 'full';

export function BottomSheet({ children, collapsed: collapsedContent }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snap>('collapsed');
  const dragState = useRef<{ startY: number; startH: number } | null>(null);
  const [height, setHeight] = useState(COLLAPSED);

  const getSnapHeight = useCallback((s: Snap) => {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    if (s === 'collapsed') return COLLAPSED;
    if (s === 'half') return Math.round(vh * HALF_RATIO);
    return Math.round(vh * FULL_RATIO);
  }, []);

  const snapTo = useCallback((s: Snap) => {
    setSnap(s);
    setHeight(getSnapHeight(s));
  }, [getSnapHeight]);

  // Keyboard: expand to full when an input inside is focused
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      if (!sheetRef.current?.contains(t)) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) {
        snapTo('full');
        // Keep input visible above keyboard
        setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [snapTo]);

  // Touch drag on handle
  const onTouchStart = (e: React.TouchEvent) => {
    dragState.current = { startY: e.touches[0].clientY, startH: height };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!dragState.current) return;
    const dy = dragState.current.startY - e.touches[0].clientY;
    const newH = Math.max(COLLAPSED, Math.min(getSnapHeight('full'), dragState.current.startH + dy));
    setHeight(newH);
  };
  const onTouchEnd = () => {
    if (!dragState.current) return;
    dragState.current = null;
    // Snap to nearest
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const halfH = vh * HALF_RATIO;
    const fullH = vh * FULL_RATIO;
    if (height < (COLLAPSED + halfH) / 2) snapTo('collapsed');
    else if (height < (halfH + fullH) / 2) snapTo('half');
    else snapTo('full');
  };

  // Tap handle toggles between collapsed and half
  const onHandleTap = () => {
    if (snap === 'collapsed') snapTo('half');
    else snapTo('collapsed');
  };

  return (
    <div
      ref={sheetRef}
      className={`bottom-sheet bottom-sheet--${snap}`}
      style={{ height: `${height}px` }}
    >
      <div
        className="bottom-sheet__handle"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={onHandleTap}
        style={{ touchAction: 'none' }}
      >
        <div className="bottom-sheet__bar" />
        {snap === 'collapsed' && collapsedContent && (
          <div className="bottom-sheet__collapsed">{collapsedContent}</div>
        )}
      </div>
      <div
        ref={contentRef}
        className="bottom-sheet__content"
        style={{ overscrollBehavior: 'contain', overflow: snap === 'full' ? 'auto' : 'hidden' }}
      >
        {children}
      </div>
    </div>
  );
}
