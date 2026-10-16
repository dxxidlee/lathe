import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { Mark } from '../brand/Wordmark';
import { TOOLS } from '../tools/registry';
import { useShell } from '../shell/state';
import { STRUCTURE, MARK_TRANSFORM, VIEW, getRoutes, TOOL_COPY } from './home-graph';
import { AuthModal } from '../shell/AuthModal';
import '../styles/auth.css';

const VISIBLE_IDS = [
  'subject-audit', 'brand-audit', 'deck', 'palette', 'contrast', 'logo-export',
  'icons', 'specimen', 'reference', 'dither', 'gradient', 'kinetic-type', 'recolor', 'make',
];

const TOOL_NAMES: Record<string, string> = {};
for (const t of TOOLS) TOOL_NAMES[t.id] = t.name;
TOOL_NAMES['make'] = 'Make a tool';

export function Home() {
  const shell = useShell();
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [mobileOverlay, setMobileOverlay] = useState<string | null>(null);
  const isMobile = useRef(false);
  useEffect(() => { document.title = 'Lathe'; isMobile.current = window.innerWidth < 768; }, []);

  useEffect(() => {
    if (shell.user) navigate('/t/library', { replace: true });
  }, [shell.user]);

  const routes = useMemo(() => getRoutes(VISIBLE_IDS), []);

  const content = useRef<SVGGElement>(null);
  const [box, setBox] = useState(`0 0 ${VIEW.w} ${VIEW.h}`);
  useLayoutEffect(() => {
    const fit = () => {
      const g = content.current; if (!g) return;
      const b = g.getBBox(), pad = 24;
      setBox(`${Math.floor(b.x - pad)} ${Math.floor(b.y - pad)} ${Math.ceil(b.width + pad * 2)} ${Math.ceil(b.height + pad * 2)}`);
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, []);

  const copy = active ? TOOL_COPY[active] : null;

  return (
    <div className="home" data-active={active ?? undefined}>
      {/* Top bar — matches workspace top bar exactly */}
      <header className="home__bar">
        <button type="button" className="topbar__mark" aria-label="Lathe" style={{ cursor: 'default' }}>
          <Mark />
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="home__login" onClick={() => setShowLogin(true)}>Log in</button>
      </header>

      {/* Desktop: graph */}
      <main className="home__graph">
        <svg className={`graph${active ? ' is-hovering' : ''}`} width="100%" viewBox={box} preserveAspectRatio="xMidYMid meet" aria-label="Lathe tools">
          <g ref={content}>
            <g className="graph__structure">
              {STRUCTURE.map((s, i) => s.dashed
                ? <path key={i} d={s.d} className="graph__line graph__line--dashed graph__draw" pathLength={1} style={{ animationDelay: `${i * 90}ms` }} />
                : s.mark
                  ? <path key={i} d={s.d} transform={MARK_TRANSFORM} className="graph__line graph__mark graph__draw" pathLength={1} style={{ animationDelay: '250ms' }} />
                  : <path key={i} d={s.d} className="graph__line graph__draw" pathLength={1} style={{ animationDelay: `${300 + i * 110}ms` }} />)}
            </g>
            {routes.map((r, i) => {
              const delay = 800 + i * 70;
              const isActive = active === r.id;
              return (
                <g key={r.id} className={`graph__tool${isActive ? ' is-active' : ''}`} data-tool={r.id}
                  onMouseEnter={() => setActive(r.id)} onMouseLeave={() => setActive(null)}>
                  <path d={r.line} className="graph__route graph__draw" pathLength={1} style={{ animationDelay: `${delay}ms` }} strokeWidth={isActive ? 2 : 1.2} />
                  <path d={r.head} className="graph__route graph__head" style={{ animationDelay: `${delay + 600}ms` }} />
                  <text x={r.label.x} y={r.label.y} textAnchor={r.anchor} dominantBaseline={r.baseline}
                    className={`graph__label${isActive ? ' is-active' : ''}`}
                    style={{ animationDelay: `${delay + 500}ms` }}
                    tabIndex={0} onFocus={() => setActive(r.id)} onBlur={() => setActive(null)}>
                    {TOOL_NAMES[r.id] ?? r.id}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Hover tooltip */}
        {copy && active && (
          <div className="home__tooltip" data-tool={active}>
            <div className="home__tooltip-row"><span className="home__tooltip-label">Problem</span> {copy.problem}</div>
            <div className="home__tooltip-row"><span className="home__tooltip-label">Lathe</span> {copy.lathe}</div>
          </div>
        )}
      </main>

      {/* Mobile: list */}
      <div className="home__list">
        {VISIBLE_IDS.map(id => (
          <button key={id} type="button" className="home__list-item" onClick={() => setMobileOverlay(id)}>
            {TOOL_NAMES[id] ?? id}
          </button>
        ))}
      </div>

      {/* Mobile overlay */}
      {mobileOverlay && TOOL_COPY[mobileOverlay] && (
        <div className="home__overlay">
          <header className="home__overlay-head">
            <button type="button" className="home__overlay-close" onClick={() => setMobileOverlay(null)} aria-label="Close">
              <X size={20} strokeWidth={1.5} />
            </button>
            <span className="home__overlay-title">{TOOL_NAMES[mobileOverlay]}</span>
          </header>
          <div className="home__overlay-body">
            <p><span className="home__overlay-label">Problem</span> {TOOL_COPY[mobileOverlay].problem}</p>
            <p><span className="home__overlay-label">Lathe</span> {TOOL_COPY[mobileOverlay].lathe}</p>
          </div>
        </div>
      )}

      {showLogin && <AuthModal onClose={() => setShowLogin(false)} onSuccess={() => navigate('/t/library')} />}
    </div>
  );
}
