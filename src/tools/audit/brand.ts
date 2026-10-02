/* Audit, brand mode: a domain or company name in; the site's declared palette, typefaces and logo
   candidates, desktop and mobile captures with their measured palette, a Wayback timeline, optional
   Brandfetch assets and generated observations; then a deck in Bento. */
import type { MountContext, MountResult } from '../types';
import { PaletteQueue, fetchCatalog, type BrandFeatures } from './api';
import { ApiError, captureBrand, downscale, fetchShot, fetchTimeline, requestObservations, type BrandCapture, type LogoCandidate, type Observations, type Timeline } from './brand-api';
import { buildBrandDeck, type DeckImage } from './brand-deck';
import { DECK_MIME } from '../bento/model';
import { deltaE, hexToOklab, type Swatch } from '../../lib/color';
import { button, note, section, statList } from '../../ui/primitives';
import { cacheGet, cacheSet } from '../../lib/idb';

type ShotKey = 'desktop' | 'mobile' | `y${number}`;
interface ShotState { status: 'loading' | 'done' | 'error'; label: string; pageUrl: string; url?: string; blob?: Blob; w?: number; h?: number; swatches?: Swatch[]; error?: string; credit?: { title: string; source: string; license: string; url: string; date: string } }

/** The brand's name: og:site_name, the company Wikidata matched, Brandfetch's, or the title's first part ("Stripe | Payments" → "Stripe"). */
export function brandName(cap: BrandCapture): string {
  const s = cap.site;
  const fromTitle = s.title?.split(/\s+[|–—·:-]\s+/)[0]?.trim();
  return s.siteName || cap.company?.name || cap.brandfetch?.name || (fromTitle && fromTitle.length <= 32 ? fromTitle : '') || cap.domain;
}
const fmtDate = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e;
};

