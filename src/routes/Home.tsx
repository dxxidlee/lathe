import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { Mark } from '../brand/Wordmark';
import { TOOLS } from '../tools/registry';
import { useShell } from '../shell/state';
import { STRUCTURE, MARK_TRANSFORM, VIEW, MAKE, routesFor, TOOL_COPY } from './home-graph';
import { AuthModal } from '../shell/AuthModal';
import '../styles/auth.css';

const TOOL_NAMES: Record<string, string> = {};
for (const t of TOOLS) TOOL_NAMES[t.id] = t.name;
TOOL_NAMES['make'] = 'Make a tool';

export function Home() {
  const shell = useShell();
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [mobileOverlay, setMobileOverlay] = useState<string | null>(null);
  useEffect(() => { document.title = 'Lathe'; }, []);

  useEffect(() => {
    if (shell.user) navigate('/t/library', { replace: true });
  }, [shell.user]);

  const tools = useMemo(() => TOOLS.filter(t => !t.dev && !t.hidden), []);
  const rs = useMemo(() => routesFor(tools.map(t => t.id)), [tools]);
  const allIds = useMemo(() => [...tools.map(t => t.id), 'make'], [tools]);

  const content = useRef<SVGGElement>(null);
  const [box, setBox] = useState(`0 0 ${VIEW.w} ${VIEW.h}`);
  useLayoutEffect(() => {
    const fit = () => {
      const g = content.current; if (!g) return;
      const b = g.getBBox(), pad = 16;
      setBox(`${Math.floor(b.x - pad)} ${Math.floor(b.y - pad)} ${Math.ceil(b.width + pad * 2)} ${Math.ceil(b.height + pad * 2)}`);
    };
    fit();
    void document.fonts?.ready.then(fit);
  }, [tools]);

  const copy = active ? TOOL_COPY[active] : null;

  return (
    <div className="home">
      <header className="home__bar">
        <button type="button" className="topbar__mark" aria-label="Lathe" style={{ cursor: 'default' }}>
          <Mark />
        </button>
        <div style={{ flex: 1 }} />
        <button type="button" className="home__login" onClick={() => setShowLogin(true)}>Log in</button>
      </header>

      {/* Desktop graph */}
      <main className="home__graph">
        <svg className={`graph${active ? ' is-hovering' : ''}`} width="100%" viewBox={box} preserveAspectRatio="xMidYMid meet" aria-label="Lathe tools">
          <defs>
            {STRUCTURE.map((s, i) => s.dashed && (
              <mask id={`m${i}`} key={i} maskUnits="userSpaceOnUse"><path d={s.d} className="graph__reveal" style={{ animationDelay: `${i * 90}ms` }} pathLength={1} /></mask>
            ))}
          </defs>
          <g ref={content}>
            <g className="graph__structure">
              {STRUCTURE.map((s, i) => s.dashed
                ? <path key={i} d={s.d} className="graph__line graph__line--dashed" mask={`url(#m${i})`} />
                : s.mark
                  ? <path key={i} d={s.d} transform={MARK_TRANSFORM} className="graph__line graph__mark graph__draw" pathLength={1} style={{ animationDelay: '250ms' }} />
                  : <path key={i} d={s.d} className="graph__line graph__draw" pathLength={1} style={{ animationDelay: `${300 + i * 110}ms` }} />)}
            </g>
            {tools.map((t, i) => {
              const r = rs[i];
              const delay = 900 + i * 85;
              const isActive = active === t.id;
              return (
                <g key={t.id} className={`graph__tool${isActive ? ' is-active' : ''}`} data-tool={t.id}
                  onMouseEnter={() => setActive(t.id)} onMouseLeave={() => setActive(null)}>
                  <path d={r.line} className="graph__route graph__draw" pathLength={1} style={{ animationDelay: `${delay}ms` }} />
                  <path d={r.head} className="graph__route graph__head" style={{ animationDelay: `${delay + 900}ms` }} />
                  <text x={r.label.x} y={r.label.y} textAnchor={r.anchor} dominantBaseline={r.baseline}
                    className={`graph__label${isActive ? ' is-active' : ''}`} style={{ animationDelay: `${delay + 700}ms` }}
                    tabIndex={0} onFocus={() => setActive(t.id)} onBlur={() => setActive(null)}>
                    {t.name}
                  </text>
                </g>
              );
            })}
            {/* Make a tool */}
            <g className={`graph__tool graph__tool--make${active === 'make' ? ' is-active' : ''}`}
              onMouseEnter={() => setActive('make')} onMouseLeave={() => setActive(null)}>
              <path d={MAKE.line} className="graph__route graph__draw" pathLength={1} style={{ animationDelay: '700ms' }} />
              <path d={MAKE.head} className="graph__route graph__head" style={{ animationDelay: '1500ms' }} />
              <text x={MAKE.label.x} y={MAKE.label.y} textAnchor="middle" dominantBaseline="hanging"
                className={`graph__label${active === 'make' ? ' is-active' : ''}`} style={{ animationDelay: '1400ms' }}
                tabIndex={0} onFocus={() => setActive('make')} onBlur={() => setActive(null)}>
                Make a tool
              </text>
            </g>
          </g>
        </svg>

        {copy && active && (
          <div className="home__tooltip">
            <div className="home__tooltip-row"><span className="home__tooltip-label">Problem</span> {copy.problem}</div>
            <div className="home__tooltip-row"><span className="home__tooltip-label">Lathe</span> {copy.lathe}</div>
          </div>
        )}
      </main>

      {/* Mobile list */}
      <div className="home__list">
        {allIds.map(id => (
          <button key={id} type="button" className="home__list-item" onClick={() => setMobileOverlay(id)}>
            {TOOL_NAMES[id] ?? id}
          </button>
        ))}
      </div>

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
