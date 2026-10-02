/* Audit, subject mode: query open archives in parallel, stream results in, extract an OKLab palette
   from every thumbnail, filter and sort by color, collect, and send a deck to Bento. */
import type { MountContext, MountResult } from '../types';
import { PaletteQueue, listSources, proxied, searchSource, type AuditResult, type SourceInfo } from './api';
import { buildDeck } from './deck';
import { DECK_MIME } from '../bento/model';
import { aggregatePalette, hexToOklab, paletteDistance, type Swatch } from '../../lib/color';
import { button, chips, field, note, section, select, slider, statList } from '../../ui/primitives';
import './audit.css';

type Item = AuditResult & { swatches?: Swatch[]; order: number };
type Orientation = 'any' | 'landscape' | 'portrait' | 'square';
interface Collection { id: string; name: string; items: Item[] }
interface SourceState { status: 'idle' | 'loading' | 'done' | 'error'; count: number; total: number; ms: number; page: number; error?: string; cached?: boolean }

const orientationOf = (r: { width: number | null; height: number | null }): Orientation | null => {
  if (!r.width || !r.height) return null;
  const a = r.width / r.height;
  return a > 1.1 ? 'landscape' : a < 0.9 ? 'portrait' : 'square';
};
const shortType = (t: string | null) => (t ? t.split(/[;,/]/)[0].trim().toLowerCase().replace(/^image\//, '') : null);

export function mountSubject({ defaults: d, stage, inspector, statusbar, assets, settings, emit }: MountContext, modeEl: HTMLElement): MountResult {
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
  let collections = settings.get<Collection[]>('collections', []);
  if (!collections.length) collections = [{ id: 'c1', name: 'Collection 1', items: [] }];
  let active = settings.get<string>('activeCollection', collections[0].id);
  if (!collections.some(c => c.id === active)) active = collections[0].id;
  let tab: 'results' | 'collection' = 'results';
  const palettes = new PaletteQueue({
    k: d.paletteSize as number, sample: d.paletteSample as number, iterations: d.paletteIterations as number,
    minShare: d.minSwatchShare as number, minSwatches: d.minSwatches as number, cacheHours: d.cacheHours as number,
  });
  const coll = () => collections.find(c => c.id === active)!;
  const saveColl = () => { settings.set('collections', collections); settings.set('activeCollection', active); };

  /* ---------------- stage ---------------- */
  const root = document.createElement('div'); root.className = 'au';
  const bar = document.createElement('form'); bar.className = 'au__bar'; bar.setAttribute('role', 'search');
  const q = document.createElement('input');
  Object.assign(q, { className: 'au__q', type: 'search', placeholder: '1970s Japanese product photography', value: query });
  q.setAttribute('aria-label', 'Subject');
  const go = document.createElement('button'); go.type = 'submit'; go.className = 'l-btn l-btn--primary au__go'; go.textContent = 'Audit';
  bar.append(q, go);
  const tabs = document.createElement('div'); tabs.className = 'au__tabs'; tabs.setAttribute('role', 'tablist');
  const tabBtn = (id: typeof tab) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'au__tab'; b.setAttribute('role', 'tab'); b.dataset.tab = id; b.addEventListener('click', () => { tab = id; renderGrid(); }); return b; };
  const tResults = tabBtn('results'), tColl = tabBtn('collection');
  tabs.append(tResults, tColl);
  const grid = document.createElement('div'); grid.className = 'au__grid';
  const empty = document.createElement('div'); empty.className = 'au__empty';
  const more = document.createElement('button'); more.type = 'button'; more.className = 'l-btn au__more'; more.textContent = 'Load more';
  more.addEventListener('click', () => void loadMore());
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
    settings.set('colorHex', h); renderGrid();
  };
  hexIn.addEventListener('change', () => setHex(hexIn.value));
  picker.addEventListener('input', () => setHex(picker.value));
  if (filters.hex.length === 7) picker.value = filters.hex;
  hexRow.append(picker, hexIn, button({ label: 'Clear', onClick: () => setHex('') }));
  colSec.body.append(
    hexRow,
    chips<'sort' | 'filter'>({ label: 'Use it to', value: filters.mode, options: [{ value: 'sort', label: 'Sort by closeness' }, { value: 'filter', label: 'Filter' }], onChange: v => { filters.mode = v as 'sort' | 'filter'; settings.set('colorMode', v); renderGrid(); } }).el,
    slider({ label: 'Match distance (ΔE OKLab × 100)', min: 1, max: 50, value: Math.round(filters.threshold * 100), onChange: v => { filters.threshold = v / 100; settings.set('colorThreshold', filters.threshold); if (filters.mode === 'filter') renderGrid(); } }).el,
    note('Distance is measured in OKLab to the closest swatch of each image.'),
  );

  const collSec = section('Collection');
  const collPick = select<string>({ label: 'Collection', value: active, options: [], onChange: v => { active = v; saveColl(); renderColl(); renderGrid(); } });
  const collName = field({ label: 'Name', value: coll().name, onChange: v => { coll().name = v.trim() || coll().name; saveColl(); renderColl(); } });
  const collStats = statList();
  const aggHost = document.createElement('div'); aggHost.className = 'au-agg';
  const collRow = document.createElement('div'); collRow.className = 'l-row';
  collRow.append(
    button({ label: 'Build deck in Bento', primary: true, onClick: () => void buildDeckNow() }),
    button({ label: 'New', onClick: () => { const c = { id: `c${Date.now().toString(36)}`, name: `Collection ${collections.length + 1}`, items: [] }; collections.push(c); active = c.id; saveColl(); renderColl(); renderGrid(); } }),
    button({ label: 'Clear', onClick: () => { coll().items = []; saveColl(); renderColl(); renderGrid(); } }),
  );
  collSec.body.append(collPick.el, collName.el, collStats.el, aggHost, collRow);
  const sumSec = section('Results');
  const sumStats = statList();
  sumSec.body.append(sumStats.el);
  inspector.append(modeEl, collSec.el, srcSec.el, filtSec.el, colSec.el, sumSec.el);

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
      ? `${hidden ? `${hidden} more sources appear when their API keys are set in .env.local. ` : ''}Responses are cached for ${d.cacheHours} hours.`
      : 'Sources are unavailable: the /api functions are not running.';
  }

  /* ---------------- search ---------------- */
  async function search(text: string) {
    query = text.trim();
    if (!query) { emit('toast', 'Type a subject to audit'); return; }
    settings.set('query', query);
    controller?.abort(); controller = new AbortController();
    palettes.cancelPending();
    items = []; state.clear(); tab = 'results';
    const live = sources.filter(s => s.available && !disabled.has(s.id));
    for (const s of live) state.set(s.id, { status: 'loading', count: 0, total: 0, ms: 0, page: 1 });
    renderSources(); renderGrid();
    await Promise.all(live.map(s => fetchPage(s.id, 1, controller!.signal)));
  }
  async function fetchPage(id: string, page: number, signal: AbortSignal) {
    const st = state.get(id)!;
    st.status = 'loading'; renderSources();
    try {
      const r = await searchSource(id, query, page, d.cacheHours as number, signal);
      if (signal.aborted) return;
      if (r.error) { st.status = 'error'; st.error = r.error; }
      else {
        st.status = 'done'; st.total = r.total; st.ms = r.ms; st.page = page; st.cached = r.cached;
        const seen = new Set(items.map(i => i.id));
        const fresh = r.results.filter(x => !seen.has(x.id)).map((x, i) => ({ ...x, order: (page - 1) * 1000 + i * 20 + sources.findIndex(s => s.id === id) }));
        st.count += fresh.length;
        items.push(...fresh);
        for (const it of fresh) void paletteFor(it, signal);
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
    if (filters.hex) scheduleGrid();
  }
  async function loadMore() {
    if (!controller) return;
    const sig = controller.signal;
    await Promise.all([...state.entries()].filter(([, s]) => s.status === 'done' && s.count < s.total && s.page < 20).map(([id, s]) => fetchPage(id, s.page + 1, sig)));
  }

  /* ---------------- grid ---------------- */
  const cards = new Map<string, HTMLElement>();
  const inColl = (id: string) => coll().items.some(i => i.id === id);
  const sourceName = (id: string) => sources.find(s => s.id === id)?.name ?? id;

  function visible(): Item[] {
    const target = filters.hex ? hexToOklab(filters.hex) : null;
    let list = (tab === 'collection' ? coll().items : items).filter(it => {
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
    } else if (tab === 'results') list = [...list].sort((a, b) => a.order - b.order);
    return list;
  }

  function card(it: Item): HTMLElement {
    let el = cards.get(it.id);
    if (!el) {
      el = document.createElement('article'); el.className = 'au-card'; el.dataset.id = it.id;
      const pick = document.createElement('button'); pick.type = 'button'; pick.className = 'au-card__pick';
      pick.addEventListener('click', () => toggle(it.id));
      const img = document.createElement('img'); img.className = 'au-card__img'; img.loading = 'lazy'; img.alt = it.title; img.src = it.thumbUrl;
      img.addEventListener('error', () => { if (!img.src.includes('/api/img')) img.src = proxied(it.thumbUrl); }, { once: true });
      img.addEventListener('click', () => toggle(it.id));
      const meta = document.createElement('div'); meta.className = 'au-card__meta';
      const t = document.createElement('div'); t.className = 'au-card__title'; t.textContent = it.title;
      const by = document.createElement('div'); by.className = 'au-card__by'; by.textContent = [it.creator, it.date].filter(Boolean).join(', ') || '—';
      const src = document.createElement('div'); src.className = 'au-card__src';
      const a = document.createElement('a'); a.href = it.sourceUrl; a.target = '_blank'; a.rel = 'noopener'; a.textContent = sourceName(it.source);
      src.append(a);
      if (it.isPublicDomain) { const b = document.createElement('span'); b.className = 'au-card__pd'; b.textContent = 'PD'; b.title = it.license; src.append(b); }
      else { const l = document.createElement('span'); l.className = 'au-card__lic'; l.textContent = it.license; src.append(l); }
      const pal = document.createElement('div'); pal.className = 'au-card__pal';
      meta.append(t, by, src);
      el.append(pick, img, pal, meta);
      cards.set(it.id, el);
    }
    updateCard(it, el);
    return el;
  }
  function updateCard(it: Item, el = cards.get(it.id)) {
    if (!el) return;
    const selected = inColl(it.id);
    el.classList.toggle('is-selected', selected);
    const pick = el.querySelector<HTMLButtonElement>('.au-card__pick')!;
    pick.textContent = selected ? 'In collection' : 'Add';
    pick.setAttribute('aria-pressed', String(selected));
    const pal = el.querySelector<HTMLElement>('.au-card__pal')!;
    if (it.swatches && pal.dataset.n !== String(it.swatches.length)) {
      pal.dataset.n = String(it.swatches.length);
      pal.replaceChildren(...it.swatches.map(s => {
        const sw = document.createElement('div'); sw.className = 'au-sw';
        const chip = document.createElement('span'); chip.className = 'au-sw__chip'; chip.style.background = s.hex; chip.style.flexGrow = String(Math.max(0.5, s.share * 10));
        const hex = document.createElement('span'); hex.className = 'au-sw__hex'; hex.textContent = s.hex.slice(1);
        sw.append(chip, hex); sw.style.flexGrow = String(Math.max(0.6, s.share * 10)); sw.title = `${s.hex} · ${Math.round(s.share * 100)}%`;
        return sw;
      }));
    }
  }
  function toggle(id: string) {
    const c = coll();
    if (c.items.some(i => i.id === id)) c.items = c.items.filter(i => i.id !== id);
    else { const it = items.find(i => i.id === id) ?? c.items.find(i => i.id === id); if (it) c.items.push({ ...it }); }
    saveColl(); renderColl();
    const it = items.find(i => i.id === id) ?? c.items.find(i => i.id === id);
    if (it) updateCard(it as Item);
    if (tab === 'collection') renderGrid();
  }

  let gridRaf = 0;
  const scheduleGrid = () => { cancelAnimationFrame(gridRaf); gridRaf = requestAnimationFrame(renderGrid); };
  function renderGrid() {
    const list = visible();
    grid.replaceChildren(...list.map(card));
    tResults.textContent = `Results ${items.length ? items.length : ''}`.trim();
    tColl.textContent = `Collection ${coll().items.length || ''}`.trim();
    tResults.classList.toggle('is-active', tab === 'results'); tColl.classList.toggle('is-active', tab === 'collection');
    tResults.setAttribute('aria-selected', String(tab === 'results')); tColl.setAttribute('aria-selected', String(tab === 'collection'));
    const loading = [...state.values()].some(s => s.status === 'loading');
    empty.textContent = list.length ? '' : tab === 'collection' ? 'Add results to this collection, then build a deck in Bento.'
      : !query ? 'Search a subject across open archives, like “Swiss transit signage” or “Bauhaus posters”.'
        : loading ? 'Searching…' : items.length ? 'Nothing matches these filters.' : 'No results.';
    empty.hidden = !!list.length;
    more.hidden = tab !== 'results' || ![...state.values()].some(s => s.status === 'done' && s.count < s.total);
    renderTypes();
    sumStats.set([['Results', String(items.length)], ['Shown', String(list.length)], ['Sources', String([...state.values()].filter(s => s.status === 'done').length)]]);
    statusbar.set({ name: query ? `“${query}”` : 'Audit', state: `${items.length} results · ${list.length} shown${loading ? ' · searching' : ''}` });
  }
  function renderTypes() {
    const counts = new Map<string, number>();
    for (const it of items) { const t = shortType(it.type); if (t) counts.set(t, (counts.get(t) ?? 0) + 1); }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
    for (const t of filters.types) if (!top.includes(t)) top.push(t);
    const key = top.join('|') + '#' + [...filters.types].join('|');
    if (typeHost.dataset.key === key) return;
    typeHost.dataset.key = key;
    typeHost.replaceChildren(top.length ? chips<string>({ label: 'Type', multi: true, value: [...filters.types], options: top.map(t => ({ value: t, label: t })),
      onChange: v => { filters.types = new Set(v as string[]); settings.set('types', [...filters.types]); renderGrid(); } }).el : note('Types appear after a search.'));
  }

  function renderColl() {
    collPick.setOptions(collections.map(c => ({ value: c.id, label: `${c.name} (${c.items.length})` })), active);
    collName.input.value = coll().name;
    const c = coll();
    const agg = aggregatePalette(c.items.filter(i => i.swatches?.length).map(i => i.swatches!), d.aggregateSize as number);
    collStats.set([['Images', String(c.items.length)], ['Sources', String(new Set(c.items.map(i => i.source)).size)], ['Public domain', String(c.items.filter(i => i.isPublicDomain).length)]]);
    aggHost.replaceChildren(...agg.map(s => {
      const sw = document.createElement('div'); sw.className = 'au-agg__sw';
      const chip = document.createElement('span'); chip.className = 'au-agg__chip'; chip.style.background = s.hex;
      const hex = document.createElement('span'); hex.className = 'au-agg__hex'; hex.textContent = s.hex;
      sw.append(chip, hex); return sw;
    }));
    if (!agg.length) aggHost.append(note('The collection’s palette appears here.'));
    tColl.textContent = `Collection ${c.items.length || ''}`.trim();
  }

  /* ---------------- deck ---------------- */
  async function buildDeckNow() {
    const c = coll();
    if (!c.items.length) { emit('toast', 'Add results to the collection first'); return; }
    const deck = buildDeck({
      query: query || c.name, items: c.items, theme: d.deckTheme as 'dark' | 'light',
      sourceNames: Object.fromEntries(sources.map(s => [s.id, s.name])),
      imagesPerSlide: d.imagesPerSlide as number, paletteSize: d.aggregateSize as number,
    });
    const name = `${(query || c.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'audit'}.deck.json`;
    const a = await assets.add(new Blob([JSON.stringify(deck)], { type: DECK_MIME }), { name, source: 'tool', origin: 'audit' });
    emit('send', a, 'bento');
  }

  /* ---------------- boot ---------------- */
  renderColl(); renderGrid();
  void listSources().then(list => { sources = list; renderSources(); if (query) void search(query); else renderGrid(); });

  return {
    unmount() { controller?.abort(); palettes.destroy(); cancelAnimationFrame(gridRaf); },
    export: () => void buildDeckNow(),
  };
}
