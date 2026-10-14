/* Audit, brand mode: a domain or company name in; the site's declared palette, typefaces and logo
   candidates, desktop and mobile captures with their measured palette, a Wayback timeline, optional
   Brandfetch assets and generated observations; then a deck in Bento. */
import type { MountContext, MountResult } from '../types';
import { PaletteQueue, fetchCatalog, proxied, type BrandFeatures } from './api';
import { ApiError, captureBrand, downscale, fetchInstagram, fetchMoreInstagram, fetchRendered, fetchShot, igHandle, igSrc, logoFromUrl, fetchSocial, fetchTimeline, requestObservations, type BrandCapture, type IgPost, type Instagram, type LogoCandidate, type SiteCapture, type Observations, type Social, type Timeline } from './brand-api';
import { buildBrandDeck, type DeckImage } from './brand-deck';
import { BRAND_SLIDE_MIME, buildPalette, createSlide, type AssetCandidate } from './brand-slide';
import { DECK_MIME } from '../bento/model';
import { deltaE, hexToOklab, kmeans, rgbToOklab, type Lab, type Swatch } from '../../lib/color';
import { button, chips, field, note, section, select, slider, statList } from '../../ui/primitives';
import { cacheGet, cacheSet } from '../../lib/idb';

type SiteImage = SiteCapture['images'][number];
type ShotKey = 'desktop' | 'mobile' | `y${number}`;
interface ShotState { status: 'loading' | 'done' | 'error'; label: string; pageUrl: string; url?: string; blob?: Blob; w?: number; h?: number; swatches?: Swatch[]; error?: string; credit?: { title: string; source: string; license: string; url: string; date: string } }

/** The brand's name: og:site_name, the company Wikidata matched, Brandfetch's, or the title's first part ("Stripe | Payments" → "Stripe"). */
export function brandName(cap: BrandCapture): string {
  const s = cap.site;
  const fromTitle = s.title?.split(/\s+[|–—·:-]\s+/)[0]?.trim();
  return s.siteName || cap.company?.name || cap.brandfetch?.name || (fromTitle && fromTitle.length <= 32 ? fromTitle : '') || cap.domain;
}
/** Official files first, then SVGs named as logos (or in the home link), then app icons. */
const logoRank = (l: LogoCandidate) => l.kind === 'brandfetch' ? 0 : l.kind === 'svg' && !/header$/.test(l.label) ? 1
  : ({ manifest: 2, 'apple-touch-icon': 3, svg: 4, img: 5, 'mask-icon': 6, icon: 7, favicon: 8 } as Record<string, number>)[l.kind] ?? 9;
const fmtDate = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e;
};

