/* Grid (Layout): columns, gutters, margins, rows and a baseline for a format (screens in px, paper
   in mm or inches). Live preview; exports an SVG overlay, a PNG and a CSS grid snippet. */
import type { LatheTool } from '../types';
import { defaults, FORMATS } from './defaults';
import { canvasBlob, sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { button, chips, field, note, section, select, slider, statList } from '../../ui/primitives';
import './grid.css';

type Unit = 'px' | 'mm' | 'in';
type Format = (typeof FORMATS)[number];
type Show = 'cols' | 'rows' | 'baseline' | 'margins';
interface State {
  format: string; unit: Unit; w: number; h: number;
  cols: number; gutter: number; mt: number; mr: number; mb: number; ml: number; linked: boolean;
  rows: number; rowGutter: number; baseline: number; offset: number; show: Show[];
}

const HAIR: Record<Unit, number> = { px: 1, mm: 0.1, in: 0.004 };
const round = (v: number, unit: Unit) => (unit === 'px' ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000);
const fmt = (v: number, unit: Unit) => `${round(v, unit)}${unit === 'in' ? ' in' : ` ${unit}`}`;

/** Grid geometry in the format's unit. */
export function layout(s: State, snap: boolean) {
  const cw = s.w - s.ml - s.mr, ch = s.h - s.mt - s.mb;
  const colW = (cw - (s.cols - 1) * s.gutter) / s.cols;
  const cols = Array.from({ length: s.cols }, (_, i) => ({ x: s.ml + i * (colW + s.gutter), w: colW }));
  let rowH = (ch - (s.rows - 1) * s.rowGutter) / s.rows;
  if (snap && s.rows > 1 && s.baseline > 0) rowH = Math.max(s.baseline, Math.floor(rowH / s.baseline + 1e-9) * s.baseline);
  const rows = Array.from({ length: s.rows }, (_, i) => ({ y: s.mt + i * (rowH + s.rowGutter), h: rowH }));
  const lines: number[] = [];
  if (s.baseline > 0) for (let y = s.mt + s.offset; y <= s.h - s.mb + 1e-9; y += s.baseline) lines.push(y);
  return { content: { x: s.ml, y: s.mt, w: cw, h: ch }, colW, rowH, cols, rows, lines };
}

export const tool: LatheTool = {
  id: 'grid',
  name: 'Grid',
  group: 'Layout',
  defaults,

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const formats = (d.formats as Format[]).length ? d.formats as Format[] : FORMATS;
    const fromFormat = (f: Format, prev?: State): State => ({
      format: f.id, unit: f.unit as Unit, w: f.w, h: f.h, cols: f.cols, gutter: f.gutter,
      mt: f.margin, mr: f.margin, mb: f.margin, ml: f.margin, linked: true,
      rows: f.rows, rowGutter: f.rowGutter, baseline: f.baseline, offset: 0, show: prev?.show ?? ['cols', 'rows', 'baseline', 'margins'],
    });
    const start = formats.find(f => f.id === d.format) ?? formats[0];
    let s: State = { ...fromFormat(start), ...settings.get<Partial<State>>('state', {}) };
    const save = () => settings.set('state', s);
    const color = d.overlayColor as string, alpha = d.overlayOpacity as number, baseAlpha = d.baselineOpacity as number;

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'gr';
    const frame = document.createElement('div'); frame.className = 'gr__frame';
    root.append(frame); stage.appendChild(root);
    const fit = () => {
      const pad = parseFloat(getComputedStyle(root).paddingLeft) * 2;
      const k = Math.min((root.clientWidth - pad) / s.w, (root.clientHeight - pad) / s.h);
      frame.style.width = `${Math.max(1, s.w * k)}px`; frame.style.height = `${Math.max(1, s.h * k)}px`;
    };
    const ro = new ResizeObserver(fit); ro.observe(root);

    /* ---------------- inspector ---------------- */
    const fSec = section('Format');
    const fmtSel = select<string>({ label: 'Format', value: s.format, options: [...formats.map(f => ({ value: f.id, label: `${f.label} · ${f.w}×${f.h} ${f.unit}` })), { value: 'custom', label: 'Custom' }],
      onChange: v => { const f = formats.find(x => x.id === v); if (f) { s = fromFormat(f, s); sync(); render(); } } });
    const size = document.createElement('div'); size.className = 'gr-row3';
    const num = (label: string, k: keyof State, after?: () => void) => {
      const fl = field({ label, type: 'number', value: String(s[k]), onChange: v => { const n = Number(v); if (!Number.isFinite(n) || n < 0) { fl.input.value = String(s[k]); return; } (s as unknown as Record<string, unknown>)[k] = n; after?.(); render(); } });
      fl.input.step = 'any'; fl.input.dataset.key = k; return fl;
    };
    const unitSel = select<Unit>({ label: 'Unit', value: s.unit, options: [{ value: 'px', label: 'px' }, { value: 'mm', label: 'mm' }, { value: 'in', label: 'in' }], onChange: v => { s.unit = v; s.format = 'custom'; render(); } });
    size.append(num('Width', 'w', () => { s.format = 'custom'; }).el, num('Height', 'h', () => { s.format = 'custom'; }).el, unitSel.el);
    fSec.body.append(fmtSel.el, size,
      button({ label: 'Swap orientation', onClick: () => { [s.w, s.h] = [s.h, s.w]; [s.mt, s.ml, s.mb, s.mr] = [s.ml, s.mt, s.mr, s.mb]; sync(); render(); } }));

    const cSec = section('Columns');
    const colSl = slider({ label: 'Columns', min: 1, max: 24, value: s.cols, onChange: v => { s.cols = v; render(); } });
    const gut = num('Gutter', 'gutter');
    cSec.body.append(colSl.el, gut.el);

    const mSec = section('Margins');
    const mGrid = document.createElement('div'); mGrid.className = 'gr-row4';
    const mFields = (['mt', 'mr', 'mb', 'ml'] as const).map((k, i) => num(['Top', 'Right', 'Bottom', 'Left'][i], k, () => { if (s.linked) { const v = s[k]; s.mt = s.mr = s.mb = s.ml = v; sync(); } }));
    mGrid.append(...mFields.map(f => f.el));
    const linkChips = chips<'linked' | 'free'>({ value: s.linked ? 'linked' : 'free', options: [{ value: 'linked', label: 'All equal' }, { value: 'free', label: 'Each side' }], onChange: v => { s.linked = v === 'linked'; if (s.linked) { s.mr = s.mb = s.ml = s.mt; sync(); } render(); } });
    mSec.body.append(linkChips.el, mGrid);

    const rSec = section('Rows and baseline');
    const rowSl = slider({ label: 'Rows', min: 1, max: 24, value: s.rows, onChange: v => { s.rows = v; render(); } });
    rSec.body.append(rowSl.el, num('Row gutter', 'rowGutter').el, num('Baseline', 'baseline').el, num('Baseline offset', 'offset').el,
      note(d.snapToBaseline ? 'Row heights snap to whole baselines (change in Defaults).' : 'Row heights divide the page evenly.'));

    const vSec = section('Show');
    vSec.body.append(chips<Show>({ multi: true, value: s.show, options: [{ value: 'cols', label: 'Columns' }, { value: 'rows', label: 'Rows' }, { value: 'baseline', label: 'Baseline' }, { value: 'margins', label: 'Margins' }], onChange: v => { s.show = v as Show[]; render(); } }).el);

    const stats = statList();
    const oSec = section('Export');
    const oRow = document.createElement('div'); oRow.className = 'l-row';
    oRow.append(button({ label: 'SVG overlay', primary: true, onClick: () => void exportSvg() }), button({ label: 'PNG', onClick: () => void exportPng() }), button({ label: 'CSS', onClick: () => void exportCss() }));
    const send = sendControl({ from: 'grid', type: () => 'image/svg+xml', get: () => assets.add(new Blob([svg(true)], { type: 'image/svg+xml' }), { name: `${base()}.svg`, source: 'export', origin: 'grid' }), emit });
    oSec.body.append(stats.el, oRow, button({ label: 'Copy CSS', onClick: () => void navigator.clipboard.writeText(css()).then(() => emit('toast', 'CSS copied')) }), send.el);
    inspector.append(fSec.el, cSec.el, mSec.el, rSec.el, vSec.el, oSec.el);

    function sync() {
      fmtSel.set(formats.some(f => f.id === s.format) ? s.format : 'custom');
      unitSel.set(s.unit); colSl.set(s.cols); rowSl.set(s.rows);
      inspector.querySelectorAll<HTMLInputElement>('input[data-key]').forEach(i => { i.value = String(round(s[i.dataset.key as keyof State] as number, s.unit)); });
      linkChips.set(s.linked ? 'linked' : 'free');
      mFields.slice(1).forEach(f => { f.input.disabled = s.linked; });
    }

    /* ---------------- drawing ---------------- */
    function svg(forExport: boolean): string {
      const g = layout(s, d.snapToBaseline as boolean);
      const hw = HAIR[s.unit];
      const parts: string[] = [];
      const dims = forExport ? ` width="${s.w}${s.unit}" height="${s.h}${s.unit}"` : '';
      parts.push(`<svg xmlns="http://www.w3.org/2000/svg"${dims} viewBox="0 0 ${s.w} ${s.h}" preserveAspectRatio="xMidYMid meet">`);
      parts.push(`<title>Lathe Grid: ${s.cols} columns, ${s.rows} rows, ${fmt(s.baseline, s.unit)} baseline on ${s.w} × ${s.h} ${s.unit}</title>`);
      if (s.show.includes('cols')) parts.push(`<g id="columns" fill="${color}" fill-opacity="${alpha}">${g.cols.map(c => `<rect x="${round(c.x, s.unit)}" y="${s.mt}" width="${round(c.w, s.unit)}" height="${round(g.content.h, s.unit)}"/>`).join('')}</g>`);
      if (s.show.includes('rows') && s.rows > 1) parts.push(`<g id="rows" fill="${color}" fill-opacity="${alpha}">${g.rows.map(r => `<rect x="${s.ml}" y="${round(r.y, s.unit)}" width="${round(g.content.w, s.unit)}" height="${round(r.h, s.unit)}"/>`).join('')}</g>`);
      if (s.show.includes('baseline') && g.lines.length) parts.push(`<g id="baseline" stroke="${color}" stroke-opacity="${baseAlpha}" stroke-width="${hw}">${g.lines.map(y => `<line x1="${s.ml}" x2="${round(s.w - s.mr, s.unit)}" y1="${round(y, s.unit)}" y2="${round(y, s.unit)}"/>`).join('')}</g>`);
      if (s.show.includes('margins')) parts.push(`<rect id="margins" x="${s.ml}" y="${s.mt}" width="${round(g.content.w, s.unit)}" height="${round(g.content.h, s.unit)}" fill="none" stroke="${color}" stroke-width="${hw}"/>`);
      parts.push('</svg>');
      return parts.join('');
    }
    function css(): string {
      const g = layout(s, d.snapToBaseline as boolean), u = s.unit, v = (n: number) => `${round(n, u)}${u}`;
      return [
        `/* Lathe Grid: ${s.cols} columns on ${s.w} × ${s.h} ${u}. */`,
        ':root {',
        `  --grid-columns: ${s.cols};`, `  --grid-gutter: ${v(s.gutter)};`, `  --grid-margin: ${v(s.mt)} ${v(s.mr)} ${v(s.mb)} ${v(s.ml)};`,
        `  --grid-baseline: ${v(s.baseline)};`, `  --grid-column: ${v(g.colW)};`,
        '}', '',
        '.grid {', '  box-sizing: border-box;', `  width: ${v(s.w)};`, '  max-width: 100%;', '  padding: var(--grid-margin);', '  display: grid;',
        '  grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));', '  column-gap: var(--grid-gutter);',
        ...(s.rows > 1 ? [`  grid-template-rows: repeat(${s.rows}, ${v(g.rowH)});`, `  row-gap: ${v(s.rowGutter)};`] : []),
        '}', '',
        '/* Optional: show the baseline while you set type. */',
        '.grid--baseline {',
        `  background-image: repeating-linear-gradient(to bottom, transparent 0 calc(var(--grid-baseline) - ${HAIR[u]}${u}), ${color}59 calc(var(--grid-baseline) - ${HAIR[u]}${u}) var(--grid-baseline));`,
        `  background-position: 0 ${v(s.mt + s.offset)};`,
        '}', '',
      ].join('\n');
    }
    function render() {
      save();
      frame.innerHTML = svg(false);
      fit();
      const g = layout(s, d.snapToBaseline as boolean);
      stats.set([['Column', fmt(g.colW, s.unit)], ['Row', s.rows > 1 ? fmt(g.rowH, s.unit) : '—'], ['Content', `${round(g.content.w, s.unit)} × ${round(g.content.h, s.unit)} ${s.unit}`], ['Baselines', String(g.lines.length)]]);
      statusbar.set({ name: `${formats.find(f => f.id === s.format)?.label ?? 'Custom'}`, state: `${s.w} × ${s.h} ${s.unit} · ${s.cols} col · column ${fmt(g.colW, s.unit)}` });
      if (g.colW <= 0) emit('toast', 'Columns and gutters are wider than the page');
    }

    /* ---------------- export ---------------- */
    const base = () => `grid-${s.format}-${s.cols}col`;
    async function exportSvg() { await saveExport(new Blob([svg(true)], { type: 'image/svg+xml' }), `${base()}.svg`, 'grid'); }
    async function exportCss() { await saveExport(new Blob([css()], { type: 'text/css' }), `${base()}.css`, 'grid'); }
    async function exportPng() {
      const k = s.unit === 'px' ? 1 : s.unit === 'mm' ? (d.pxPerUnitMm as number) / 25.4 : (d.pxPerUnitMm as number);
      const W = Math.round(s.w * k), H = Math.round(s.h * k);
      const url = URL.createObjectURL(new Blob([svg(false).replace('<svg ', `<svg width="${W}" height="${H}" `)], { type: 'image/svg+xml' }));
      try {
        const img = new Image(); img.src = url; await img.decode();
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        cv.getContext('2d')!.drawImage(img, 0, 0, W, H);
        await saveExport(await canvasBlob(cv, 'image/png'), `${base()}.png`, 'grid');
      } finally { URL.revokeObjectURL(url); }
    }

    sync(); render();
    return { unmount() { ro.disconnect(); }, export: () => void exportSvg() };
  },
};
