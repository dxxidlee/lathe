/* Subject Audit: query open archives in parallel, stream results in, save images to boards. */
import type { MountContext, MountResult } from '../types';
import { PaletteQueue, listSources, proxied, scoreRelevance, searchSource, type AuditResult, type SourceInfo } from './api';
import { aggregatePalette, hexToOklab, paletteDistance, type Swatch } from '../../lib/color';
import { loadBoards, createBoard, saveBoard, renameBoard, deleteBoard, toggleSharing, migrateCollections, type Board } from '../../lib/boards';
import { button, chips, field, note, section, select, slider, statList } from '../../ui/primitives';
import './audit.css';

type Item = AuditResult & { swatches?: Swatch[]; order: number };
type Orientation = 'any' | 'landscape' | 'portrait' | 'square';
interface SourceState { status: 'idle' | 'loading' | 'done' | 'error'; count: number; total: number; ms: number; page: number; error?: string; cached?: boolean }

const orientationOf = (r: { width: number | null; height: number | null }): Orientation | null => {
  if (!r.width || !r.height) return null;
  const a = r.width / r.height;
  return a > 1.1 ? 'landscape' : a < 0.9 ? 'portrait' : 'square';
};
const TYPE_SYNONYMS: Record<string, string> = {
  photographs: 'photograph', photos: 'photograph', photo: 'photograph',
  prints: 'print', paintings: 'painting', drawings: 'drawing', sculptures: 'sculpture',
  images: 'image', videos: 'video', textiles: 'textile', posters: 'poster',
};
const normalizeType = (t: string): string => { const lower = t.toLowerCase().trim(); return TYPE_SYNONYMS[lower] ?? lower; };
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const shortType = (t: string | null) => {
  if (!t) return null;
  const raw = t.split(/[;,/]/)[0].trim().toLowerCase().replace(/^image\//, '');
  return normalizeType(raw);
};

export function mountSubject({ defaults: d, stage, inspector, statusbar, settings, emit }: MountContext, modeEl?: HTMLElement): MountResult {
  let sources: SourceInfo[] = [];
  const disabled = new Set(settings.get<string[]>('disabledSources', []));
  const state = new Map<string, SourceState>();
  let items: Item[] = [];
  let query = settings.get('query', '');
  let controller: AbortController | null = null;
  const filters = {
    types: new Set<string>(settings.get<string[]>('types', [])),
    yearFrom: settings.get<number | null>('yearFrom', null), yearTo: settings.get<number | null>('yearTo', null),
    pd: settings.get<boolean>('publicDomainOnly', d.publicDomainOnly as boolean),
    orientation: settings.get<Orientation>('orientation', 'any'),
    hex: settings.get<string>('colorHex', ''),
    mode: settings.get<'sort' | 'filter'>('colorMode', d.colorMode as 'sort' | 'filter'),
    threshold: settings.get<number>('colorThreshold', d.colorThreshold as number),
  };
  let boards: Board[] = [];
  let activeBoard = '';
  let tab: 'results' | 'board' = 'results';
  const palettes = new PaletteQueue({
    k: d.paletteSize as number, sample: d.paletteSample as number, iterations: d.paletteIterations as number,
    minShare: d.minSwatchShare as number, minSwatches: d.minSwatches as number, cacheHours: d.cacheHours as number,
  });
  const board = (): Board => boards.find(b => b.id === activeBoard) ?? boards[0] ?? { id: '', name: '', query: '', visibility: 'private' as const, shareSlug: null, items: [], createdAt: 0, updatedAt: 0 };
  const inBoard = (id: string) => board().items.some(i => i.sourceId === id);
  let detailItem: Item | null = null;
  let savedScrollTop = 0;

  let expanded: { main: string; alternates: string[]; exclude: string[]; interpreted: string } | null = null;
  async function expandQuery(text: string): Promise<typeof expanded> {
    try {
      const r = await fetch(`/api/expand?q=${encodeURIComponent(text)}`);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  /* ---------------- stage ---------------- */
  const root = document.createElement('div'); root.className = 'au';
  const bar = document.createElement('form'); bar.className = 'au__bar'; bar.setAttribute('role', 'search');
  const q = document.createElement('input');
  Object.assign(q, { className: 'au__q', type: 'search', placeholder: 'Search \u201Cbotanical prints\u201D, \u201Csubway signage\u201D, \u201Cfilm stills\u201D\u2026', value: query });
  q.setAttribute('aria-label', 'Subject');
  const go = document.createElement('button'); go.type = 'submit'; go.className = 'l-btn l-btn--primary au__go'; go.textContent = 'Audit';
  bar.append(q, go);
  const tabs = document.createElement('div'); tabs.className = 'au__tabs'; tabs.setAttribute('role', 'tablist');
  const tabBtn = (id: typeof tab) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'au__tab'; b.setAttribute('role', 'tab'); b.dataset.tab = id; b.addEventListener('click', () => { tab = id; closeDetail(); renderGrid(); }); return b; };
  const tResults = tabBtn('results'), tBoard = tabBtn('board');
  tabs.append(tResults, tBoard);
  const grid = document.createElement('div'); grid.className = 'au__grid';
  const empty = document.createElement('div'); empty.className = 'au__empty';
  const more = document.createElement('button'); more.type = 'button'; more.className = 'l-btn au__more'; more.textContent = 'Load more';
  more.addEventListener('click', () => void loadMore());
  const loadObserver = new IntersectionObserver(entries => {
    if (entries[0]?.isIntersecting && !more.hidden) void loadMore();
  }, { rootMargin: '200px' });
  loadObserver.observe(more);
  const scroller = document.createElement('div'); scroller.className = 'au__scroll';
  scroller.append(grid, empty, more);
  root.append(bar, tabs, scroller);
  stage.appendChild(root);
  bar.addEventListener('submit', e => { e.preventDefault(); void search(q.value); });

  /* ---------------- inspector ---------------- */
  const srcSec = section('Sources');
  const srcList = document.createElement('div'); srcList.className = 'au-src';
  const srcNote = note('');
  srcSec.body.append(srcList, srcNote);

  const filtSec = section('Filters');
  const typeHost = document.createElement('div');
  const yearRow = document.createElement('div'); yearRow.className = 'au-years';
  const yf = field({ label: 'From year', type: 'number', value: filters.yearFrom == null ? '' : String(filters.yearFrom), onChange: v => { filters.yearFrom = v.trim() ? Number(v) : null; settings.set('yearFrom', filters.yearFrom); renderGrid(); } });
  const yt = field({ label: 'To year', type: 'number', value: filters.yearTo == null ? '' : String(filters.yearTo), onChange: v => { filters.yearTo = v.trim() ? Number(v) : null; settings.set('yearTo', filters.yearTo); renderGrid(); } });
  yearRow.append(yf.el, yt.el);
  filtSec.body.append(
    typeHost, yearRow,
    chips<'all' | 'pd'>({ label: 'Rights', value: filters.pd ? 'pd' : 'all', options: [{ value: 'all', label: 'All' }, { value: 'pd', label: 'Public domain only' }], onChange: v => { filters.pd = v === 'pd'; settings.set('publicDomainOnly', filters.pd); renderGrid(); } }).el,
    chips<Orientation>({ label: 'Orientation', value: filters.orientation, options: [{ value: 'any', label: 'Any' }, { value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }, { value: 'square', label: 'Square' }], onChange: v => { filters.orientation = v as Orientation; settings.set('orientation', v); renderGrid(); } }).el,
  );

  const colSec = section('Color');
  const hexRow = document.createElement('div'); hexRow.className = 'l-row';
  const picker = document.createElement('input'); picker.type = 'color'; picker.className = 'l-swatch-input'; picker.setAttribute('aria-label', 'Pick a color');
  const hexIn = document.createElement('input'); hexIn.className = 'l-input au-hex'; hexIn.placeholder = 'Hex, e.g. E8FF1A'; hexIn.value = filters.hex; hexIn.setAttribute('aria-label', 'Hex color');
  const setHex = (v: string) => {
    const h = v.trim() ? ('#' + v.trim().replace(/^#/, '')).toUpperCase() : '';
    if (h && !hexToOklab(h)) { emit('toast', 'Type a six-digit hex color'); return; }
    filters.hex = h; hexIn.value = h; if (h) picker.value = h.length === 7 ? h : picker.value;
    settings.set('colorHex', h);
    // Compute palettes lazily when color search is activated
    if (h) {
      const sig = controller?.signal ?? new AbortController().signal;
      for (const it of items) { if (!it.swatches) void paletteFor(it, sig); }
    }
    renderGrid();
  };
  hexIn.addEventListener('change', () => setHex(hexIn.value));
  picker.addEventListener('input', () => setHex(picker.value));
  if (filters.hex.length === 7) picker.value = filters.hex;
  hexRow.append(picker, hexIn, button({ label: 'Clear', onClick: () => setHex('') }));
  colSec.body.append(
    hexRow,
    chips<'sort' | 'filter'>({ label: 'Use it to', value: filters.mode, options: [{ value: 'sort', label: 'Sort by closeness' }, { value: 'filter', label: 'Filter' }], onChange: v => { filters.mode = v as 'sort' | 'filter'; settings.set('colorMode', v); renderGrid(); } }).el,
    note('Distance threshold is in Advanced below. Measured in OKLab to the closest swatch of each image.'),
  );

  const boardSec = section('Board');
  const boardPick = select<string>({ label: 'Board', value: activeBoard, options: boards.map(b => ({ value: b.id, label: `${b.name} (${b.items.length})` })),
    onChange: v => { activeBoard = v; if (tab === 'board') renderGrid(); renderBoardUI(); } });
  const boardName = field({ label: 'Name', value: board().name, onChange: v => { void renameBoard(board(), v); renderBoardUI(); } });
  const boardStats = statList();
  const aggHost = document.createElement('div'); aggHost.className = 'au-agg';
  const shareBtn = button({ label: board().visibility === 'unlisted' ? 'Copy link' : 'Share', onClick: async () => {
    const b = board();
    if (b.visibility === 'private') {
      await toggleSharing(b);
      shareBtn.textContent = 'Copy link';
    }
    if (b.shareSlug) {
      await navigator.clipboard.writeText(`${window.location.origin}/b/${b.shareSlug}`);
      emit('toast', 'Link copied');
    }
  }});
  const boardActions = document.createElement('div'); boardActions.className = 'l-row';
  boardActions.append(
    button({ label: 'New', onClick: async () => { const b = await createBoard(`Board ${boards.length + 1}`, query); boards.push(b); activeBoard = b.id; renderBoardUI(); renderGrid(); } }),
    button({ label: 'Clear', onClick: () => { board().items = []; saveBoard(board()); renderBoardUI(); renderGrid(); } }),
    shareBtn,
    button({ label: 'Delete', onClick: async () => {
      if (!window.confirm(`Delete "${board().name}"?`)) return;
      await deleteBoard(board().id);
      boards = boards.filter(b => b.id !== activeBoard);
      if (!boards.length) boards = [await createBoard('Board 1')];
      activeBoard = boards[0].id;
      renderBoardUI(); renderGrid();
      emit('toast', 'Board deleted');
    }}),
  );
  boardSec.body.append(boardPick.el, boardName.el, boardStats.el, aggHost, boardActions);
  const sumSec = section('Results');
  const sumStats = statList();
  sumSec.body.append(sumStats.el);

  const advSec = section('Advanced');
  advSec.el.classList.add('l-section--advanced');
  advSec.el.querySelector('.l-section__title')!.addEventListener('click', () => advSec.el.classList.toggle('is-open'));
  advSec.body.append(
    slider({ label: 'Swatches per image', min: 5, max: 8, value: d.paletteSize as number, onChange: v => { (d as Record<string, unknown>).paletteSize = v; } }).el,
    slider({ label: 'Board palette size', min: 3, max: 16, value: d.aggregateSize as number, onChange: v => { (d as Record<string, unknown>).aggregateSize = v; renderBoardUI(); } }).el,
    slider({ label: 'Color match distance', min: 1, max: 50, value: Math.round((d.colorThreshold as number) * 100), unit: ' (ΔE×100)', onChange: v => { filters.threshold = v / 100; settings.set('colorThreshold', filters.threshold); (d as Record<string, unknown>).colorThreshold = filters.threshold; if (filters.mode === 'filter') renderGrid(); } }).el,
  );

  inspector.append(...[modeEl, boardSec.el, srcSec.el, filtSec.el, colSec.el, sumSec.el, advSec.el].filter(Boolean) as HTMLElement[]);

  /* ---------------- sources ---------------- */
  function renderSources() {
    srcList.replaceChildren(...sources.filter(s => s.available).map(s => {
      const st = state.get(s.id);
      const row = document.createElement('label'); row.className = 'au-src__row';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !disabled.has(s.id);
      cb.addEventListener('change', () => { cb.checked ? disabled.delete(s.id) : disabled.add(s.id); settings.set('disabledSources', [...disabled]); renderGrid(); });
      const name = document.createElement('span'); name.className = 'au-src__name'; name.textContent = s.name;
      const meta = document.createElement('span'); meta.className = 'au-src__meta tabular';
      meta.dataset.state = st?.status ?? 'idle';
      meta.textContent = !st ? '' : st.status === 'loading' ? 'Searching…' : st.status === 'error' ? 'Error' : `${st.count}${st.total > st.count ? ` of ${st.total.toLocaleString()}` : ''}${st.cached ? ' · cached' : ` · ${st.ms} ms`}`;
      if (st?.error) meta.title = st.error;
      row.append(cb, name, meta);
      if (st?.status === 'error') { const err = document.createElement('span'); err.className = 'au-src__err'; err.textContent = st.error ?? 'Failed'; row.append(err); }
      return row;
    }));
    const hidden = sources.filter(s => !s.available).length;
    srcNote.textContent = sources.length
      ? (hidden ? `${hidden} source${hidden > 1 ? 's' : ''} need API keys to appear.` : '')
      : 'Sources are loading\u2026';
  }

  /* ---------------- search ---------------- */
  async function search(text: string) {
    query = text.trim();
    if (!query) return;

    settings.set('query', query);
    controller?.abort(); controller = new AbortController();
    palettes.cancelPending();
    items = []; state.clear(); tab = 'results';
    expanded = await expandQuery(query);

    const searchQuery = expanded ? expanded.main : query;
    const live = sources.filter(s => s.available && !disabled.has(s.id));
    for (const s of live) state.set(s.id, { status: 'loading', count: 0, total: 0, ms: 0, page: 1 });
    renderSources(); renderGrid();
    const queries = [searchQuery];
    if (expanded?.alternates?.length) queries.push(...expanded.alternates);
    await Promise.all(queries.flatMap(sq => live.map(s => fetchPage(s.id, 1, controller!.signal, sq))));
    // Auto-load until 50 results pass relevance + image checks
    let autoLoadAttempts = 0;
    while (visible().filter(it => verified.has(it.id)).length < 50 && autoLoadAttempts < 5) {
      const moreSrcs = [...state.entries()].filter(([, s]) => s.status === 'done' && s.count < s.total && s.page < 20);
      if (!moreSrcs.length) break;
      autoLoadAttempts++;
      await Promise.all(moreSrcs.map(([id, s]) => fetchPage(id, s.page + 1, controller!.signal, searchQuery)));
    }
  }
  async function fetchPage(id: string, page: number, signal: AbortSignal, overrideQuery?: string) {
    const st = state.get(id)!;
    st.status = 'loading'; renderSources();
    try {
      const q = overrideQuery ?? (expanded ? expanded.main : query);
      const r = await searchSource(id, q, page, d.cacheHours as number, signal);
      if (signal.aborted) return;
      if (r.error) { st.status = 'error'; st.error = r.error; }
      else {
        st.status = 'done'; st.total = r.total; st.ms = r.ms; st.page = page; st.cached = r.cached;
        const seenIds = new Set(items.map(i => i.id));
        const seenUrls = new Set(items.map(i => i.thumbUrl));
        const seenTitles = new Set(items.map(i => i.title?.toLowerCase()));
        const fresh = r.results
          .filter(x => x.thumbUrl && !seenIds.has(x.id) && !seenUrls.has(x.thumbUrl) && !(x.title && seenTitles.has(x.title.toLowerCase())))
          .map((x, i) => ({ ...x, order: (page - 1) * 1000 + i * 20 + sources.findIndex(s => s.id === id) }));
        st.count += fresh.length;
        items.push(...fresh);
      }
    } catch (e) {
      if (signal.aborted) return;
      st.status = 'error'; st.error = e instanceof Error ? e.message : String(e);
    }
    renderSources(); renderGrid();
  }
  async function paletteFor(it: Item, signal: AbortSignal) {
    const p = await palettes.get(it.id, it.thumbUrl);
    if (!p || signal.aborted) return;
    it.swatches = p.swatches;
    it.palette = p.swatches.map(s => s.hex);
    if (!it.width && p.width) { it.width = p.width; it.height = p.height ?? null; }
    updateCard(it);
    if (detailItem?.id === it.id) renderDetail();
    if (filters.hex) scheduleGrid();
  }
  async function loadMore() {
    if (!controller) return;
    const sig = controller.signal;
    await Promise.all([...state.entries()].filter(([, s]) => s.status === 'done' && s.count < s.total && s.page < 20).map(([id, s]) => fetchPage(id, s.page + 1, sig)));
  }

  /* ---------------- grid ---------------- */
  const cards = new Map<string, HTMLElement>();
  const sourceName = (id: string) => sources.find(s => s.id === id)?.name ?? id;

  function visible(): Item[] {
    const target = filters.hex ? hexToOklab(filters.hex) : null;
    let list = (tab === 'board' ? board().items.map((bi): Item => ({ ...bi as any, id: bi.sourceId, swatches: bi.palette, order: bi.position })) : items).filter(it => {
      if (!it.thumbUrl) return false;
      if (tab === 'results' && disabled.has(it.source)) return false;
      if (filters.types.size && !filters.types.has(shortType(it.type) ?? '')) return false;
      if (filters.yearFrom != null && (it.year == null || it.year < filters.yearFrom)) return false;
      if (filters.yearTo != null && (it.year == null || it.year > filters.yearTo)) return false;
      if (filters.pd && !it.isPublicDomain) return false;
      if (filters.orientation !== 'any' && orientationOf(it) !== filters.orientation) return false;
      if (target && filters.mode === 'filter' && !(it.swatches && paletteDistance(target, it.swatches) <= filters.threshold)) return false;
      return true;
    });
    if (target && filters.mode === 'sort') {
      list = [...list].sort((a, b) => (a.swatches ? paletteDistance(target, a.swatches) : 9) - (b.swatches ? paletteDistance(target, b.swatches) : 9));
    } else if (tab === 'results') {
      // Score against the ORIGINAL query so alternate-query results
      // are ranked by relevance to what the user actually typed
      const scoreQ = query;
      const expandedQ = expanded ? expanded.main : query;
      const excludeTerms = expanded?.exclude ?? [];
      const scored = list.map(it => {
        const origScore = scoreRelevance(it, scoreQ, excludeTerms);
        const expScore = expandedQ !== scoreQ ? scoreRelevance(it, expandedQ, excludeTerms) : origScore;
        return { ...it, _rel: Math.max(origScore, expScore) };
      });
      const before = scored.length;
      list = scored.filter(it => it._rel > 0).sort((a, b) => b._rel - a._rel);
      const dropped = before - list.length;
      if (dropped > 0) {
        const bySource = new Map<string, number>();
        for (const it of scored) if (it._rel === 0) bySource.set(it.source, (bySource.get(it.source) ?? 0) + 1);
        const perSrc = [...bySource.entries()].map(([s, n]) => {
          const total = scored.filter(x => x.source === s).length;
          const pct = Math.round(n / total * 100);
          const warn = pct > 80 ? ' (nearly all dropped — sparse metadata?)' : '';
          return `${sourceName(s)}: ${n}/${total} (${pct}%)${warn}`;
        }).join(', ');
        console.log(`[audit] relevance: dropped ${dropped}/${before} (threshold >0). Per source: ${perSrc}`);
      }
    }
    return list;
  }

  const verified = new Set<string>();
  const failed = new Set<string>();

  function preloadImage(it: Item) {
    if (verified.has(it.id) || failed.has(it.id)) return;
    const img = new Image();
    let retried = false;
    const fail = () => { failed.add(it.id); scheduleGrid(); };
    const ok = () => { verified.add(it.id); scheduleGrid(); };
    const timeout = setTimeout(() => { if (!retried) { retried = true; img.src = proxied(it.thumbUrl); } else fail(); }, 8000);
    img.onload = () => { clearTimeout(timeout); ok(); };
    img.onerror = () => { if (!retried) { retried = true; img.src = proxied(it.thumbUrl); } else { clearTimeout(timeout); fail(); } };
    img.src = it.thumbUrl;
  }

  function card(it: Item): HTMLElement | null {
    if (tab !== 'board') {
      if (failed.has(it.id)) return null;
      if (!verified.has(it.id)) { preloadImage(it); return null; }
    }
    let el = cards.get(it.id);
    if (!el) {
      el = document.createElement('article');
      el.className = 'au-card au-card--minimal';
      el.dataset.id = it.id;

      const img = document.createElement('img');
      img.className = 'au-card__img';
      img.loading = 'lazy';
      img.alt = it.title;
      img.src = it.thumbUrl;
      img.addEventListener('click', () => openDetail(it));

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'au-card__add';
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(it.id); });

      el.append(img, addBtn);
      cards.set(it.id, el);
    }
    // Update add button state
    const selected = inBoard(it.id);
    el.classList.toggle('is-selected', selected);
    const addBtn = el.querySelector('.au-card__add') as HTMLButtonElement;
    addBtn.textContent = selected ? 'Added' : 'Add';
    return el;
  }
  function updateCard(it: Item, el = cards.get(it.id)) {
    if (!el) return;
    const selected = inBoard(it.id);
    el.classList.toggle('is-selected', selected);
    const btn = el.querySelector<HTMLButtonElement>('.au-card__add');
    if (btn) btn.textContent = selected ? 'Added' : 'Add';
  }
  function toggle(id: string) {
    const b = board();
    const existing = b.items.findIndex(i => i.sourceId === id);
    if (existing >= 0) {
      b.items.splice(existing, 1);
    } else {
      const it = items.find(i => i.id === id);
      if (it) {
        // Compute palette lazily on add
        if (!it.swatches) void paletteFor(it, controller?.signal ?? new AbortController().signal);
        b.items.push({
          id: crypto.randomUUID(),
          sourceId: it.id,
          source: it.source,
          title: it.title,
          creator: it.creator,
          date: it.date,
          year: it.year,
          imageUrl: it.imageUrl,
          thumbUrl: it.thumbUrl,
          width: it.width,
          height: it.height,
          license: it.license,
          isPublicDomain: it.isPublicDomain,
          sourceUrl: it.sourceUrl,
          type: it.type,
          palette: it.swatches,
          position: b.items.length,
        });
      }
    }
    saveBoard(b);
    renderBoardUI();
    // Update card if visible
    const card = cards.get(id);
    if (card) {
      const sel = inBoard(id);
      card.classList.toggle('is-selected', sel);
      const btn = card.querySelector('.au-card__add') as HTMLButtonElement;
      if (btn) btn.textContent = sel ? 'Added' : 'Add';
    }
    if (tab === 'board') renderGrid();
  }

  let gridRaf = 0;
  const scheduleGrid = () => { cancelAnimationFrame(gridRaf); gridRaf = requestAnimationFrame(renderGrid); };
  function renderGrid() {
    if (detailItem) { renderDetail(); return; }
    const list = visible();
    const loading = [...state.values()].some(s => s.status === 'loading');
    // Preload images for items not yet verified
    for (const it of list) if (!verified.has(it.id) && !failed.has(it.id)) preloadImage(it);
    const rendered = list.map(card).filter((el): el is HTMLElement => el !== null);
    // Show skeleton tiles while loading and grid is empty
    if (loading && !rendered.length) {
      const skeletons = Array.from({ length: 12 }, () => {
        const sk = document.createElement('div');
        sk.className = 'au-card au-card--skeleton';
        return sk;
      });
      grid.replaceChildren(...skeletons);
    } else {
      // Stable re-rank: only reorder if the set of ids changed or order differs
      const currentIds = [...grid.children].map(c => (c as HTMLElement).dataset.id);
      const newIds = rendered.map(c => c.dataset.id);
      if (currentIds.join(',') !== newIds.join(',')) {
        grid.replaceChildren(...rendered);
      }
    }
    // Restore scroller structure if detail view replaced it
    if (!scroller.contains(grid)) scroller.replaceChildren(grid, empty, more);
    tResults.textContent = `Results ${rendered.length || ''}`.trim();
    tBoard.textContent = `Board ${board().items.length || ''}`.trim();
    tResults.classList.toggle('is-active', tab === 'results'); tBoard.classList.toggle('is-active', tab === 'board');
    tResults.setAttribute('aria-selected', String(tab === 'results')); tBoard.setAttribute('aria-selected', String(tab === 'board'));
    empty.textContent = list.length ? '' : tab === 'board' ? 'Add results to this board.'
      : !query ? ''
        : loading ? 'Searching…' : items.length ? 'Nothing matches these filters.' : 'No results.';
    empty.hidden = !!list.length;
    more.hidden = tab !== 'results' || ![...state.values()].some(s => s.status === 'done' && s.count < s.total);
    renderTypes();
    const shownCount = rendered.length;
    sumStats.set([['Results', String(items.length)], ['Shown', String(shownCount)], ['Sources', String([...state.values()].filter(s => s.status === 'done').length)]]);
    statusbar.set({ name: query ? `”${query}”` : 'Subject Audit', state: `${items.length} results \u00b7 ${shownCount} shown${loading ? ' \u00b7 searching' : ''}` });
  }
  function renderTypes() {
    const counts = new Map<string, number>();
    for (const it of items) { const t = shortType(it.type); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    for (const t of filters.types) if (!top.some(([k]) => k === t)) top.push([t, 0]);

    const showAll = typeHost.dataset.showAll === 'true';
    const visibleTypes = showAll ? top : top.slice(0, 8);
    const hasMore = top.length > 8;
    const key = visibleTypes.map(([t]) => t).join('|') + '#' + [...filters.types].join('|') + '#' + showAll;
    if (typeHost.dataset.key === key) return;
    typeHost.dataset.key = key;

    const els: HTMLElement[] = [];
    if (visibleTypes.length) {
      els.push(chips<string>({ label: 'Type', multi: true, value: [...filters.types],
        options: visibleTypes.map(([t, n]) => ({ value: t, label: `${titleCase(t)} (${n})` })),
        onChange: v => { filters.types = new Set(v as string[]); settings.set('types', [...filters.types]); renderGrid(); } }).el);
      if (hasMore) {
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'l-btn l-btn--ghost';
        toggle.textContent = showAll ? 'Less' : `More (${top.length - 8})`;
        toggle.addEventListener('click', () => { typeHost.dataset.showAll = String(!showAll); renderTypes(); });
        els.push(toggle);
      }
    } else {
      els.push(note('Types appear after a search.'));
    }
    typeHost.replaceChildren(...els);
  }

  function renderBoardUI() {
    boardPick.setOptions(boards.map(b => ({ value: b.id, label: `${b.name} (${b.items.length})` })), activeBoard);
    boardName.input.value = board().name;
    const b = board();
    const agg = aggregatePalette(b.items.filter(i => i.palette?.length).map(i => i.palette!), d.aggregateSize as number);
    boardStats.set([['Images', String(b.items.length)], ['Sources', String(new Set(b.items.map(i => i.source)).size)], ['Public domain', String(b.items.filter(i => i.isPublicDomain).length)]]);
    aggHost.replaceChildren(...agg.map(s => {
      const sw = document.createElement('div'); sw.className = 'au-agg__sw';
      const chip = document.createElement('span'); chip.className = 'au-agg__chip'; chip.style.background = s.hex;
      const hex = document.createElement('span'); hex.className = 'au-agg__hex'; hex.textContent = s.hex;
      sw.append(chip, hex); return sw;
    }));
    if (!agg.length) aggHost.replaceChildren();
    tBoard.textContent = `Board ${b.items.length || ''}`.trim();
  }

  /* ---------------- detail view ---------------- */
  function openDetail(it: Item) {
    detailItem = it;
    savedScrollTop = scroller.scrollTop;
    if (!it.swatches) void paletteFor(it, controller?.signal ?? new AbortController().signal);
    renderDetail();
  }

  function closeDetail() {
    detailItem = null;
    renderGrid();
    requestAnimationFrame(() => { scroller.scrollTop = savedScrollTop; });
  }

  function renderDetail() {
    if (!detailItem) return;
    const it = detailItem;
    const list = visible();
    const idx = list.findIndex(x => x.id === it.id);

    const detail = document.createElement('div');
    detail.className = 'au-detail';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'au-detail__back';
    back.textContent = '\u2190 All results';
    back.addEventListener('click', closeDetail);

    const img = document.createElement('img');
    img.className = 'au-detail__img';
    img.src = it.imageUrl || it.thumbUrl;
    img.alt = it.title;

    const meta = document.createElement('div');
    meta.className = 'au-detail__meta';
    const pair = (label: string, value: string | null, isLink = false) => {
      if (!value) return;
      const row = document.createElement('div');
      row.className = 'l-stat';
      const l = document.createElement('span');
      l.className = 'l-stat__label';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'l-stat__value';
      if (isLink) {
        const a = document.createElement('a');
        a.href = value;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = 'Open';
        v.appendChild(a);
      } else {
        v.textContent = value;
      }
      row.append(l, v);
      meta.appendChild(row);
    };

    pair('Title', it.title);
    pair('Artist', it.creator);
    pair('Date', it.date);
    pair('Source', sourceName(it.source));
    pair('License', it.license);
    if (it.width && it.height) pair('Dimensions', `${it.width} \u00d7 ${it.height}`);
    pair('Origin', it.sourceUrl, true);

    {
      const palRow = document.createElement('div');
      palRow.className = 'au-detail__palette';
      if (it.swatches?.length) {
        for (const s of it.swatches) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'au-detail__swatch-item';
          item.title = `Click to copy ${s.hex}`;
          item.addEventListener('click', () => { void navigator.clipboard.writeText(s.hex); emit('toast', `Copied ${s.hex}`); });
          const sw = document.createElement('span');
          sw.className = 'au-detail__swatch';
          sw.style.background = s.hex;
          const hexLabel = document.createElement('span');
          hexLabel.className = 'au-detail__hex';
          hexLabel.textContent = s.hex;
          item.append(sw, hexLabel);
          palRow.appendChild(item);
        }
      } else {
        const loading = document.createElement('span');
        loading.className = 'au-detail__hex';
        loading.textContent = 'Extracting\u2026';
        palRow.appendChild(loading);
      }
      const palLabel = document.createElement('div');
      palLabel.className = 'l-stat';
      const pl = document.createElement('span'); pl.className = 'l-stat__label'; pl.textContent = 'Palette';
      const pv = document.createElement('span'); pv.className = 'l-stat__value';
      pv.appendChild(palRow);
      palLabel.append(pl, pv);
      meta.appendChild(palLabel);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = inBoard(it.id) ? 'l-btn l-btn--primary' : 'l-btn';
    addBtn.textContent = inBoard(it.id) ? 'Added' : 'Add to board';
    addBtn.addEventListener('click', () => { toggle(it.id); addBtn.textContent = inBoard(it.id) ? 'Added' : 'Add to board'; addBtn.className = inBoard(it.id) ? 'l-btn l-btn--primary' : 'l-btn'; });

    const actions = document.createElement('div');
    actions.className = 'au-detail__actions';
    actions.append(addBtn);
    detail.append(back, img, meta, actions);
    scroller.replaceChildren(detail);
    scroller.scrollTop = 0;

    // Keyboard navigation
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeDetail(); window.removeEventListener('keydown', onKey); return; }
      if (e.key === 'ArrowRight' && idx < list.length - 1) { openDetail(list[idx + 1]); window.removeEventListener('keydown', onKey); return; }
      if (e.key === 'ArrowLeft' && idx > 0) { openDetail(list[idx - 1]); window.removeEventListener('keydown', onKey); return; }
    };
    window.addEventListener('keydown', onKey);
  }

  /* ---------------- boot ---------------- */
  // Migrate old collections to boards
  const oldColls = settings.get<any[]>('collections', []);
  if (oldColls.length) {
    boards = migrateCollections(oldColls, query);
    activeBoard = boards[0].id;
    settings.remove('collections');
    for (const b of boards) saveBoard(b);
  }
  // Load boards
  void loadBoards().then(loaded => {
    if (loaded.length) { boards = loaded; activeBoard = boards[0].id; }
    if (!boards.length) {
      void createBoard('Board 1', query).then(b => { boards = [b]; activeBoard = b.id; renderBoardUI(); renderGrid(); });
    } else {
      renderBoardUI(); renderGrid();
    }
  });
  renderGrid();
  void listSources().then(list => { sources = list; renderSources(); if (query) void search(query); else renderGrid(); });

  return {
    unmount() { controller?.abort(); palettes.destroy(); cancelAnimationFrame(gridRaf); loadObserver.disconnect(); },
  };
}
