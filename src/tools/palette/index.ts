/* Palette (Color): an image or URL in; an editable palette, OKLCH tint/shade scales per swatch,
   contrast pairs (handed to Color-check), and exports as CSS variables, design tokens, Figma
   variables, a Tailwind config and Adobe Swatch Exchange. */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { scaleFor, fmtOklch } from './scales';
import { slug, toAse, toCss, toDtcg, toFigma, toTailwind, type NamedScale } from './exporters';
import { kmeans, rgbToOklab, hexToOklab, type Lab } from '../../lib/color';
import { hexToRgb as ccHex, wcagRatio } from '../color-check/engine';
import { decodePixels, imageInput, sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { advancedSection, button, chips, field, note, section, slider, statList } from '../../ui/primitives';
import './palette.css';

interface Sw { name: string; hex: string; share: number | null }
type Level = 'all' | 'AA Large' | 'AA' | 'AAA';

export const tool: LatheTool = {
  id: 'palette',
  name: 'Palette',
  group: 'Workbench',
  defaults,
  accepts: ['image/*'],

  mount({ defaults: d, changedDefaults, stage, inspector, statusbar, assets, settings, emit }) {
    if (changedDefaults.includes('swatchCount') || changedDefaults.includes('sampleSize') || changedDefaults.includes('iterations')) settings.remove('swatches');
    let swatches = settings.get<Sw[]>('swatches', []);
    let count = settings.get<number>('count', d.swatchCount as number);
    let level = settings.get<Level>('pairsShown', d.pairsShown as Level);
    let source: Asset | undefined;
    let srcUrl: string | null = null;
    const ladder = d.ladder as [number, number][];

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'pl';
    stage.appendChild(root);

    /* ---------------- inspector ---------------- */
    const srcSec = section('Source');
    const srcStats = statList();
    const input = imageInput({ toolId: 'palette', name: 'Palette', assets, settings, emit, onLoad: a => void load(a, !swatches.length || settings.get('sourceId', '') !== a.id) });
    srcSec.body.append(srcStats.el, input.fileEl, input.urlEl, note('Drop an image, send one from the tray, or fetch a URL. A web page gives its share image.'));

    const exSec = section('Extract');
    exSec.body.append(slider({ label: 'Swatches', min: 2, max: 12, value: count, onChange: v => { count = v; settings.set('count', v); scheduleExtract(); } }).el);

    const swSec = section('Swatches');
    const swList = document.createElement('div'); swList.className = 'pl-list';
    const addRow = document.createElement('div'); addRow.className = 'l-row l-url';
    const addHex = field({ label: 'Add a color', value: '', placeholder: '#E8FF1A', onChange: () => {} }); // tokens-allow: example input
    addHex.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    addRow.append(addHex.el, button({ label: 'Add', onClick: () => add() }));
    swSec.body.append(swList, addRow);

    const conSec = section('Contrast');
    conSec.body.append(
      button({ label: 'Open in Color-check', onClick: () => void toColorCheck() }),
    );

    const advSec = advancedSection();
    advSec.body.append(
      chips<'true' | 'false'>({ label: 'Swatch replaces nearest step', value: String(d.anchorBase) as 'true' | 'false', options: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }],
        onChange: v => { (d as Record<string, unknown>).anchorBase = v === 'true'; render(); } }).el,
      chips<Level>({ label: 'Contrast pairs shown', value: level, options: (['all', 'AA Large', 'AA', 'AAA'] as Level[]).map(v => ({ value: v, label: v === 'all' ? 'All' : v })),
        onChange: v => { level = v as Level; settings.set('pairsShown', v); render(); } }).el,
      slider({ label: 'AA body ratio', min: 10, max: 210, step: 1, value: Math.round((d.aaRatio as number) * 10), format: v => `${(v / 10).toFixed(1)}:1`, onChange: v => { (d as Record<string, unknown>).aaRatio = v / 10; render(); } }).el,
      slider({ label: 'AA large ratio', min: 10, max: 210, step: 1, value: Math.round((d.aaLargeRatio as number) * 10), format: v => `${(v / 10).toFixed(1)}:1`, onChange: v => { (d as Record<string, unknown>).aaLargeRatio = v / 10; render(); } }).el,
      slider({ label: 'AAA body ratio', min: 10, max: 210, step: 1, value: Math.round((d.aaaRatio as number) * 10), format: v => `${(v / 10).toFixed(1)}:1`, onChange: v => { (d as Record<string, unknown>).aaaRatio = v / 10; render(); } }).el,
      chips<'true' | 'false'>({ label: 'Include black and white', value: String(d.includeBlackWhite) as 'true' | 'false', options: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }],
        onChange: v => { (d as Record<string, unknown>).includeBlackWhite = v === 'true'; render(); } }).el,
    );

    const outSec = section('Export');
    const outRow = document.createElement('div'); outRow.className = 'l-row';
    const fmts: [string, () => void][] = [['CSS', () => void exp('css')], ['Tokens JSON', () => void exp('dtcg')], ['Figma variables', () => void exp('figma')], ['Tailwind', () => void exp('tailwind')], ['.ase', () => void exp('ase')]];
    fmts.forEach(([l, f], i) => outRow.append(button({ label: l, primary: i === 0, onClick: f })));
    const send = sendControl({ from: 'palette', type: () => (swatches.length ? 'text/plain' : null), get: () => hexListAsset(), emit });
    outSec.body.append(outRow, button({ label: 'Copy CSS', onClick: () => void navigator.clipboard.writeText(text('css')).then(() => emit('toast', 'CSS copied')) }),
      button({ label: 'Save to Library', onClick: async () => {
        if (!swatches.length) { emit('toast', 'Extract or add colors first'); return; }
        const { supabase } = await import('../../lib/supabase');
        if (!supabase) { emit('toast', 'Sign in to save'); return; }
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { emit('toast', 'Sign in to save'); return; }
        const { cloudSaveItem } = await import('../../lib/cloud-library');
        await cloudSaveItem(user.id, { type: 'palette', name: source?.name ?? 'Palette', toolId: 'palette', data: { swatches } });
        emit('toast', 'Saved to Library');
      }}),
      note(`CSS uses ${d.cssFormat} values${d.exportScales ? ' and includes each scale' : ''}; change both in Defaults. Figma variables is the REST API's variables payload. Tailwind is a v3 config (v4: load it with @config).`), send.el);
    inspector.append(srcSec.el, exSec.el, swSec.el, conSec.el, advSec.el, outSec.el);

    /* ---------------- extraction ---------------- */
    let pixels: Lab[] = [];
    async function load(a: Asset, extract: boolean) {
      source = a; settings.set('sourceId', a.id);
      const prev = srcUrl; srcUrl = URL.createObjectURL(a.blob); if (prev) URL.revokeObjectURL(prev);
      statusbar.set({ name: a.name, width: a.width, height: a.height, bytes: a.size, state: 'Reading' });
      try {
        const { data } = await decodePixels(a.blob, d.sampleSize as number);
        pixels = [];
        for (let i = 0; i < data.data.length; i += 4) if (data.data[i + 3] >= 128) pixels.push(rgbToOklab(data.data[i], data.data[i + 1], data.data[i + 2]));
        srcStats.set([['Name', a.name], ['Dimensions', a.width && a.height ? `${a.width}×${a.height}` : '—'], ['Size', formatBytes(a.size)], ['Sampled', `${pixels.length} px`]]);
        if (extract) runExtract(); else render();
      } catch (e) { emit('toast', `Could not read ${a.name}`); console.warn(e); }
    }
    function runExtract() {
      if (!pixels.length) return;
      const k = kmeans(pixels, count, d.iterations as number);
      swatches = k.map((s, i) => ({ name: `color-${i + 1}`, hex: s.hex, share: s.share }));
      save(); render();
    }
    let t = 0;
    const scheduleExtract = () => { clearTimeout(t); t = window.setTimeout(runExtract, 120); };
    const save = () => settings.set('swatches', swatches);
    function add() {
      const v = addHex.input.value.trim();
      const hex = ('#' + v.replace(/^#/, '')).toUpperCase();
      if (!hexToOklab(hex) || hex.length !== 7) { emit('toast', 'Type a six-digit hex color'); return; }
      swatches.push({ name: `color-${swatches.length + 1}`, hex, share: null });
      addHex.input.value = ''; save(); render();
    }

    /* ---------------- derived ---------------- */
    const scales = (): NamedScale[] => swatches.map(s => ({ name: s.name, hex: s.hex, steps: scaleFor(s.hex, ladder, d.anchorBase as boolean) }));
    const grade = (r: number) => (r >= (d.aaaRatio as number) ? 'AAA' : r >= (d.aaRatio as number) ? 'AA' : r >= (d.aaLargeRatio as number) ? 'AA Large' : 'Fail');
    const rank: Record<string, number> = { Fail: 0, 'AA Large': 1, AA: 2, AAA: 3 };
    function pairs() {
      const bw = [{ name: 'white', hex: '#FFFFFF' }, { name: 'black', hex: '#000000' }]; // tokens-allow: content colors, pairs are measured against pure white and black
      const cols = [...swatches.map(s => ({ name: s.name, hex: s.hex })), ...(d.includeBlackWhite ? bw : [])];
      const out: { fg: typeof cols[number]; bg: typeof cols[number]; ratio: number; grade: string }[] = [];
      for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) {
        if (i >= swatches.length && j >= swatches.length) continue; // black on white is not this palette's pair
        const r = wcagRatio(ccHex(cols[i].hex)!, ccHex(cols[j].hex)!);
        out.push({ fg: cols[i], bg: cols[j], ratio: r, grade: grade(r) });
      }
      const min = level === 'all' ? 0 : rank[level];
      return out.filter(p => rank[p.grade] >= min).sort((a, b) => b.ratio - a.ratio);
    }

    /* ---------------- render ---------------- */
    function render() {
      renderList();
      if (!swatches.length) {
        const empty = document.createElement('p'); empty.className = 'pl__empty';
        empty.textContent = 'Drop an image, or fetch one by URL, to extract its palette.';
        root.replaceChildren(empty);
        statusbar.set({ name: 'Palette', state: 'No image' });
        return;
      }
      const head = document.createElement('div'); head.className = 'pl__head';
      if (srcUrl) { const img = document.createElement('img'); img.className = 'pl__src'; img.src = srcUrl; img.alt = source?.name ?? 'Source'; head.append(img); }
      const strip = document.createElement('div'); strip.className = 'pl__strip';
      for (const s of swatches) {
        const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'pl-sw'; sw.style.flexGrow = String(s.share ? Math.max(0.6, s.share * 10) : 1);
        sw.dataset.hex = s.hex; sw.title = `Copy ${s.hex}`;
        const chip = document.createElement('span'); chip.className = 'pl-sw__chip'; chip.style.background = s.hex;
        const lab = document.createElement('span'); lab.className = 'pl-sw__hex'; lab.textContent = s.hex;
        const meta = document.createElement('span'); meta.className = 'pl-sw__meta'; meta.textContent = `${s.name}${s.share != null ? ` · ${Math.round(s.share * 100)}%` : ''}`;
        sw.append(chip, lab, meta);
        sw.addEventListener('click', () => void navigator.clipboard.writeText(s.hex).then(() => emit('toast', `${s.hex} copied`)));
        strip.append(sw);
      }
      head.append(strip);

      const sc = document.createElement('section'); sc.className = 'pl__sec';
      sc.append(h3('Scales', 'OKLCH lightness per step; hue kept; chroma reduced only to stay in sRGB'));
      const grid = document.createElement('div'); grid.className = 'pl-scales'; grid.style.setProperty('--n', String(ladder.length));
      grid.append(document.createElement('span'), ...ladder.map(([s]) => { const x = document.createElement('span'); x.className = 'pl-scales__step'; x.textContent = String(s); return x; }));
      for (const s of scales()) {
        const n = document.createElement('span'); n.className = 'pl-scales__name'; n.textContent = s.name; grid.append(n);
        for (const st of s.steps) {
          const c = document.createElement('span'); c.className = `pl-cell${st.base ? ' is-base' : ''}`; c.style.background = st.hex;
          c.dataset.hex = st.hex; c.title = `${s.name}-${st.step} ${st.hex} ${fmtOklch(st.lch)}`;
          const hx = document.createElement('span'); hx.className = 'pl-cell__hex'; hx.textContent = st.hex.slice(1);
          hx.style.color = st.lch.L > 0.62 ? 'var(--black)' : 'var(--white)';
          c.append(hx); grid.append(c);
        }
      }
      sc.append(grid);

      const cp = document.createElement('section'); cp.className = 'pl__sec';
      const list = pairs();
      cp.append(h3('Contrast pairs', `WCAG 2.2 ratio · ${list.length} ${level === 'all' ? 'pairs' : `pass ${level}`}`));
      const pl = document.createElement('div'); pl.className = 'pl-pairs';
      for (const p of list.slice(0, 60)) {
        const r = document.createElement('div'); r.className = 'pl-pair'; r.dataset.grade = p.grade;
        const demo = document.createElement('span'); demo.className = 'pl-pair__demo'; demo.style.background = p.bg.hex; demo.style.color = p.fg.hex; demo.textContent = 'Aa';
        const names = document.createElement('span'); names.className = 'pl-pair__names'; names.textContent = `${p.fg.name} on ${p.bg.name}`;
        const ratio = document.createElement('span'); ratio.className = 'pl-pair__ratio'; ratio.textContent = `${p.ratio.toFixed(2)}:1`;
        const g = document.createElement('span'); g.className = 'pl-pair__grade'; g.textContent = p.grade;
        r.append(demo, names, ratio, g); pl.append(r);
      }
      if (!list.length) pl.append(note('No pairs reach this level. Lower it, or add black and white in Defaults.'));
      cp.append(pl);
      root.replaceChildren(head, sc, cp);
      statusbar.set({ name: source?.name ?? 'Palette', width: source?.width, height: source?.height, bytes: source?.size, state: `${swatches.length} swatches · ${list.length} pairs` });
      send.refresh();
    }
    function h3(title: string, aside: string) {
      const h = document.createElement('h3'); h.className = 'pl__h'; h.textContent = title;
      const a = document.createElement('span'); a.className = 'pl__aside'; a.textContent = aside; h.append(a);
      return h;
    }
    function renderList() {
      swList.replaceChildren(...swatches.map((s, i) => {
        const r = document.createElement('div'); r.className = 'pl-row';
        const c = document.createElement('input'); c.type = 'color'; c.className = 'l-swatch-input'; c.value = s.hex.toLowerCase(); c.setAttribute('aria-label', `${s.name} color`);
        c.addEventListener('change', () => { s.hex = c.value.toUpperCase(); s.share = null; save(); render(); });
        const n = document.createElement('input'); n.className = 'l-input pl-row__name'; n.value = s.name; n.setAttribute('aria-label', `Swatch ${i + 1} name`);
        n.addEventListener('change', () => { s.name = slug(n.value) || s.name; save(); render(); });
        const hx = document.createElement('span'); hx.className = 'pl-row__hex'; hx.textContent = s.hex;
        const x = button({ label: 'Remove', onClick: () => { swatches.splice(i, 1); save(); render(); } });
        r.append(c, n, hx, x); return r;
      }));
      if (!swatches.length) swList.append(note('No swatches yet.'));
    }

    /* ---------------- outputs ---------------- */
    function text(kind: 'css' | 'dtcg' | 'figma' | 'tailwind'): string {
      const s = scales(), w = d.exportScales as boolean;
      if (kind === 'css') return toCss(s, { prefix: d.cssPrefix as string, format: d.cssFormat as 'hex' | 'oklch', withScales: w });
      if (kind === 'dtcg') return toDtcg(s, w);
      if (kind === 'figma') return toFigma(s, { collection: d.figmaCollection as string, withScales: w });
      return toTailwind(s, w);
    }
    const base = () => (source?.name.replace(/\.[^.]+$/, '') || 'palette').replace(/[^\w.-]+/g, '-');
    async function exp(kind: 'css' | 'dtcg' | 'figma' | 'tailwind' | 'ase') {
      if (!swatches.length) { emit('toast', 'Extract or add colors first'); return; }
      const files = {
        css: [`${base()}-palette.css`, 'text/css'], dtcg: [`${base()}-palette.tokens.json`, 'application/json'], figma: [`${base()}-figma-variables.json`, 'application/json'],
        tailwind: [`${base()}-tailwind.config.js`, 'text/javascript'], ase: [`${base()}-palette.ase`, 'application/octet-stream'],
      } as const;
      const [name, type] = files[kind];
      const body = kind === 'ase' ? toAse(scales(), d.exportScales as boolean) : text(kind);
      await saveExport(new Blob([body as BlobPart], { type }), name, 'palette');
      statusbar.set({ name: source?.name ?? 'Palette', state: `Exported ${name}` });
    }
    async function hexListAsset() {
      if (!swatches.length) return null;
      return assets.add(new Blob([swatches.map(s => s.hex).join('\n') + '\n'], { type: 'text/plain' }), { name: `${base()}-palette.txt`, source: 'tool', origin: 'palette' });
    }
    async function toColorCheck() {
      const a = await hexListAsset();
      if (!a) { emit('toast', 'Extract or add colors first'); return; }
      emit('send', a, 'contrast');
    }

    render();
    return {
      unmount() { input.off(); clearTimeout(t); if (srcUrl) URL.revokeObjectURL(srcUrl); },
      export: () => void exp('css'),
    };
  },
};