export function mountBrand({ defaults: d, stage, inspector, statusbar, assets, settings, emit }: MountContext, modeEl: HTMLElement): MountResult {
  let query = settings.get('brandQuery', '');
  let cap: BrandCapture | null = null;
  let capError: string | null = null;
  let capturing = false;
  let features: BrandFeatures | null = null;
  const shots = new Map<ShotKey, ShotState>();
  let timeline: Timeline | null = null;
  let timelineError: string | null = null;
  let timelineLoading = false;
  let obs: Observations | null = null;
  let obsState: 'idle' | 'loading' | 'error' = 'idle';
  let obsError: string | null = null;
  let quota: number | null = null;
  let quotaSpent = false;
  const pickedLogos = new Set<number>();
  let controller: AbortController | null = null;
  const urls: string[] = [];
  const palettes = new PaletteQueue({
    k: d.paletteSize as number, sample: d.paletteSample as number, iterations: d.paletteIterations as number,
    minShare: d.minSwatchShare as number, minSwatches: d.minSwatches as number, cacheHours: d.cacheHours as number,
  }, 2);

  /* ---------------- stage ---------------- */
  const root = el('div', 'au');
  const bar = el('form', 'au__bar'); bar.setAttribute('role', 'search');
  const q = document.createElement('input');
  Object.assign(q, { className: 'au__q', type: 'search', placeholder: 'stripe.com, or a company name', value: query });
  q.setAttribute('aria-label', 'Domain or company');
  const go = el('button', 'l-btn l-btn--primary au__go', 'Audit'); go.type = 'submit';
  bar.append(q, go);
  const spacer = el('div', 'au__tabs');
  const scroller = el('div', 'au__scroll');
  const report = el('div', 'ab');
  scroller.append(report);
  root.append(bar, spacer, scroller);
  stage.appendChild(root);
  bar.addEventListener('submit', e => { e.preventDefault(); void run(q.value); });

  /* ---------------- inspector ---------------- */
  const capSec = section('Capture');
  const capStats = statList();
  const capNote = note('');
  const actions = el('div', 'l-row');
  const deckBtn = button({ label: 'Build deck in Bento', primary: true, onClick: () => void buildDeckNow() });
  const obsBtn = button({ label: 'Write observations', onClick: () => void observe() });
  actions.append(deckBtn, obsBtn);
  capSec.body.append(capStats.el, actions, capNote);
  inspector.append(modeEl, capSec.el);

  function renderInspector() {
    const s = cap?.site;
    const shotList = [...shots.values()];
    capStats.set([
      ['Site', !s ? (capturing ? 'Capturing…' : capError ? 'Error' : '—') : `${s.via === 'wayback' ? 'Wayback' : 'Live'} · ${s.ms} ms${(cap as BrandCapture & { cached?: boolean }).cached ? ' · cached' : ''}`],
      ['Stylesheets', s ? `${s.stylesheets.filter(x => x.ok).length} of ${s.stylesheets.length}` : '—'],
      ['Colors', s ? `${s.colorStats.unique} unique · ${s.colorStats.declarations} uses` : '—'],
      ['Typefaces', s ? String(s.typefaces.length) : '—'],
      ['Logos', s ? `${pickedLogos.size} of ${allLogos().length} in deck` : '—'],
      ['Screenshots', shotList.length ? `${shotList.filter(x => x.status === 'done').length} of ${shotList.length}` : '—'],
      ['Timeline', timelineLoading ? 'Searching…' : timeline ? `${timeline.snapshots.length} years` : timelineError ? 'Error' : '—'],
      ['Brandfetch', !features?.brandfetch ? 'Needs BRANDFETCH_KEY' : cap?.brandfetch ? `${cap.brandfetch.logos.length} logos · ${cap.brandfetch.colors.length} colors` : cap?.brandfetchError ? 'Error' : '—'],
      ['Observations', !features?.observations ? 'Needs ANTHROPIC_API_KEY' : obsState === 'loading' ? 'Writing…' : obs ? `${obs.observations.length} generated` : obsState === 'error' ? 'Error' : '—'],
    ]);
    obsBtn.style.display = features?.observations ? '' : 'none';
    capNote.textContent = [
      features && !features.screenshotsLimited ? 'Screenshots: Microlink, with your key.' : `Screenshots use Microlink’s free tier, a small daily quota; set MICROLINK_KEY in .env.local to lift it.${quota != null ? ` ${quota} left today.` : ''}`,
      quotaSpent ? 'The quota is spent: remaining screenshots were skipped.' : '',
      `Captures are cached for ${d.cacheHours} hours, so re-running costs nothing.`,
    ].filter(Boolean).join(' ');
  }

  /* ---------------- run ---------------- */
  async function run(text: string) {
    query = text.trim();
    if (!query) { emit('toast', 'Type a domain or a company name'); return; }
    settings.set('brandQuery', query);
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    palettes.cancelPending();
    cap = null; capError = null; capturing = true; timeline = null; timelineError = null; obs = null; obsState = 'idle'; obsError = null; quotaSpent = false;
    shots.clear(); pickedLogos.clear();
    render();
    try {
      cap = await captureBrand(query, { merge: d.cssColorMerge as number, top: d.cssColorTop as number, cacheHours: d.cacheHours as number }, signal);
    } catch (e) {
      if (signal.aborted) return;
      capError = e instanceof Error ? e.message : String(e);
    }
    capturing = false;
    if (signal.aborted) return;
    if (!cap) { render(); return; }
    defaultLogos();
    obs = await restoreObservations();
    render();
    const site = cap.site;
    const fallbackPage = site.snapshot ? `https://web.archive.org/web/${site.snapshot.timestamp}if_/${site.url}` : null;
    const capturedOn = new Date(cap.capturedAt).toISOString().slice(0, 10);
    const homeCredit = (device: string) => ({ title: `${cap!.domain} homepage, ${device}`, source: 'Screenshot via Microlink', license: 'Site © its owner; captured for research', url: site.url, date: capturedOn });
    await Promise.all([
      shoot('desktop', site.url, 'desktop', 'Homepage, desktop', homeCredit('desktop'), signal, fallbackPage),
      shoot('mobile', site.url, 'mobile', 'Homepage, mobile', homeCredit('mobile'), signal, fallbackPage),
      loadTimeline(signal),
    ]);
  }

  async function shoot(key: ShotKey, pageUrl: string, device: 'desktop' | 'mobile', label: string, credit: ShotState['credit'], signal: AbortSignal, fallback: string | null = null) {
    const st: ShotState = { status: 'loading', label, pageUrl, credit };
    shots.set(key, st); render();
    if (quotaSpent) { st.status = 'error'; st.error = 'Skipped: the free screenshot quota is spent'; render(); return; }
    const size = device === 'mobile' ? { w: d.mobileWidth as number, h: d.mobileHeight as number } : { w: d.desktopWidth as number, h: d.desktopHeight as number };
    try {
      let shot;
      try { shot = await fetchShot(pageUrl, device, size, d.cacheHours as number, signal); }
      catch (e) {
        if (!fallback || (e instanceof ApiError && e.status === 429)) throw e;
        shot = await fetchShot(fallback, device, size, d.cacheHours as number, signal);
        st.label = `${label} (Wayback capture)`;
      }
      if (signal.aborted) return;
      if (shot.quotaRemaining != null) quota = shot.quotaRemaining;
      const url = URL.createObjectURL(shot.blob); urls.push(url);
      Object.assign(st, { status: 'done', url, blob: shot.blob, w: shot.width, h: shot.height });
      render();
      const p = await palettes.run(`brand:${key}`, url, `brand-shot:${device}:${size.w}x${size.h}:${pageUrl}`);
      if (p && !signal.aborted) { st.swatches = p.swatches; render(); }
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof ApiError && e.status === 429) quotaSpent = true;
      st.status = 'error'; st.error = e instanceof Error ? e.message : String(e);
      render();
    }
  }

  async function loadTimeline(signal: AbortSignal) {
    if (!cap) return;
    timelineLoading = true; render();
    try { timeline = await fetchTimeline(cap.site.host, { snapshots: d.timelineSnapshots as number, span: d.timelineSpan as number, cacheHours: d.cacheHours as number }, signal); }
    catch (e) { if (!signal.aborted) timelineError = e instanceof Error ? e.message : String(e); }
    timelineLoading = false;
    if (signal.aborted) return;
    render();
    if (!timeline) return;
    // Two at a time: each one costs a screenshot and a Wayback replay.
    const list = [...timeline.snapshots].reverse();
    const next = async () => {
      for (let s = list.pop(); s; s = list.pop()) {
        await shoot(`y${s.year}`, s.renderUrl, 'desktop', `${s.year} (Wayback ${fmtDate(s.timestamp)})`,
          { title: `${cap!.domain}, ${s.year}`, source: 'Internet Archive Wayback Machine', license: 'Archived capture; site © its owner', url: s.archiveUrl, date: fmtDate(s.timestamp) }, signal);
      }
    };
    await Promise.all([next(), next()]);
  }

  /* ---------------- logos ---------------- */
  const allLogos = (): LogoCandidate[] => [...(cap?.brandfetch?.logos ?? []), ...(cap?.site.logos ?? [])];
  function defaultLogos() {
    // Official files first, then SVGs named as logos or in the home link, then app icons.
    const rank = (l: LogoCandidate) => l.kind === 'brandfetch' ? 0 : l.kind === 'svg' && !/header$/.test(l.label) ? 1
      : ({ manifest: 2, 'apple-touch-icon': 3, svg: 4, img: 5, 'mask-icon': 6, icon: 7, favicon: 8 } as Record<string, number>)[l.kind] ?? 9;
    allLogos().map((l, i) => ({ l, i })).sort((a, b) => rank(a.l) - rank(b.l)).slice(0, 3).forEach(({ i }) => pickedLogos.add(i));
  }

  /* ---------------- color comparison ---------------- */
  function declaredMatch(hex: string): { hex: string; de: number } | null {
    const lab = hexToOklab(hex); if (!lab || !cap) return null;
    let best: { hex: string; de: number } | null = null;
    for (const h of cap.site.declared ?? cap.site.colors.map(c => c.hex)) {
      const l2 = hexToOklab(h); if (!l2) continue;
      const de = deltaE(lab, l2);
      if (!best || de < best.de) best = { hex: h, de };
    }
    return best;
  }
  function declaredShare(sw: Swatch[] | undefined): number | null {
    if (!sw?.length || !cap) return null;
    return sw.reduce((s, x) => s + ((declaredMatch(x.hex)?.de ?? 9) <= (d.declaredMatch as number) ? x.share : 0), 0);
  }

  /* ---------------- render ---------------- */
  let raf = 0;
  function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); }
  function paint() {
    renderInspector();
    const s = cap?.site;
    statusbar.set({ name: cap ? cap.domain : query ? `“${query}”` : 'Audit', state: capturing ? 'capturing' : capError ? 'error' : cap ? `${[...shots.values()].filter(x => x.status === 'loading').length ? 'loading captures · ' : ''}${s!.colorStats.unique} colors · ${s!.typefaces.length} typefaces` : 'brand mode' });
    if (!cap) {
      report.replaceChildren(el('div', 'au__empty', capturing ? `Capturing ${query}…` : capError ?? 'Audit a brand: type a domain like stripe.com, or a company name to look up its website.'));
      return;
    }
    const name = brandName(cap);
    const head = el('header', 'ab__head');
    head.append(el('h2', 'ab__name', name));
    const meta = el('p', 'ab__meta');
    const link = el('a', '', s!.url); (link as HTMLAnchorElement).href = s!.url; (link as HTMLAnchorElement).target = '_blank'; (link as HTMLAnchorElement).rel = 'noopener';
    meta.append(link, document.createTextNode(` · ${s!.title ?? 'no title'}`));
    head.append(meta);
    if (s!.description) head.append(el('p', 'ab__desc', s!.description));
    if (s!.via === 'wayback' && s!.snapshot) {
      const n = el('p', 'ab__flag', `The live site refused automated requests (${s!.liveStatus ?? s!.liveError}); read from the Wayback Machine capture of ${fmtDate(s!.snapshot.timestamp)}.`);
      head.append(n);
    }
    if (cap.company) head.append(el('p', 'ab__meta', `Resolved “${cap.query}” to ${cap.company.name}${cap.company.description ? `, ${cap.company.description}` : ''} via Wikidata.`));

    report.replaceChildren(head, shotsSection(), paletteSection(), typeSection(), logoSection(), timelineSection(), obsSection());
  }

  function block(title: string, aside?: string) {
    const sec = el('section', 'ab__sec');
    const h = el('h3', 'ab__h', title);
    if (aside) h.append(el('span', 'ab__aside', aside));
    sec.append(h);
    return sec;
  }
  function shotFigure(key: ShotKey, cls = '') {
    const st = shots.get(key);
    const fig = el('figure', `ab-shot ${cls}`); fig.dataset.key = key;
    if (!st || st.status === 'loading') fig.append(el('div', 'ab-shot__ph', 'Capturing…'));
    else if (st.status === 'error') fig.append(el('div', 'ab-shot__ph ab-shot__ph--err', st.error ?? 'Failed'));
    else { const img = document.createElement('img'); img.className = 'ab-shot__img'; img.src = st.url!; img.alt = st.label; fig.append(img); }
    const cap2 = el('figcaption', 'ab-shot__cap', st?.label ?? '');
    fig.append(cap2);
    if (st?.swatches) fig.append(swatchRow(st.swatches));
    return fig;
  }
  function swatchRow(sw: Swatch[]) {
    const row = el('div', 'au-card__pal');
    for (const x of sw) {
      const w = el('div', 'au-sw'); w.style.flexGrow = String(Math.max(0.6, x.share * 10));
      const chip = el('span', 'au-sw__chip'); chip.style.background = x.hex;
      w.append(chip, el('span', 'au-sw__hex', x.hex.slice(1))); w.title = `${x.hex} · ${Math.round(x.share * 100)}%`;
      row.append(w);
    }
    return row;
  }
  function shotsSection() {
    const sec = block('Captures', 'Microlink');
    const row = el('div', 'ab-shots');
    row.append(shotFigure('desktop', 'ab-shot--desktop'), shotFigure('mobile', 'ab-shot--mobile'));
    sec.append(row);
    return sec;
  }
  function paletteSection() {
    const s = cap!.site;
    const sec = block('Palette', `${s.colorStats.unique} colors in ${s.colorStats.declarations} declarations`);
    const grid = el('div', 'ab-pal');
    for (const c of s.colors) {
      const sw = el('div', 'ab-pal__sw'); sw.dataset.hex = c.hex;
      const chip = el('span', 'ab-pal__chip'); chip.style.background = c.hex;
      sw.append(chip, el('span', 'ab-pal__hex', c.hex), el('span', 'ab-pal__meta', `${Math.round(c.share * 100)}% · ${c.count}×`));
      if (c.vars.length) sw.append(el('span', 'ab-pal__vars', c.vars.join(' ')));
      grid.append(sw);
    }
    if (!s.colors.length) grid.append(note('No colors found in the site’s CSS.'));
    sec.append(el('h4', 'ab__sub', 'Declared in CSS'), grid);
    const desk = shots.get('desktop');
    if (desk?.swatches) {
      const share = declaredShare(desk.swatches);
      const cmp = el('div', 'ab-cmp');
      for (const x of desk.swatches) {
        const m = declaredMatch(x.hex);
        const ok = !!m && m.de <= (d.declaredMatch as number);
        const r = el('div', `ab-cmp__row${ok ? ' is-match' : ''}`); r.dataset.hex = x.hex;
        const c1 = el('span', 'ab-pal__chip ab-cmp__chip'); c1.style.background = x.hex;
        r.append(c1, el('span', 'ab-cmp__hex', x.hex), el('span', 'ab-cmp__share', `${Math.round(x.share * 100)}%`));
        if (m) { const c2 = el('span', 'ab-pal__chip ab-cmp__chip'); c2.style.background = m.hex; r.append(c2, el('span', 'ab-cmp__hex', ok ? `${m.hex} in CSS` : `nearest ${m.hex}`), el('span', 'ab-cmp__de', `ΔE ${m.de.toFixed(3)}`)); }
        cmp.append(r);
      }
      sec.append(el('h4', 'ab__sub', `Measured in the desktop capture${share != null ? ` · ${Math.round(share * 100)}% declared in CSS` : ''}`), cmp);
    }
    const bf = cap!.brandfetch;
    if (bf?.colors.length) {
      const g = el('div', 'ab-pal');
      for (const c of bf.colors) { const sw = el('div', 'ab-pal__sw'); const chip = el('span', 'ab-pal__chip'); chip.style.background = c.hex; sw.append(chip, el('span', 'ab-pal__hex', c.hex), el('span', 'ab-pal__meta', c.type ?? '')); g.append(sw); }
      sec.append(el('h4', 'ab__sub', 'Official (Brandfetch)'), g);
    }
    return sec;
  }
  function typeSection() {
    const s = cap!.site;
    const sec = block('Typography', s.googleFonts.length || s.adobeKits.length ? [s.googleFonts.length ? 'Google Fonts' : '', s.adobeKits.length ? 'Adobe Fonts' : ''].filter(Boolean).join(' · ') : undefined);
    const list = el('div', 'ab-type');
    for (const t of s.typefaces) {
      const r = el('div', 'ab-type__row');
      r.append(el('span', 'ab-type__fam', t.family), el('span', 'ab-type__src', t.source),
        el('span', 'ab-type__w', t.weights.length ? t.weights.join(' / ') : '—'), el('span', 'ab-type__uses', t.uses ? `${t.uses} stacks` : 'declared'));
      if (t.stack) r.title = t.stack;
      list.append(r);
    }
    if (!s.typefaces.length) list.append(note('No typefaces declared in the site’s CSS.'));
    for (const f of cap!.brandfetch?.fonts ?? []) {
      const r = el('div', 'ab-type__row'); r.append(el('span', 'ab-type__fam', f.name), el('span', 'ab-type__src', `Brandfetch${f.origin ? ` · ${f.origin}` : ''}`), el('span', 'ab-type__w', f.type ?? ''), el('span', 'ab-type__uses', ''));
      list.append(r);
    }
    sec.append(list);
    return sec;
  }
  function logoSection() {
    const logos = allLogos();
    const sec = block('Logos and icons', `${pickedLogos.size} in deck`);
    const grid = el('div', 'ab-logos');
    logos.forEach((l, i) => {
      const b = el('button', `ab-logo${pickedLogos.has(i) ? ' is-picked' : ''}`) as HTMLButtonElement; b.type = 'button';
      b.setAttribute('aria-pressed', String(pickedLogos.has(i)));
      const on = (bg: string) => { const t = el('span', `ab-logo__tile ab-logo__tile--${bg}`); const img = document.createElement('img'); img.src = l.dataUri; img.alt = l.label; t.append(img); return t; };
      b.append(on('light'), on('dark'), el('span', 'ab-logo__label', l.label), el('span', 'ab-logo__meta', `${l.type.replace('image/', '').replace('svg+xml', 'svg')} · ${(l.bytes / 1024).toFixed(1)} KB`));
      b.addEventListener('click', () => { pickedLogos.has(i) ? pickedLogos.delete(i) : pickedLogos.add(i); render(); });
      grid.append(b);
    });
    if (!logos.length) grid.append(note('No logo candidates found.'));
    sec.append(grid);
    const og = cap!.site.og;
    if (og.imageData) {
      const fig = el('figure', 'ab-shot ab-og'); const img = document.createElement('img'); img.className = 'ab-shot__img'; img.src = og.imageData; img.alt = 'Open Graph image';
      fig.append(img, el('figcaption', 'ab-shot__cap', 'Open Graph image'));
      sec.append(el('h4', 'ab__sub', 'Share image'), fig);
    }
    return sec;
  }
  function timelineSection() {
    const sec = block('Timeline', 'Internet Archive Wayback Machine');
    if (timelineLoading) { sec.append(note('Finding one capture per year…')); return sec; }
    if (timelineError) { sec.append(note(timelineError)); return sec; }
    if (!timeline) return sec;
    const row = el('div', 'ab-tl');
    for (const s of timeline.snapshots) {
      const fig = shotFigure(`y${s.year}`, 'ab-shot--year');
      fig.prepend(el('div', 'ab-tl__year', String(s.year)));
      row.append(fig);
    }
    sec.append(row);
    return sec;
  }
  function obsSection() {
    const sec = block('Observations', obs ? `Generated by ${obs.model}` : undefined);
    if (!features?.observations) { sec.append(note('Generated observations need ANTHROPIC_API_KEY in .env.local.')); return sec; }
    if (obsState === 'loading') { sec.append(note('Writing observations from the captures…')); return sec; }
    if (obsState === 'error') sec.append(note(obsError ?? 'Failed'));
    if (!obs) { sec.append(note('“Write observations” sends the captures and extracted data to Claude for a short audit. Every observation must cite a capture.')); return sec; }
    sec.append(el('p', 'ab-obs__label', `Generated by ${obs.model} on ${new Date(obs.generatedAt).toLocaleString()}. Check each against the captures it cites.`));
    if (obs.summary) sec.append(el('p', 'ab-obs__sum', obs.summary));
    const list = el('ol', 'ab-obs');
    for (const o of obs.observations) {
      const li = el('li', 'ab-obs__item');
      li.append(el('span', 'ab-obs__area', o.area), el('p', 'ab-obs__text', o.text));
      const ev = el('div', 'ab-obs__ev');
      for (const k of o.evidence) ev.append(el('span', 'ab-obs__chip', shots.get(k as ShotKey)?.label ?? k));
      li.append(ev); list.append(li);
    }
    sec.append(list);
    return sec;
  }

  /* ---------------- observations ---------------- */
  const obsKey = () => cap && `brand:obs:${cap.domain}:${cap.capturedAt}`;
  async function restoreObservations(): Promise<Observations | null> {
    const k = obsKey(); if (!k) return null;
    return (await cacheGet<Observations>(k)) ?? null;
  }
  async function observe() {
    if (!cap) { emit('toast', 'Capture a brand first'); return; }
    const done = [...shots.entries()].filter(([, s]) => s.status === 'done' && s.blob);
    if (!done.length) { emit('toast', 'Wait for at least one screenshot'); return; }
    obsState = 'loading'; obsError = null; render();
    try {
      const captures = await Promise.all(done.map(async ([id, s]) => ({ id, label: s.label, dataUrl: await downscale(s.blob!, d.observationImagePx as number) })));
      const site = cap.site;
      const facts = {
        title: site.title, description: site.description, themeColor: site.themeColor, readFrom: site.via,
        cssColors: site.colors.map(c => ({ hex: c.hex, share: Math.round(c.share * 1000) / 1000, vars: c.vars })),
        desktopPixelColors: shots.get('desktop')?.swatches?.map(x => ({ hex: x.hex, share: Math.round(x.share * 1000) / 1000 })) ?? [],
        typefaces: site.typefaces.map(t => ({ family: t.family, source: t.source, weights: t.weights, stacksLed: t.uses })),
        brandfetch: cap.brandfetch ? { colors: cap.brandfetch.colors, fonts: cap.brandfetch.fonts } : null,
        timelineYears: timeline?.snapshots.map(s => s.year) ?? [],
      };
      obs = await requestObservations({ name: brandName(cap), domain: cap.domain, captures, facts }, controller?.signal);
      obsState = 'idle';
      await cacheSet(obsKey()!, obs, (d.cacheHours as number) * 3600_000);
    } catch (e) {
      obsState = 'error'; obsError = e instanceof Error ? e.message : String(e);
    }
    render();
  }

  /* ---------------- deck ---------------- */
  async function trayImage(key: string, st: ShotState): Promise<DeckImage | null> {
    if (st.status !== 'done' || !st.blob || !cap) return null;
    const map = settings.get<Record<string, string>>('brandAssets', {});
    const id = `${cap.domain}:${key}:${st.pageUrl}:${st.w}x${st.h}`;
    let asset = map[id] ? assets.get(map[id]) : undefined;
    if (!asset) {
      const name = `${cap.domain.replace(/[^a-z0-9.-]/gi, '-')}-${key.replace(/^y/, '')}.jpg`;
      asset = await assets.add(st.blob, { name, source: 'fetch', origin: 'audit' });
      map[id] = asset.id; settings.set('brandAssets', map);
    }
    return { src: `asset:${asset.id}`, aspect: st.w && st.h ? st.w / st.h : 1.6, credit: { title: st.credit!.title, creator: null, date: st.credit!.date, source: st.credit!.source, license: st.credit!.license, url: st.credit!.url } };
  }
  async function buildDeckNow() {
    if (!cap) { emit('toast', 'Capture a brand first'); return; }
    const site = cap.site;
    const desk = shots.get('desktop'), mob = shots.get('mobile');
    const timelineImgs = [];
    for (const s of timeline?.snapshots ?? []) {
      const st = shots.get(`y${s.year}`);
      const im = st && await trayImage(`y${s.year}`, st);
      if (im) timelineImgs.push({ ...im, year: s.year });
    }
    const ogImg = site.og.imageData ? await (async () => {
      const bmp = await createImageBitmap(await (await fetch(site.og.imageData!)).blob()).catch(() => null);
      const aspect = bmp ? bmp.width / bmp.height : 1.91; bmp?.close();
      return { src: site.og.imageData!, aspect, credit: { title: `${cap!.domain} share image`, creator: null, date: null, source: site.og.image ? new URL(site.og.image).hostname : cap!.domain, license: 'Site © its owner; shown for research', url: site.og.image ?? site.url } } as DeckImage;
    })() : null;
    const deck = buildBrandDeck({
      cap, name: brandName(cap),
      desktop: desk ? await trayImage('desktop', desk) : null,
      mobile: mob ? await trayImage('mobile', mob) : null,
      og: ogImg, timeline: timelineImgs,
      logos: allLogos().filter((_, i) => pickedLogos.has(i)),
      pixelPalette: desk?.swatches ?? [], declaredShare: declaredShare(desk?.swatches),
      observations: obs, theme: d.deckTheme as 'dark' | 'light',
      imagesPerSlide: d.imagesPerSlide as number, paletteSize: d.aggregateSize as number,
    });
    const a = await assets.add(new Blob([JSON.stringify(deck)], { type: DECK_MIME }), { name: `${cap.domain.replace(/[^a-z0-9.-]/gi, '-')}-brand.deck.json`, source: 'tool', origin: 'audit' });
    emit('send', a, 'bento');
  }

  /* ---------------- boot ---------------- */
  render();
  void fetchCatalog().then(c => { features = c.brand; render(); if (query) void run(query); });

  return {
    unmount() { controller?.abort(); palettes.destroy(); cancelAnimationFrame(raf); urls.forEach(u => URL.revokeObjectURL(u)); },
    export: () => void buildDeckNow(),
  };
}
