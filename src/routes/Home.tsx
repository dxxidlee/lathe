import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wordmark } from '../brand/Wordmark';
import { TOOLS } from '../tools/registry';
import { useShell } from '../shell/state';
import { MAKE, MARK_TRANSFORM, STRUCTURE, VIEW, routesFor } from './home-graph';
import { AuthModal } from '../shell/AuthModal';
import '../styles/auth.css';

export function Home() {
  const shell = useShell();
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  useEffect(() => { document.title = 'Lathe'; }, []);

  // Signed-in users go straight to the Library
  useEffect(() => {
    if (shell.user) { navigate('/t/library', { replace: true }); }
  }, [shell.user]);

  const tools = useMemo(() => TOOLS.filter(t => !t.dev && !t.hidden), []);
  const rs = useMemo(() => routesFor(tools.map(t => t.id)), [tools]);

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

  return (
    <div className="home" data-view="graph">
      <header className="home__bar">
        <span className="home__bar-mark"><Wordmark /></span>
        <nav className="home__bar-links">
          <button type="button" className="home__link home__login-btn" onClick={() => setShowLogin(true)}>Log in</button>
        </nav>
      </header>

      <main className="graph-wrap" style={{ touchAction: 'pinch-zoom pan-x pan-y' }}>
        <svg className="graph" width="100%" viewBox={box} preserveAspectRatio="xMidYMid meet" aria-label="Lathe">
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
          {/* Labels only — not clickable */}
          {tools.map((t, i) => {
            const r = rs[i];
            const delay = 900 + i * 85;
            return (
              <g key={t.id} className="graph__tool" data-tool={t.id}>
                <path d={r.line} className="graph__route graph__draw" pathLength={1} style={{ animationDelay: `${delay}ms` }} />
                <path d={r.head} className="graph__route graph__head" style={{ animationDelay: `${delay + 900}ms` }} />
                <text x={r.label.x} y={r.label.y} textAnchor={r.anchor} dominantBaseline={r.baseline} className="graph__label" style={{ animationDelay: `${delay + 700}ms` }}>
                  {t.name}
                </text>
              </g>
            );
          })}
          <g className="graph__tool graph__tool--make" data-tool="make">
            <path d={MAKE.line} className="graph__route graph__draw" pathLength={1} style={{ animationDelay: '700ms' }} />
            <path d={MAKE.head} className="graph__route graph__head" style={{ animationDelay: '1500ms' }} />
            <text x={MAKE.label.x} y={MAKE.label.y} textAnchor="middle" dominantBaseline="hanging" className="graph__label" style={{ animationDelay: '1400ms' }}>Make a tool</text>
          </g>
          </g>
        </svg>
      </main>

      {showLogin && <AuthModal onClose={() => setShowLogin(false)} onSuccess={() => navigate('/t/library')} />}
    </div>
  );
}