export function mountBrand({ defaults: d, stage, inspector, statusbar, assets, settings, emit, onActivate }: MountContext, modeEl?: HTMLElement): MountResult {
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
  let social: Social | null = null;
  let socialLoading = false;
  let socialError: string | null = null;
  /** Imagery picked for the board: `ig:<post>`, `yt:<video>:<still>` or `site:<index>`, in pick order. */
  let picks: string[] = [];
  let picksTouched = false;
  /** Brand Library: content filter and selection for deck building. */
  type ContentFilter = 'all' | 'instagram' | 'youtube' | 'brand' | 'video';
  let contentFilter: ContentFilter = 'all';
  const selected = new Map<string, number>(); // asset ID → selection order number (1-based)
  let currentLogoIdx = 0;
  let brandPalette: string[] = [];
  /** Instagram: the handle (from Brandfetch's links, the site's, or typed), its profile and posts. */
  let ig: Instagram | null = null;
  let igLoading = false;
  let igError: string | null = null;
  let igFrom: 'Brandfetch' | 'site' | 'typed' | null = null;
  let igName: string | null = null;
  let nextIgCursor: string | null = null;
  /** Instagram tiles are kept across repaints so their videos keep playing. */
  const igNodes = new Map<string, { card: HTMLElement; pick: HTMLButtonElement }>();
  const igViews = new IntersectionObserver(entries => {
    for (const e of entries) {
      const v = e.target.querySelector('video');
      if (!v) continue;
      if (e.isIntersecting && igTabActive) { if (!v.src && v.dataset.src) v.src = v.dataset.src; void v.play().catch(() => {}); } else v.pause();
    }
  }, { root: null, rootMargin: '25% 0%' });
  /** IntersectionObserver for autoplay on content grid videos. */
  const contentVideoObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting) {
        if (!v.src && v.dataset.src) v.src = v.dataset.src;
        void v.play().catch(() => {});
      } else {
        v.pause();
      }
    }
  }, { rootMargin: '100px' });
  let igTabActive = true;
  const offActivate = onActivate(active => {
    igTabActive = active;
    if (!active) {
      // Pause all playing Instagram videos when tab becomes inactive
      igNodes.forEach(n => { const v = n.card.querySelector('video'); if (v) v.pause(); });
    }
    // When active, let the IntersectionObserver handle re-playing visible ones on next scroll/paint
  });
  /** Site photography seen only once the page is rendered (script-built sites). */
  let rendered: SiteImage[] = [];
  /** Logos found only in the rendered page. */
  let renderedLogos: LogoCandidate[] = [];
  let logosTouched = false;
  let controller: AbortController | null = null;
  const urls: string[] = [];
  const palettes = new PaletteQueue({
    k: d.paletteSize as number, sample: d.paletteSample as number, iterations: d.paletteIterations as number,
    minShare: d.minSwatchShare as number, minSwatches: d.minSwatches as number, cacheHours: d.cacheHours as number,
  }, 2);

  /* ---------------- content items ---------------- */
  interface ContentItem {
    id: string;
    url: string;
    thumbUrl: string;
    source: 'instagram' | 'youtube' | 'brand';
    isVideo: boolean;
    carouselCount?: number;
    carouselFrames?: Array<{ type: string; src: string; poster?: string }>;
    videoUrl?: string;
  }
  function getContentItems(): ContentItem[] {
    const items: ContentItem[] = [];
    const logoUrls = new Set(allLogos().map(l => l.url).filter(Boolean));
    if (ig?.posts) {
      for (const p of ig.posts) {
        if (!p.src) continue;
        items.push({
          id: `ig:${p.id}`,
          url: p.src,
          thumbUrl: p.poster ?? p.src,
          source: 'instagram',
          isVideo: p.type === 'video',
          carouselCount: p.slides?.length || undefined,
          carouselFrames: p.slides?.map(s => ({ type: s.type, src: s.src, poster: s.poster ?? undefined })),
          videoUrl: p.type === 'video' ? p.src : undefined,
        });
      }
    }
    if (social?.youtube?.videos) {
      for (const v of social.youtube.videos) {
        // Show each video's best still (first one, highest res)
        for (let si = 0; si < v.stills.length; si++) {
          const still = v.stills[si];
          if (!still) continue;
          items.push({
            id: `yt:${v.id}:${si}`,
            url: stillSrc(still),
            thumbUrl: stillSrc(still),
            source: 'youtube',
            isVideo: false,
          });
        }
      }
    }
    for (const img of siteImages()) {
      if (logoUrls.has(img.url)) continue;
      if (img.w != null && img.w < 100) continue;
      items.push({
        id: `site:${img.url}`,
        url: img.url,
        thumbUrl: img.url,
        source: 'brand',
        isVideo: false,
      });
    }
    return items;
  }
  function toggleSelection(id: string) {
    if (selected.has(id)) {
      const removed = selected.get(id)!;
      selected.delete(id);
      for (const [k, v] of selected) { if (v > removed) selected.set(k, v - 1); }
    } else {
      selected.set(id, selected.size + 1);
    }
    renderContentGrid();
    renderInspector();
    autoSave();
  }
  let saveDebounce = 0;
  function autoSave() {
    clearTimeout(saveDebounce);
    saveDebounce = window.setTimeout(() => {
      settings.set('brandKit', { logoIdx: currentLogoIdx, palette: brandPalette });
      settings.set('selections', [...selected.entries()]);
    }, 500);
  }

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

  /* ---------------- content grid (stable across repaints) ---------------- */
  const contentGrid = el('div', 'ab__content-grid');
  const filterChipsEl = chips<ContentFilter>({
    value: contentFilter,
    options: [
      { value: 'all', label: 'All' },
      { value: 'instagram', label: 'Instagram' },
      { value: 'youtube', label: 'YouTube' },
      { value: 'brand', label: 'Brand imagery' },
      { value: 'video', label: 'Video' },
    ],
    onChange: v => { contentFilter = v as ContentFilter; renderContentGrid(); },
  });
  function renderContentGrid() {
    const items = getContentItems();
    const filtered = contentFilter === 'all' ? items
      : contentFilter === 'video' ? items.filter(i => i.isVideo)
      : items.filter(i => i.source === contentFilter);

    const cards = filtered.map(item => {
      const card = el('div', 'ab__content-card');
      const img = document.createElement('img');
      img.className = 'ab__content-img';
      img.src = item.thumbUrl;
      img.loading = 'lazy';
      img.alt = '';
      img.addEventListener('error', () => { if (!img.src.includes('/api/img')) img.src = proxied(item.thumbUrl); }, { once: true });

      if (item.isVideo) {
        const play = el('div', 'ab__content-play');
        play.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
        card.appendChild(play);
      }

      // Carousel frame stepper
      let countEl: HTMLElement | null = null;
      if (item.carouselFrames && item.carouselFrames.length > 1) {
        let frameIdx = 0;
        countEl = el('div', 'ab__content-carousel');
        countEl.textContent = `1/${item.carouselFrames.length}`;
        card.appendChild(countEl);

        const prevBtn = el('button', 'ab__carousel-prev') as HTMLButtonElement;
        prevBtn.type = 'button';
        prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>';
        prevBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          frameIdx = (frameIdx - 1 + item.carouselFrames!.length) % item.carouselFrames!.length;
          img.src = igSrc(item.carouselFrames![frameIdx].src);
          countEl!.textContent = `${frameIdx + 1}/${item.carouselFrames!.length}`;
        });

        const nextBtn = el('button', 'ab__carousel-next') as HTMLButtonElement;
        nextBtn.type = 'button';
        nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>';
        nextBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          frameIdx = (frameIdx + 1) % item.carouselFrames!.length;
          img.src = igSrc(item.carouselFrames![frameIdx].src);
          countEl!.textContent = `${frameIdx + 1}/${item.carouselFrames!.length}`;
        });

        card.append(prevBtn, nextBtn);
      } else if (item.carouselCount && item.carouselCount > 1) {
        const count = el('div', 'ab__content-carousel');
        count.textContent = `1/${item.carouselCount}`;
        card.appendChild(count);
      }

      const selBtn = el('button', 'ab__content-sel') as HTMLButtonElement;
      selBtn.type = 'button';
      const selNum = selected.get(item.id);
      if (selNum != null) {
        selBtn.textContent = String(selNum);
        selBtn.classList.add('is-selected');
      } else {
        selBtn.textContent = '+';
      }
      selBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelection(item.id);
      });

      // Videos: autoplay muted+looped, fall back to poster on expired CDN URL
      if (item.isVideo && item.videoUrl) {
        const video = document.createElement('video');
        const videoSrc = item.source === 'instagram' ? igSrc(item.videoUrl) : proxied(item.videoUrl);
        const posterSrc = item.source === 'instagram' ? igSrc(item.thumbUrl) : proxied(item.thumbUrl);
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.className = 'ab__content-video';
        video.poster = posterSrc;
        video.dataset.src = videoSrc;
        video.addEventListener('error', () => {
          // CDN URL expired — show poster image instead
          video.style.display = 'none';
          img.src = posterSrc;
          img.style.display = '';
        }, { once: true });
        img.style.display = 'none';
        card.append(video, img, selBtn);
        contentVideoObserver.observe(video);
      } else {
        card.append(img, selBtn);
      }
      return card;
    });

    // Load more button for Instagram pagination
    const loadMoreRow = el('div', 'ab__load-more');
    const loadMoreBtn = el('button', 'l-btn') as HTMLButtonElement;
    loadMoreBtn.type = 'button';
    loadMoreBtn.textContent = 'Load more';
    loadMoreBtn.addEventListener('click', async () => {
      if (!nextIgCursor || !ig) return;
      loadMoreBtn.textContent = 'Loading\u2026';
      loadMoreBtn.disabled = true;
      try {
        const data = await fetchMoreInstagram(ig.username, nextIgCursor, controller?.signal ?? undefined);
        if (data.posts?.length) {
          ig.posts.push(...data.posts);
          nextIgCursor = data.nextCursor ?? null;
          renderContentGrid();
        } else {
          nextIgCursor = null;
        }
      } catch { /* ignore */ }
      loadMoreBtn.textContent = 'Load more';
      loadMoreBtn.disabled = false;
    });
    loadMoreRow.hidden = !nextIgCursor || (contentFilter !== 'all' && contentFilter !== 'instagram');
    loadMoreRow.appendChild(loadMoreBtn);

    if (!filtered.length) {
      const empty = el('div', 'au__empty');
      empty.textContent = contentFilter === 'all' ? 'No content captured yet.' : `No ${contentFilter} content.`;
      contentGrid.replaceChildren(empty);
    } else {
      contentGrid.replaceChildren(...cards, loadMoreRow);
    }
  }

  /* ---------------- inspector ---------------- */
  const selSec = section('Selection');
  const selCount = el('div', 'ab__sel-count');
  const buildSlideBtn = button({ label: 'Build slide', primary: true, onClick: async () => {
    if (!selected.size) { emit('toast', 'Select at least one image'); return; }
    if (!cap) { emit('toast', 'Capture a brand first'); return; }

    const items = getContentItems();
    const selectedItems = [...selected.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => items.find(i => i.id === id))
      .filter(Boolean);

    const candidates: AssetCandidate[] = selectedItems.map((item, i) => ({
      url: item!.url,
      thumbUrl: item!.thumbUrl,
      width: null,
      height: null,
      priority: i,
      type: item!.source as AssetCandidate['type'],
      isTransparent: false,
    }));

    const logos = allLogos().sort((a, b) => logoRank(a) - logoRank(b));
    const logo = logos[currentLogoIdx % logos.length];
    const logoUrl = logo?.dataUri ?? logo?.url ?? '';
    const logoIsLight = logo?.kind === 'svg';

    const slide = createSlide(
      candidates, logoUrl, logoIsLight,
      cap.site.colors.map((c: any) => c.hex),
      cap.brandfetch?.colors?.map((c: any) => c.hex) ?? [],
    );

    const slideData = JSON.stringify(slide);
    const blob = new Blob([slideData], { type: BRAND_SLIDE_MIME });
    const name = brandName(cap).replace(/[^a-z0-9.-]/gi, '-') || 'brand';
    const a = await assets.add(blob, { name: `${name}.brand-slide.json`, source: 'tool', origin: 'brand-audit' });
    emit('send', a, 'deck');
  }});
  const actions = el('div', 'l-row');
  actions.append(selCount, buildSlideBtn);
  selSec.body.append(actions);

  const srcSec = section('Sources');
  srcSec.el.classList.add('l-section--advanced');
  srcSec.el.querySelector('.l-section__title')!.addEventListener('click', () => srcSec.el.classList.toggle('is-open'));
  const capStats = statList();
  const capNote = note('');
  // Typed only when neither Brandfetch nor the site links an Instagram account (or the one found fails).
  const igField = field({ label: 'Instagram handle', value: '', placeholder: '@handle', onChange: v => void setHandle(v) });
  const screenshotPreset = select<'both' | 'desktop'>({ label: 'Screenshots', value: (d.mobileWidth as number) > 0 ? 'both' : 'desktop', options: [{ value: 'both', label: 'Desktop + Mobile' }, { value: 'desktop', label: 'Desktop only' }], onChange: v => { (d as Record<string, unknown>).mobileWidth = v === 'both' ? 390 : 0; } });
  srcSec.body.append(
    capStats.el, igField.el,
    screenshotPreset.el,
    slider({ label: 'Timeline snapshots', min: 1, max: 16, value: d.timelineSnapshots as number, onChange: v => { (d as Record<string, unknown>).timelineSnapshots = v; } }).el,
    slider({ label: 'Timeline span', min: 1, max: 30, value: d.timelineSpan as number, unit: ' years', onChange: v => { (d as Record<string, unknown>).timelineSpan = v; } }).el,
    slider({ label: 'YouTube videos', min: 1, max: 12, value: d.boardVideos as number, onChange: v => { (d as Record<string, unknown>).boardVideos = v; } }).el,
    capNote,
  );

  inspector.append(...[modeEl, selSec.el, srcSec.el].filter(Boolean) as HTMLElement[]);

  function renderInspector() {
    const s = cap?.site;
    const shotList = [...shots.values()];
    capStats.set([
      ['Site', !s ? (capturing ? 'Capturing…' : capError ? 'Error' : '—') : `${s.via === 'wayback' ? 'Wayback' : 'Live'} · ${s.ms} ms${(cap as BrandCapture & { cached?: boolean }).cached ? ' · cached' : ''}`],
      ['Stylesheets', s ? `${s.stylesheets.filter(x => x.ok).length} of ${s.stylesheets.length}` : '—'],
      ['Colors', s ? `${s.colorStats.unique} unique · ${s.colorStats.declarations} uses` : '—'],
      ['Typefaces', s ? String(s.typefaces.length) : '—'],
      ['Logos', s ? `${pickedLogos.size} of ${allLogos().length} in deck` : '—'],
      ['Imagery', socialLoading ? 'Searching YouTube…' : s ? `${picks.length} picked · ${social?.youtube?.videos.length ?? 0} videos · ${siteImages().length} site images` : '—'],
      ['Instagram', igLoading ? 'Loading…' : ig ? `${ig.mock ? 'Sample · ' : ''}@${ig.username} · ${ig.posts.length} posts` : igError ? 'Error' : cap && !igName ? 'No handle found' : '—'],
      ['Screenshots', shotList.length ? `${shotList.filter(x => x.status === 'done').length} of ${shotList.length}` : '—'],
      ['Timeline', timelineLoading ? 'Searching…' : timeline ? `${timeline.snapshots.length} years` : timelineError ? 'Error' : '—'],
      ['Brandfetch', !features?.brandfetch ? 'Needs BRANDFETCH_KEY' : cap?.brandfetch ? `${cap.brandfetch.logos.length} logos · ${cap.brandfetch.colors.length} colors` : cap?.brandfetchError ? 'Error' : '—'],
      ['Observations', !features?.observations ? 'Needs ANTHROPIC_API_KEY' : obsState === 'loading' ? 'Writing…' : obs ? `${obs.observations.length} generated` : obsState === 'error' ? 'Error' : '—'],
    ]);
    selCount.textContent = selected.size ? `${selected.size} selected` : 'Select images below';
    selCount.style.color = selected.size ? 'var(--accent)' : 'var(--text-3)';
    buildSlideBtn.disabled = !selected.size;
    buildSlideBtn.className = selected.size ? 'l-btn l-btn--primary' : 'l-btn';
    igField.el.style.display = cap && !igLoading && (!igName || igError) ? '' : 'none';
    if (document.activeElement !== igField.input) igField.input.value = igName ? `@${igName}` : '';
    capNote.textContent = [
      quotaSpent ? 'Screenshot quota spent: remaining screenshots were skipped.' : quota != null ? `${quota} screenshots left today.` : '',
      `Captures are cached for ${d.cacheHours} hours.`,
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
    social = null; socialError = null; picks = []; picksTouched = false; rendered = []; renderedLogos = []; logosTouched = false;
    ig = null; igError = null; igFrom = null; igName = null; igLoading = false; nextIgCursor = null; igNodes.forEach(n => igViews.unobserve(n.card)); igNodes.clear();
    shots.clear(); pickedLogos.clear(); selected.clear(); contentFilter = 'all';
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
      loadSocial(signal),
      loadInstagram(signal),
    ]);
  }

  /** The brand's Instagram: the account Brandfetch links (or the site does, or a handle typed for this
      domain), its profile and latest 30 posts. A failure stays in this section: the audit carries on. */
  async function loadInstagram(signal: AbortSignal) {
    if (!cap) return;
    const typed = settings.get<Record<string, string>>('igHandles', {})[cap.domain];
    const fromBf = igHandle(cap.brandfetch?.social?.instagram), fromSite = igHandle(cap.site.social?.instagram);
    igName = typed ?? fromBf ?? fromSite;
    igFrom = typed ? 'typed' : fromBf ? 'Brandfetch' : fromSite ? 'site' : null;
    if (!igName) { render(); return; }
    igLoading = true; igError = null; nextIgCursor = null; render();
    try {
      ig = await fetchInstagram(igName, signal);
      nextIgCursor = ig.nextCursor ?? null;
    }
    catch (e) { if (signal.aborted) return; ig = null; igError = e instanceof Error ? e.message : String(e); }
    igLoading = false;
    if (signal.aborted) return;
    igNodes.forEach(n => igViews.unobserve(n.card)); igNodes.clear();
    if (!picksTouched) defaultPicks();
    render();
  }
  async function setHandle(v: string) {
    if (!cap) return;
    const h = v.trim().replace(/^@/, '').replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').toLowerCase();
    const map = settings.get<Record<string, string>>('igHandles', {});
    if (!h) delete map[cap.domain];
    else if (!/^[a-z0-9._]{1,30}$/.test(h)) { emit('toast', 'Instagram handles use letters, numbers, periods and underscores'); return; }
    else map[cap.domain] = h;
    settings.set('igHandles', map);
    picks = picks.filter(k => !k.startsWith('ig:'));
    await loadInstagram(controller?.signal ?? new AbortController().signal);
  }

  /** YouTube stills (the brand's channel, or its commercials) and the site's own photography. */
  async function loadSocial(signal: AbortSignal) {
    if (!cap) return;
    socialLoading = true; render();
    // Search YouTube with the name as typed (or the brand's name, without ® and the like, for a domain).
    const clean = (t: string) => t.replace(/[®™©]/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    const name = /\.[a-z]{2,}(\/|$)/i.test(query) ? clean(brandName(cap)) : clean(query);
    const few = (cap.site.images ?? []).length < 4;
    const [so, re] = await Promise.allSettled([
      fetchSocial(name, cap.site.social?.youtube, { videos: 100, cacheHours: d.cacheHours as number }, signal),
      few ? fetchRendered(cap.site.url, d.cacheHours as number, signal) : Promise.resolve({ images: [], logos: [] }),
    ]);
    if (signal.aborted) return;
    if (so.status === 'fulfilled') social = so.value; else socialError = so.reason instanceof Error ? so.reason.message : String(so.reason);
    if (re.status === 'fulfilled') {
      const known = new Set((cap.site.images ?? []).map(i => i.url));
      rendered = re.value.images.filter(i => !known.has(i.url));
      renderedLogos = (await Promise.all(re.value.logos.map(u => logoFromUrl(u, 'Logo in the rendered page')))).filter((x): x is LogoCandidate => !!x);
      if (renderedLogos.length && !logosTouched) { pickedLogos.clear(); defaultLogos(); }
    }
    socialLoading = false;
    if (signal.aborted) return;
    if (!picksTouched) defaultPicks();
    render();
  }
  /** The brand's own imagery first: its three most engaged Instagram posts, its channel's middle
      frames, then its site's photography; videos found by search (other people's uploads) come after
      the site's images. Up to the board's seven cells. Sample posts are never picked by default. */
  function defaultPicks() {
    const vids = social?.youtube?.videos ?? [], site = siteImages();
    const official = social?.youtube?.source === 'channel';
    const top = ig && !ig.mock ? [...ig.posts].sort((a, b) => b.score - a.score).slice(0, 3).map(p => `ig:${p.id}`) : [];
    const out: string[] = [...top];
    const add = (k: string, upTo = 7) => { if (out.length < upTo && !out.includes(k)) out.push(k); };
    if (!official) site.forEach((_, i) => add(`site:${i}`, top.length + (top.length ? 2 : 4)));
    vids.forEach(v => add(`yt:${v.id}:0`, official ? top.length + (top.length ? 2 : 4) : 7));
    site.forEach((_, i) => add(`site:${i}`));
    vids.forEach(v => add(`yt:${v.id}:1`));
    picks = out;
  }
  const siteImages = (): SiteImage[] => [...(cap?.site.images ?? []), ...rendered];
  const stillSrc = (st: { url: string; fallback: string[] }) => `/api/img?url=${encodeURIComponent(st.url)}${st.fallback.map(f => `&fallback=${encodeURIComponent(f)}`).join('')}`;
  const siteSrc = (url: string) => `/api/fetch?url=${encodeURIComponent(url)}`;
  const togglePick = (k: string) => { picksTouched = true; picks = picks.includes(k) ? picks.filter(x => x !== k) : [...picks, k]; render(); };

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
  // Rendered logos arrive last, so they go last: indices of logos already picked stay put.
  const allLogos = (): LogoCandidate[] => [...(cap?.brandfetch?.logos ?? []), ...(cap?.site.logos ?? []), ...renderedLogos];
  function defaultLogos() {
    allLogos().map((l, i) => ({ l, i })).sort((a, b) => logoRank(a.l) - logoRank(b.l)).slice(0, 3).forEach(({ i }) => pickedLogos.add(i));
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
    statusbar.set({ name: cap ? cap.domain : query ? `"${query}"` : 'Audit', state: capturing ? 'capturing' : capError ? 'error' : cap ? `${[...shots.values()].filter(x => x.status === 'loading').length ? 'loading captures · ' : ''}${s!.colorStats.unique} colors · ${s!.typefaces.length} typefaces` : 'Brand Audit' });
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
    if (cap.company) head.append(el('p', 'ab__meta', cap.company.wikidata
      ? `Resolved "${cap.query}" to ${cap.company.name}${cap.company.description ? `, ${cap.company.description}` : ''} via Wikidata.`
      : `Wikidata lists no website for "${cap.query}"; found ${new URL(cap.company.website).hostname}, whose title names it.`));

    // Brand kit strip
    const kit = el('div', 'ab__kit');
    const kitLogoWrap = el('div', 'ab__kit-logo');
    const logos = allLogos().sort((a, b) => logoRank(a) - logoRank(b));
    if (logos.length) {
      const logo = logos[currentLogoIdx % logos.length];
      const logoImg = document.createElement('img');
      logoImg.className = 'ab__kit-logo-img';
      logoImg.src = logo.dataUri ?? logo.url;
      logoImg.alt = 'Brand logo';
      logoImg.title = `Click to switch (${(currentLogoIdx % logos.length) + 1}/${logos.length})`;
      logoImg.style.cursor = 'pointer';
      logoImg.addEventListener('click', () => {
        currentLogoIdx = (currentLogoIdx + 1) % logos.length;
        render();
      });
      kitLogoWrap.appendChild(logoImg);
    } else {
      kitLogoWrap.textContent = 'No logo found';
      kitLogoWrap.style.color = 'var(--text-3)';
    }
    brandPalette = buildPalette(
      cap.site.colors.map(c => c.hex),
      cap.brandfetch?.colors?.map(c => c.hex) ?? []
    );
    const kitPalette = el('div', 'ab__kit-palette');
    for (const hex of brandPalette) {
      const stripe = el('div', 'ab__kit-stripe');
      stripe.style.background = hex;
      kitPalette.appendChild(stripe);
    }
    kit.append(kitLogoWrap, kitPalette);

    renderContentGrid();
    report.replaceChildren(head, kit, filterChipsEl.el, contentGrid);
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
    if (!s.colors.length) grid.append(note('No colors found in the CSS.'));
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
    if (!s.typefaces.length) list.append(note('No typefaces declared in the CSS.'));
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
      b.addEventListener('click', () => { logosTouched = true; pickedLogos.has(i) ? pickedLogos.delete(i) : pickedLogos.add(i); render(); });
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
  function imagerySection() {
    const sec = block('Imagery', `${picks.length} for the board · the order you pick is the order they fill`);
    const badge = (k: string) => { const n = picks.indexOf(k); return n < 0 ? null : el('span', 'ab-pick__n', String(n + 1)); };
    const tile = (k: string, src: string, alt: string) => {
      const b = el('button', `ab-pick${picks.includes(k) ? ' is-picked' : ''}`) as HTMLButtonElement; b.type = 'button'; b.dataset.key = k;
      b.setAttribute('aria-pressed', String(picks.includes(k)));
      const img = document.createElement('img'); img.loading = 'lazy'; img.src = src; img.alt = alt;
      img.addEventListener('error', () => b.classList.add('is-broken'), { once: true });
      b.append(img); const n = badge(k); if (n) b.append(n);
      b.addEventListener('click', () => togglePick(k));
      return b;
    };
    sec.append(...instagramBlock());
    // YouTube
    const yt = social?.youtube;
    const ytHead = socialLoading ? 'Looking for YouTube\u2026' : socialError ? `YouTube: ${socialError}`
      : !yt ? (social?.notes?.join('; ') || 'No YouTube videos found.')
        : yt.source === 'channel' ? `YouTube · ${yt.channel?.title} (the brand's channel)` : `YouTube · videos that name "${yt.query}" (no official channel found; check each)`;
    const ytH = el('h4', 'ab__sub', ytHead);
    if (yt?.channel) { const a = el('a', 'ab-pick__link', 'Open channel') as HTMLAnchorElement; a.href = yt.channel.url; a.target = '_blank'; a.rel = 'noopener'; ytH.append(' · ', a); }
    sec.append(ytH);
    if (yt) {
      const vids = el('div', 'ab-vids');
      for (const v of yt.videos) {
        const card = el('div', 'ab-vid');
        const row = el('div', 'ab-vid__stills');
        v.stills.forEach((st, i) => row.append(tile(`yt:${v.id}:${i}`, stillSrc(st), `${v.title}: ${st.label}`)));
        const meta = el('div', 'ab-vid__meta');
        const a = el('a', 'ab-vid__title', v.title) as HTMLAnchorElement; a.href = v.url; a.target = '_blank'; a.rel = 'noopener';
        meta.append(a, el('span', 'ab-vid__by', [v.channel ?? yt.channel?.title, v.duration].filter(Boolean).join(' · ')));
        card.append(row, meta); vids.append(card);
      }
      sec.append(vids);
    }
    // The site's photography
    const imgs = siteImages();
    sec.append(el('h4', 'ab__sub', imgs.length ? `From ${cap!.domain}` : `No large photography found on ${cap!.domain}'s homepage.`));
    if (imgs.length) {
      const g = el('div', 'ab-picks');
      imgs.forEach((im, i) => g.append(tile(`site:${i}`, siteSrc(im.url), im.alt ?? `Image from ${cap!.domain}`)));
      sec.append(g);
    }
    // Profiles Lathe can link but not read
    const links = Object.entries({ ...cap!.site.social, ...cap!.brandfetch?.social }).filter(([k]) => k !== 'youtube' && k !== 'instagram');
    if (links.length) {
      const p = el('p', 'ab-social');
      p.append(`Also on ${links.map(([k]) => k[0].toUpperCase() + k.slice(1)).join(', ')}: `);
      links.forEach(([k, u], i) => { const a = el('a', '', k) as HTMLAnchorElement; a.href = u; a.target = '_blank'; a.rel = 'noopener'; p.append(a, i < links.length - 1 ? ', ' : '.'); });
      p.append(' These need a signed-in session to read, so Lathe links them rather than collecting from them.');
      sec.append(p);
    }
    return sec;
  }
  /** The brand's Instagram posts as board picks: videos play muted on a loop while on screen, a
      carousel shows its cover and slide count, and the post itself opens on Instagram. */
  function instagramBlock(): HTMLElement[] {
    const n = (x: number | null) => x == null ? null : x.toLocaleString('en-US');
    const from = igFrom === 'typed' ? 'typed for this site' : igFrom ? `linked by ${igFrom === 'site' ? cap!.domain : 'Brandfetch'}` : '';
    const head = el('h4', 'ab__sub', igLoading ? `Instagram · loading @${igName}…`
      : !igName ? 'Instagram · neither Brandfetch nor the site links an account; type the handle in the inspector.'
        : igError ? `Instagram · @${igName}: ${igError}`
          : !ig ? `Instagram · @${igName}`
            : ig.mock ? 'Instagram \u00b7 sample posts, not from Instagram: INSTAGRAM_ACCESS_TOKEN is not set on the server.'
              : [`Instagram · @${ig.username} (${from})`, ig.profile.followers != null ? `${n(ig.profile.followers)} followers` : '', ig.profile.mediaCount != null ? `${n(ig.profile.mediaCount)} posts` : ''].filter(Boolean).join(' · '));
    if (ig && !ig.mock) { const a = el('a', 'ab-pick__link', 'Open profile') as HTMLAnchorElement; a.href = `https://www.instagram.com/${ig.username}/`; a.target = '_blank'; a.rel = 'noopener'; head.append(' · ', a); }
    if (!ig?.posts.length) return [head];
    const grid = el('div', 'ab-picks');
    for (const p of ig.posts) {
      const k = `ig:${p.id}`;
      let node = igNodes.get(k);
      if (!node) { node = igCard(p, n); igNodes.set(k, node); igViews.observe(node.card); }
      const at = picks.indexOf(k);
      node.card.querySelector('.ab-pick')!.classList.toggle('is-picked', at >= 0);
      node.pick.textContent = at >= 0 ? String(at + 1) : '+';
      node.pick.classList.toggle('ab-pick__n--off', at < 0);
      node.pick.setAttribute('aria-pressed', String(at >= 0));
      grid.append(node.card);
    }
    return [head, grid];
  }
  function igCard(p: IgPost, n: (x: number | null) => string | null) {
    const card = el('div', 'ab-vid ab-ig'); card.dataset.key = `ig:${p.id}`;
    const box = el('div', 'ab-pick');
    const link = el('a', 'ab-pick__open') as HTMLAnchorElement;
    link.href = p.permalink; link.target = '_blank'; link.rel = 'noopener';
    link.title = p.caption ?? 'Open on Instagram';
    const cover = p.type === 'carousel' ? p.slides[0] : { type: p.type, src: p.src, poster: p.poster };
    const broken = () => box.classList.add('is-broken');
    if (cover.type === 'video') {
      const v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.preload = 'none';
      v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
      v.dataset.src = igSrc(cover.src);
      if (cover.poster) v.poster = igSrc(cover.poster);
      v.addEventListener('error', broken, { once: true });
      link.append(v);
    } else {
      const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.src = igSrc(cover.src); img.alt = p.caption?.slice(0, 120) ?? 'Instagram post';
      img.addEventListener('error', broken, { once: true });
      link.append(img);
    }
    const pick = el('button', 'ab-pick__n') as HTMLButtonElement; pick.type = 'button';
    pick.setAttribute('aria-label', 'Use on the board');
    pick.addEventListener('click', () => togglePick(`ig:${p.id}`));
    box.append(link, pick);
    if (p.type === 'carousel') box.append(el('span', 'ab-pick__count', `1/${p.slides.length}`));
    const meta = el('div', 'ab-vid__meta');
    const cap2 = el('a', 'ab-vid__title', p.caption?.split('\n')[0] || 'Untitled post') as HTMLAnchorElement; cap2.href = p.permalink; cap2.target = '_blank'; cap2.rel = 'noopener';
    const kind = p.type === 'carousel' ? 'Carousel' : p.mediaType === 'VIDEO' ? (p.type === 'video' ? 'Video' : 'Video (still)') : 'Image';
    meta.append(cap2, el('span', 'ab-vid__by', [p.likes != null ? `${n(p.likes)} likes` : 'likes hidden', p.comments != null ? `${n(p.comments)} comments` : '', p.timestamp.slice(0, 10), kind].filter(Boolean).join(' · ')));
    card.append(box, meta);
    return { card, pick };
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
    if (!features?.observations) { sec.append(note('Generated observations require an API key on the server.')); return sec; }
    if (obsState === 'loading') { sec.append(note('Writing observations from the captures…')); return sec; }
    if (obsState === 'error') sec.append(note(obsError ?? 'Failed'));
    if (!obs) { sec.append(note('"Write observations" analyzes the captures and extracted data for a short audit. Every observation must cite a capture.')); return sec; }
    sec.append(el('p', 'ab-obs__label', `Generated by ${obs.model} on ${new Date(obs.generatedAt).toLocaleString()}. Check each against the captures it cites.`));
    if (obs.summary) sec.append(el('p', 'ab-obs__sum', obs.summary));
    const list = el('ol', 'ab-obs');
    for (const o of obs.observations) {
      const li = el('li', 'ab-obs__item');
      li.append(el('span', 'ab-obs__area', o.area), el('p', 'ab-obs__text', o.text));
      const ev = el('div', 'ab-obs__ev');
      for (const k of o.evidence) ev.append(el('span', 'ab-obs__chip', shots.get(k as ShotKey)?.label ?? igLabels.get(k) ?? (k === 'instagram' ? 'Instagram data' : k)));
      li.append(ev); list.append(li);
    }
    sec.append(list);
    return sec;
  }

  /* ---------------- observations ---------------- */
  const igLabels = new Map<string, string>();
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
      const captures: { id: string; label: string; dataUrl: string }[] = await Promise.all(done.map(async ([id, s]) => ({ id: id as string, label: s.label, dataUrl: await downscale(s.blob!, d.observationImagePx as number) })));
      const site = cap.site;
      const facts = {
        title: site.title, description: site.description, themeColor: site.themeColor, readFrom: site.via,
        cssColors: site.colors.map(c => ({ hex: c.hex, share: Math.round(c.share * 1000) / 1000, vars: c.vars })),
        desktopPixelColors: shots.get('desktop')?.swatches?.map(x => ({ hex: x.hex, share: Math.round(x.share * 1000) / 1000 })) ?? [],
        typefaces: site.typefaces.map(t => ({ family: t.family, source: t.source, weights: t.weights, stacksLed: t.uses })),
        brandfetch: cap.brandfetch ? { colors: cap.brandfetch.colors, fonts: cap.brandfetch.fonts } : null,
        timelineYears: timeline?.snapshots.map(s => s.year) ?? [],
        instagram: ig && !ig.mock ? {
          handle: ig.username, followers: ig.profile.followers, posts: ig.profile.mediaCount, biography: ig.profile.biography,
          latest: ig.posts.map(p => ({ id: p.id, type: p.type, instagramType: p.mediaType, date: p.timestamp.slice(0, 10), likes: p.likes, comments: p.comments, score: p.score, caption: p.caption?.slice(0, 200) ?? null })),
        } : null,
      };
      // The three most engaged posts go in as captures too, so observations about them can cite them.
      if (ig && !ig.mock) {
        const top = [...ig.posts].sort((a, b) => b.score - a.score).slice(0, 3);
        for (const [i, p] of top.entries()) {
          const still = p.type === 'video' ? p.poster : p.type === 'carousel' ? (p.slides[0].poster ?? p.slides[0].src) : p.src;
          const r = still ? await fetch(igSrc(still)).catch(() => null) : null;
          if (r?.ok) captures.push({ id: `ig${i + 1}`, label: `Instagram @${ig.username}, ${p.mediaType.toLowerCase().replace('_album', '')} of ${p.timestamp.slice(0, 10)} (${p.likes ?? 'hidden'} likes, ${p.comments ?? 0} comments)`, dataUrl: await downscale(await r.blob(), d.observationImagePx as number) });
        }
      }
      igLabels.clear(); for (const c of captures) if (c.id.startsWith('ig')) igLabels.set(c.id, c.label);
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
      asset = await assets.add(st.blob, { name, source: 'fetch', origin: 'brand-audit' });
      map[id] = asset.id; settings.set('brandAssets', map);
    }
    return { src: `asset:${asset.id}`, aspect: st.w && st.h ? st.w / st.h : 1.6, credit: { title: st.credit!.title, creator: null, date: st.credit!.date, source: st.credit!.source, license: st.credit!.license, url: st.credit!.url } };
  }
  /** A picked still or site image as a tray file (fetched once per audit) with its credit. */
  async function boardImage(k: string): Promise<DeckImage | null> {
    if (!cap) return null;
    let url: string, credit: DeckImage['credit'];
    if (k.startsWith('ig:')) {
      const p = ig?.posts.find(x => x.id === k.slice(3));
      if (!p || !ig) return null;
      const still = p.type === 'carousel' ? (p.slides[0].type === 'video' ? p.slides[0].poster : p.slides[0].src) : p.type === 'video' ? p.poster : p.src;
      if (!still) return null;
      url = igSrc(still);
      credit = { title: p.caption?.split('\n')[0].slice(0, 90) || `Instagram post by @${ig.username}`, creator: `@${ig.username}`, date: p.timestamp.slice(0, 10) || null,
        source: ig.mock ? 'Sample post (not from Instagram)' : 'Instagram', license: 'Post © its owner; shown for research', url: p.permalink };
    } else if (k.startsWith('yt:')) {
      const [, id, idx] = k.split(':');
      const v = social?.youtube?.videos.find(x => x.id === id); const st = v?.stills[Number(idx)];
      if (!v || !st) return null;
      url = stillSrc(st);
      credit = { title: v.title, creator: v.channel ?? social?.youtube?.channel?.title ?? null, date: null, source: `YouTube (${st.label.toLowerCase()})`, license: 'Video still © its owner; shown for research', url: v.url };
    } else {
      const im = siteImages()[Number(k.slice(5))];
      if (!im) return null;
      url = siteSrc(im.url);
      credit = { title: im.alt || `Image from ${cap.domain}`, creator: null, date: null, source: cap.domain, license: 'Site © its owner; shown for research', url: cap.site.url };
    }
    try {
      const map = settings.get<Record<string, string>>('brandAssets', {});
      let asset = map[url] ? assets.get(map[url]) : undefined;
      if (!asset) {
        const r = await fetch(url); if (!r.ok) return null;
        const blob = await trimBars(await r.blob());
        asset = await assets.add(blob, { name: `${cap.domain.replace(/[^a-z0-9.-]/gi, '-')}-${k.replace(/[^\w]+/g, '-')}.${blob.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg'}`, source: 'fetch', origin: 'brand-audit' });
        map[url] = asset.id; settings.set('brandAssets', map);
      }
      return { src: `asset:${asset.id}`, aspect: asset.width && asset.height ? asset.width / asset.height : 16 / 9, credit };
    } catch { return null; }
  }
  /** Crops letterbox and pillarbox bars (near-black, flat rows or columns at the edges), which ads
      and old video frames often carry. Returns the blob unchanged when there are none. */
  async function trimBars(blob: Blob): Promise<Blob> {
    try {
      const bmp = await createImageBitmap(blob);
      const W = bmp.width, H = bmp.height, c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true })!;
      x.drawImage(bmp, 0, 0); bmp.close();
      const d = x.getImageData(0, 0, W, H).data;
      const flatDark = (i0: number, n: number, step: number) => {
        let sum = 0, max = 0;
        for (let k = 0; k < n; k++) { const i = (i0 + k * step) * 4; const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; sum += l; if (l > max) max = l; }
        return sum / n < 14 && max < 40;
      };
      let top = 0, bottom = H - 1, left = 0, right = W - 1;
      while (top < H / 3 && flatDark(top * W, W, 1)) top++;
      while (bottom > H * 2 / 3 && flatDark(bottom * W, W, 1)) bottom--;
      while (left < W / 3 && flatDark(left, H, W)) left++;
      while (right > W * 2 / 3 && flatDark(right, H, W)) right--;
      const w = right - left + 1, h = bottom - top + 1;
      if (w > W * 0.96 && h > H * 0.96) return blob;
      const out = new OffscreenCanvas(w, h); out.getContext('2d')!.drawImage(c, left, top, w, h, 0, 0, w, h);
      return await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    } catch { return blob; }
  }
  /** The logo's colors by share of its opaque pixels (k-means in OKLab), largest first. */
  async function logoColors(l: LogoCandidate): Promise<string[]> {
    try {
      const img = new Image(); img.src = l.dataUri; await img.decode();
      const c = new OffscreenCanvas(96, 96); const x = c.getContext('2d')!; x.drawImage(img, 0, 0, 96, 96);
      const px = x.getImageData(0, 0, 96, 96).data; const pts: Lab[] = [];
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 200) pts.push(rgbToOklab(px[i], px[i + 1], px[i + 2]));
      return kmeans(pts, 5, 16).filter(s => s.share >= 0.05).map(s => s.hex);
    } catch { return []; }
  }
  /** White behind a dark mark; a light mark keeps the deck's tile tone (null), by its average luminance. */
  async function logoFill(l: LogoCandidate): Promise<string | null> {
    const light = '#FFFFFF', dark = null; // tokens-allow: content color for the board's logo tile
    try {
      const img = new Image(); img.src = l.dataUri; await img.decode();
      const c = new OffscreenCanvas(64, 64); const x = c.getContext('2d')!; x.drawImage(img, 0, 0, 64, 64);
      const px = x.getImageData(0, 0, 64, 64).data; let sum = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255; n++; }
      return n && sum / n > 0.6 ? dark : light;
    } catch { return light; }
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
    const board = (await Promise.all(picks.map(k => boardImage(k)))).filter((x): x is DeckImage => !!x);
    const logo = allLogos().filter((_, i) => pickedLogos.has(i)).sort((a, b) => logoRank(a) - logoRank(b))[0] ?? null;
    const deck = buildBrandDeck({
      cap, name: brandName(cap),
      desktop: desk ? await trayImage('desktop', desk) : null,
      mobile: mob ? await trayImage('mobile', mob) : null,
      og: ogImg, timeline: timelineImgs,
      logos: allLogos().filter((_, i) => pickedLogos.has(i)),
      pixelPalette: desk?.swatches ?? [], declaredShare: declaredShare(desk?.swatches),
      observations: obs, theme: d.deckTheme as 'dark' | 'light',
      imagesPerSlide: d.imagesPerSlide as number, paletteSize: d.aggregateSize as number,
      board, boardLogo: logo ? { logo, fill: await logoFill(logo) } : null, logoColors: logo ? await logoColors(logo) : [],
    });
    const a = await assets.add(new Blob([JSON.stringify(deck)], { type: DECK_MIME }), { name: `${cap.domain.replace(/[^a-z0-9.-]/gi, '-')}-brand.deck.json`, source: 'tool', origin: 'brand-audit' });
    emit('send', a, 'deck');
  }

  /* ---------------- boot ---------------- */
  // Restore saved selections and brand kit
  const savedSel = settings.get<[string, number][]>('selections', []);
  for (const [k, v] of savedSel) selected.set(k, v);
  const savedKit = settings.get<{ logoIdx: number; palette: string[] } | null>('brandKit', null);
  if (savedKit) { currentLogoIdx = savedKit.logoIdx; brandPalette = savedKit.palette; }

  render();
  // Phase B: section renderers kept for the editing stage inspector
  const sections = { shotsSection, paletteSection, typeSection, logoSection, imagerySection, timelineSection, obsSection, observe };
  void sections;

  void fetchCatalog().then(c => { features = c.brand; render(); if (query) void run(query); });

  return {
    unmount() { controller?.abort(); igViews.disconnect(); contentVideoObserver.disconnect(); palettes.destroy(); cancelAnimationFrame(raf); urls.forEach(u => URL.revokeObjectURL(u)); offActivate(); },
    export: () => void buildDeckNow(),
  };
}
