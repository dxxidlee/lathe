import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Wordmark } from '../brand/Wordmark';
import { TOOLS, isReady, toolsByGroup } from '../tools/registry';
import { useShell } from '../shell/state';
import { modKey } from '../lib/format';
import { MAKE, MARK_TRANSFORM, STRUCTURE, VIEW, routesFor } from './home-graph';

/* Home: the Lathe mark as a construction drawing that draws itself in, with every tool on it. Each tool has its own
   route out of the drawing; hovering or focusing a tool draws its route and fades the rest.
   "Tools" in the bar switches to a plain list (also the small-screen view). */
export function Home() {
  const shell = useShell();
  const navigate = useNavigate();
  const [active, setActive] = useState<string | null>(null);
  const [list, setList] = useState(false);
  useEffect(() => { document.title = 'Lathe · Never a beginner again.'; }, []);

  const tools = useMemo(() => TOOLS.filter(t => !t.dev), []);
  const rs = useMemo(() => routesFor(tools.map(t => t.id)), [tools]);
  const ready = tools.filter(isReady).length;
  const current = tools.find(t => t.id === active);
  const go = (path: string) => (e: React.MouseEvent) => { e.preventDefault(); navigate(path); };

  // Fit the viewBox to what is actually drawn (labels included), so the drawing sits in the
  // optical centre of the page rather than wherever the 1200 × 900 canvas puts it.
  const content = useRef<SVGGElement>(null);
  const [box, setBox] = useState(`0 0 ${VIEW.w} ${VIEW.h}`);
  useLayoutEffect(() => {
    const fit = () => {
      const g = content.current; if (!g) return;
      const b = g.getBBox(), pad = 16;
      setBox(`${Math.floor(b.x - pad)} ${Math.floor(b.y - pad)} ${Math.ceil(b.width + pad * 2)} ${Math.ceil(b.height + pad * 2)}`);
    };
    fit();
    void document.fonts?.ready.then(fit); // label widths change once Helvetica Neue is in
  }, [tools]);

  return (
    <div className="home" data-view={list ? 'list' : 'graph'}>
      <header className="home__bar">
        <Link to="/" aria-label="Lathe home" className="home__bar-mark"><Wordmark /></Link>
        <nav className="home__bar-links" aria-label="Home">
          <button type="button" className="home__link" aria-pressed={list} onClick={() => setList(v => !v)}>{list ? 'Graph' : 'Tools'}</button>
          <Link to="/make">Make a tool</Link>
          <button type="button" className="home__search" onClick={() => shell.setPaletteOpen(true)}>
            Search <span className="l-kbd">{modKey()}K</span>
          </button>
        </nav>
      </header>
      <h1 className="sr-only">Lathe. Never a beginner again.</h1>

      <main className="graph-wrap" aria-label="Tools" style={{ touchAction: 'pinch-zoom pan-x pan-y' }}>
        <svg className={`graph${active ? ' is-hovering' : ''}`} width="100%" viewBox={box} preserveAspectRatio="xMidYMid meet" role="navigation" aria-label="Tools">
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
            return (
              <a key={t.id} href={`/t/${t.id}`} onClick={go(`/t/${t.id}`)} className={`graph__tool${active === t.id ? ' is-active' : ''}${isReady(t) ? '' : ' is-planned'}`}
                onMouseEnter={() => setActive(t.id)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(t.id)} onBlur={() => setActive(null)}
                aria-label={`${t.name}: ${t.blurb}${isReady(t) ? '' : ` (arrives in milestone ${t.milestone})`}`} data-tool={t.id}>
                <path d={r.line} className="graph__hit" />
                <path d={r.line} className="graph__route graph__draw" pathLength={1} style={{ animationDelay: `${delay}ms` }} />
                <path d={r.head} className="graph__route graph__head" style={{ animationDelay: `${delay + 900}ms` }} />
                <text x={r.label.x} y={r.label.y} textAnchor={r.anchor} dominantBaseline={r.baseline} className="graph__label" style={{ animationDelay: `${delay + 700}ms` }}>
                  {t.name}{!isReady(t) && <tspan className="graph__tag" dx={4}>M{t.milestone}</tspan>}
                </text>
              </a>
            );
          })}
          <a href="/make" onClick={go('/make')} className={`graph__tool graph__tool--make${active === 'make' ? ' is-active' : ''}`}
            onMouseEnter={() => setActive('make')} onMouseLeave={() => setActive(null)} onFocus={() => setActive('make')} onBlur={() => setActive(null)} aria-label="Make a tool: describe a tool you wish existed" data-tool="make">
            <path d={MAKE.line} className="graph__hit" />
            <path d={MAKE.line} className="graph__route graph__draw" pathLength={1} style={{ animationDelay: '700ms' }} />
            <path d={MAKE.head} className="graph__route graph__head" style={{ animationDelay: '1500ms' }} />
            <text x={MAKE.label.x} y={MAKE.label.y} textAnchor="middle" dominantBaseline="hanging" className="graph__label" style={{ animationDelay: '1400ms' }}>Make a tool</text>
          </a>
          </g>
        </svg>

        <section className="toollist" aria-label="All tools">
          {toolsByGroup().map(({ group, tools: ts }) => ts.some(t => !t.dev) && (
            <div className="toollist__group" key={group}>
              <h2 className="toollist__label">{group}</h2>
              <ul>
                {ts.filter(t => !t.dev).map(t => (
                  <li key={t.id}><Link to={`/t/${t.id}`} className={`toollist__tool${isReady(t) ? '' : ' is-planned'}`}>
                    <span className="toollist__name">{t.name}</span><span className="toollist__blurb">{t.blurb}</span>
                    <span className="toollist__status tabular">{isReady(t) ? 'Open' : `M${t.milestone}`}</span>
                  </Link></li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </main>

      <footer className="home__foot" aria-live="polite">
        <span className="home__foot-main">
          {active === 'make' ? 'Make a tool — describe a tool you wish existed.'
            : current ? <>{current.name} <span className="home__foot-dim">{current.group} · {current.blurb} · {isReady(current) ? 'Open' : `Milestone ${current.milestone}`}</span></>
              : <>Lathe <span className="home__foot-dim">Never a beginner again.</span></>}
        </span>
        <span className="home__foot-dim tabular">{ready} of {tools.length} tools built</span>
      </footer>
    </div>
  );
}
