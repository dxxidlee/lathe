import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '../brand/Wordmark';
import { TOOLS, isReady, toolsByGroup } from '../tools/registry';
import { useShell } from '../shell/state';
import { modKey } from '../lib/format';

/* The campaign photo currently has the tagline and wordmark baked into its pixels, so the
   live type stays off to avoid printing them twice. Supply a clean plate and flip this to false
   to set "Tools for people who make tools." and the wordmark live, in chartreuse, over it. */
const HERO = { src: '/brand/hero-campaign.jpg', textBaked: true };

export function Home() {
  const shell = useShell();
  useEffect(() => { document.title = 'Lathe · Tools for people who make tools.'; }, []);
  const ready = TOOLS.filter(isReady).length;
  return (
    <div className="home">
      <header className="home__bar">
        <Link to="/" aria-label="Lathe home" className="home__bar-mark"><Wordmark /></Link>
        <nav className="home__bar-links" aria-label="Home">
          <a href="#tools">Tools</a>
          <Link to="/make">Make a tool</Link>
          <button type="button" className="home__search" onClick={() => shell.setPaletteOpen(true)}>
            Search <span className="l-kbd">{modKey()}K</span>
          </button>
        </nav>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <img className="hero__img" src={HERO.src} alt="Three people in a sunlit room; campaign photograph for Lathe." />
        {HERO.textBaked ? (
          <h1 id="hero-title" className="sr-only">Lathe. Tools for people who make tools.</h1>
        ) : (
          <div className="hero__type">
            <h1 id="hero-title" className="hero__line">Tools for people who make tools.</h1>
            <Wordmark className="hero__wordmark" />
          </div>
        )}
      </section>

      <section className="index" id="tools" aria-labelledby="index-title">
        <div className="index__head">
          <h2 id="index-title" className="index__title">Every default was someone else's decision.</h2>
          <p className="index__lede">
            Lathe is a suite of design tools that shows its working. Each tool lists its defaults,
            who chose them and why, and can be forked.
          </p>
          <p className="index__count tabular">{ready} of {TOOLS.length} tools built</p>
        </div>
        <div className="index__groups">
          {toolsByGroup().map(({ group, tools }) => (
            <div className="index__group" key={group}>
              <h3 className="index__group-label">{group}</h3>
              <ul className="index__list">
                {tools.map(t => (
                  <li key={t.id}>
                    <Link to={`/t/${t.id}`} className={`index__tool${isReady(t) ? '' : ' is-planned'}`}>
                      <span className="index__num tabular">{String(TOOLS.indexOf(t) + 1).padStart(2, '0')}</span>
                      <span className="index__name">{t.name}</span>
                      <span className="index__blurb">{t.blurb}</span>
                      <span className="index__status tabular">{isReady(t) ? (t.dev ? 'Dev' : 'Open') : `M${t.milestone}`}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="index__group">
            <h3 className="index__group-label">Yours</h3>
            <ul className="index__list">
              <li>
                <Link to="/make" className="index__tool">
                  <span className="index__num tabular">+</span>
                  <span className="index__name">Make a tool</span>
                  <span className="index__blurb">Describe a tool you wish existed.</span>
                  <span className="index__status tabular">M9</span>
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <footer className="index__foot">
          <Wordmark className="index__wordmark" />
          <span>A thesis by David Lee, Parsons Communication Design.</span>
        </footer>
      </section>
    </div>
  );
}
