/* Specimen (Type): drop a font (TTF, OTF, WOFF, WOFF2). Overview with a metrics diagram, glyph grid,
   waterfall, OpenType features on and off, and a modular type scale. Exports a vector specimen PDF
   (outlines from the font itself) and CSS scale tokens. */
import { jsPDF } from 'jspdf';
import type { Asset, LatheTool } from '../types';
import { defaults, RATIOS } from './defaults';
import { cubicCommands, readFont, textCommands, textPathData, textWidth, typeScale, type FontInfo } from './font';
import type { PathCommand } from 'opentype.js';
import { imageInput, sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { advancedSection, button, chips, field, note, section, select, slider, statList } from '../../ui/primitives';
import './specimen.css';

type View = 'overview' | 'glyphs' | 'waterfall' | 'features' | 'scale';
const FONT_EXT = /\.(ttf|otf|woff2?)$/i;
const isFont = (a: { type: string; name: string }) => a.type.startsWith('font/') || /font|opentype|woff/.test(a.type) || FONT_EXT.test(a.name);

const FEATURE_NAMES: Record<string, string> = {
  aalt: 'Access all alternates', calt: 'Contextual alternates', case: 'Case-sensitive forms', ccmp: 'Glyph composition', dlig: 'Discretionary ligatures',
  dnom: 'Denominators', frac: 'Fractions', kern: 'Kerning', liga: 'Standard ligatures', lnum: 'Lining figures', locl: 'Localized forms',
  mark: 'Mark positioning', mkmk: 'Mark to mark', numr: 'Numerators', onum: 'Oldstyle figures', ordn: 'Ordinals', pnum: 'Proportional figures',
  salt: 'Stylistic alternates', sinf: 'Scientific inferiors', smcp: 'Small capitals', c2sc: 'Capitals to small caps', subs: 'Subscript', sups: 'Superscript',
  swsh: 'Swash', tnum: 'Tabular figures', zero: 'Slashed zero', cv01: 'Character variant 1', ss01: 'Stylistic set 1', ss02: 'Stylistic set 2', ss03: 'Stylistic set 3',
};
const FEATURE_SAMPLE: Record<string, string> = {
  frac: '1/2 3/4 7/8', tnum: '1111 0123 9876', pnum: '1111 0123 9876', onum: '0123456789', lnum: '0123456789', zero: '0 O 100',
  sups: 'x2 E=mc2', subs: 'H2O CO2', ordn: '1a 2o No', case: '(H) [I] {J} H-I', smcp: 'Small Capitals', c2sc: 'SMALL CAPS', liga: 'fi fl ffi office',
  dlig: 'st ct sp', kern: 'AVATAR WAVE Ty To',
};

export const tool: LatheTool = {
  id: 'specimen',
  name: 'Specimen',
  group: 'Drawer',
  defaults,
  accepts: ['font/*', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    let info: FontInfo | null = null;
    let source: Asset | undefined;
    let view = settings.get<View>('view', 'overview');
    let sample = settings.get<string>('sample', d.sample as string);
    let on = new Set(settings.get<string[]>('features', []));
    let ratio = settings.get<number>('ratio', d.scaleRatio as number);
    let base = settings.get<number>('base', d.scaleBase as number);

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'sp';
    const tabs = document.createElement('div'); tabs.className = 'sp__tabs';
    const body = document.createElement('div'); body.className = 'sp__body';
    root.append(tabs, body); stage.appendChild(root);
    const viewChips = chips<View>({ value: view, options: [{ value: 'overview', label: 'Overview' }, { value: 'glyphs', label: 'Glyphs' }, { value: 'waterfall', label: 'Waterfall' }, { value: 'features', label: 'Features' }, { value: 'scale', label: 'Scale' }],
      onChange: v => { view = v as View; settings.set('view', view); render(); } });
    tabs.append(viewChips.el);

    /* ---------------- inspector ---------------- */
    const srcSec = section('Font');
    const stats = statList();
    const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = '.ttf,.otf,.woff,.woff2'; fileIn.hidden = true;
    fileIn.addEventListener('change', async () => { const f = fileIn.files?.[0]; if (f) { const a = await assets.add(f, { name: f.name, source: 'drop' }); void load(a); } fileIn.value = ''; });
    const input = imageInput({ toolId: 'specimen', name: 'Specimen', assets, settings, emit, onLoad: a => void load(a), accepts: () => true });
    srcSec.body.append(stats.el, button({ label: 'Choose a font file', onClick: () => fileIn.click() }), fileIn, note('Drop a TTF, OTF, WOFF or WOFF2 anywhere, or send one from the tray.'));

    const tSec = section('Text');
    const sampleField = field({ label: 'Sample', value: sample, onChange: v => { sample = v || (d.sample as string); settings.set('sample', sample); render(); } });
    tSec.body.append(sampleField.el);

    const fSec = section('OpenType features');
    const featHost = document.createElement('div');
    fSec.body.append(featHost);

    const sSec = section('Type scale');
    const ratioSel = select<string>({ label: 'Ratio', value: String(ratio), options: RATIOS.map(([n, r]) => ({ value: String(r), label: `${n} · ${r}` })), onChange: v => { ratio = Number(v); settings.set('ratio', ratio); render(); } });
    sSec.body.append(ratioSel.el, slider({ label: 'Base size', min: 8, max: 32, value: base, unit: ' px', onChange: v => { base = v; settings.set('base', base); render(); } }).el);

    const gSec = section('Glyph');
    const glyphStats = statList();
    gSec.body.append(glyphStats.el, note('Click a glyph in the grid.'));

    const oSec = section('Export');
    const oRow = document.createElement('div'); oRow.className = 'l-row';
    oRow.append(button({ label: 'Specimen PDF', primary: true, onClick: () => void exportPdf() }), button({ label: 'CSS scale tokens', onClick: () => void exportCss() }));
    const send = sendControl({ from: 'specimen', type: () => (source ? source.type || 'font/ttf' : null), get: async () => source ?? null, emit });
    oSec.body.append(oRow, note('The PDF draws every glyph from the font’s own outlines, so it needs no font installed to print.'), send.el);
    const advSec = advancedSection();
    advSec.body.append(
      field({ label: 'Pangram', value: d.pangram as string, onChange: v => { (d as Record<string, unknown>).pangram = v || d.pangram; render(); } }).el,
      slider({ label: 'Glyph cell', min: 32, max: 160, value: d.glyphCell as number, unit: ' px', onChange: v => { (d as Record<string, unknown>).glyphCell = v; render(); } }).el,
      slider({ label: 'Max glyphs shown', min: 50, max: 10000, step: 50, value: d.maxGlyphs as number, onChange: v => { (d as Record<string, unknown>).maxGlyphs = v; render(); } }).el,
      select<string>({ label: 'PDF page', value: d.pdfPage as string, options: ['A4 landscape', 'A4 portrait', 'Letter landscape', 'Letter portrait'].map(v => ({ value: v, label: v })), onChange: v => { (d as Record<string, unknown>).pdfPage = v; } }).el,
    );
    inspector.append(srcSec.el, tSec.el, fSec.el, sSec.el, gSec.el, advSec.el, oSec.el);

    /* ---------------- load ---------------- */
    async function load(a: Asset) {
      if (!isFont(a)) { emit('toast', `Specimen takes font files (TTF, OTF, WOFF, WOFF2), not ${a.name}`); return; }
      source = a;
      statusbar.set({ name: a.name, bytes: a.size, state: 'Reading font' });
      try {
        info = await readFont(await a.blob.arrayBuffer(), a.name);
        on = new Set([...on].filter(t => info!.features.includes(t)));
        stats.set([['Family', info.family], ['Style', info.style], ['Format', info.format], ['Glyphs', String(info.glyphs)], ['Units per em', String(info.upm)], ['File', formatBytes(a.size)]]);
        statusbar.set({ name: a.name, bytes: a.size, state: `${info.family} ${info.style} · ${info.glyphs} glyphs · ${info.features.length} features` });
        renderFeatures(); render(); send.refresh();
      } catch (e) {
        console.warn('[specimen]', e);
        emit('toast', `Could not read ${a.name}: ${e instanceof Error ? e.message : e}`);
      }
    }

    /* ---------------- views ---------------- */
    const ffs = () => [...on].map(t => `"${t}" 1`).join(', ') || 'normal';
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const live = (text: string, px: number, cls = 'sp-live') => { const e = el('div', cls, text); e.style.fontFamily = `"${info!.cssFamily}"`; e.style.fontSize = `${px}px`; e.style.fontFeatureSettings = ffs(); return e; };
    function render() {
      viewChips.set(view);
      if (!info) { body.replaceChildren(el('p', 'sp__empty', 'Drop a font file (TTF, OTF, WOFF or WOFF2) to see its glyphs, metrics, features and a type scale.')); return; }
      body.replaceChildren(({ overview, glyphs, waterfall, features, scale } as Record<View, () => HTMLElement>)[view]());
    }
    function overview() {
      const f = info!;
      const wrap = el('div', 'sp-ov');
      const head = el('div', 'sp-ov__head');
      head.append(el('h2', 'sp-ov__name', `${f.family}`), el('p', 'sp-ov__meta', [f.style, f.weight ? `weight ${f.weight}` : '', f.format, f.version ?? '', f.designer ? `by ${f.designer}` : ''].filter(Boolean).join(' · ')));
      wrap.append(head, live('Aa', 220, 'sp-ov__aa'), live(sample, 40, 'sp-ov__sample'), metricsSvg());
      const m = statList([['Ascender', String(f.ascender)], ['Cap height', f.capHeight == null ? '—' : String(f.capHeight)], ['x-height', f.xHeight == null ? '—' : String(f.xHeight)], ['Descender', String(f.descender)], ['Line gap', String(f.lineGap)], ['Units per em', String(f.upm)]]);
      m.el.classList.add('sp-ov__stats');
      wrap.append(m.el);
      if (f.license) wrap.append(el('p', 'sp-ov__license', f.license.slice(0, 400)));
      return wrap;
    }
    function metricsSvg(): HTMLElement {
      const f = info!, size = 220, k = size / f.upm, text = 'Hxgp';
      const width = textWidth(f.font, text, size) + 40;
      const top = f.ascender * k + 20, H = (f.ascender - f.descender) * k + 40;
      const p = textPathData(f.font, text, 20, top, size);
      const line = (v: number | null, label: string) => v == null ? '' : `<line x1="0" x2="${width + 160}" y1="${top - v * k}" y2="${top - v * k}" class="sp-m__line"/><text x="${width + 8}" y="${top - v * k - 4}" class="sp-m__label">${label} ${v}</text>`;
      const box = el('div', 'sp-metrics');
      box.innerHTML = `<svg viewBox="0 0 ${width + 160} ${H}" class="sp-m" role="img" aria-label="Vertical metrics of ${f.family}"><path d="${p}" class="sp-m__glyphs"/>${line(f.ascender, 'Ascender')}${line(f.capHeight, 'Cap height')}${line(f.xHeight, 'x-height')}${line(0, 'Baseline')}${line(f.descender, 'Descender')}</svg>`;
      return box;
    }
    function glyphs() {
      const f = info!, cell = d.glyphCell as number, n = Math.min(f.glyphs, d.maxGlyphs as number);
      const grid = el('div', 'sp-glyphs'); grid.style.setProperty('--cell', `${cell}px`);
      const k = (cell * 0.62) / f.upm, base = cell * 0.72;
      for (let i = 0; i < n; i++) {
        const g = f.font.glyphs.get(i);
        const b = el('button', 'sp-glyph') as HTMLButtonElement; b.type = 'button'; b.dataset.index = String(i);
        const adv = (g.advanceWidth ?? f.upm / 2) * k;
        const pathD = g.getPath((cell - adv) / 2, base, cell * 0.62).toPathData(1);
        b.innerHTML = `<svg viewBox="0 0 ${cell} ${cell}" aria-hidden="true"><path d="${pathD}"/></svg>`;
        const lab = el('span', 'sp-glyph__u', g.unicode != null ? `U+${g.unicode.toString(16).toUpperCase().padStart(4, '0')}` : (g.name ?? `#${i}`));
        b.append(lab);
        b.title = `${g.name ?? ''} ${g.unicode != null ? String.fromCodePoint(g.unicode) : ''}`.trim();
        b.addEventListener('click', () => {
          grid.querySelectorAll('.is-active').forEach(x => x.classList.remove('is-active')); b.classList.add('is-active');
          glyphStats.set([['Index', String(i)], ['Name', g.name ?? '—'], ['Unicode', g.unicodes.length ? g.unicodes.map(u => `U+${u.toString(16).toUpperCase().padStart(4, '0')}`).join(', ') : '—'], ['Character', g.unicode != null ? String.fromCodePoint(g.unicode) : '—'], ['Advance', String(g.advanceWidth ?? '—')]]);
        });
        grid.append(b);
      }
      const wrap = el('div', 'sp-gl');
      wrap.append(el('p', 'sp__caption', `${n} of ${f.glyphs} glyphs, drawn from the font’s outlines.`), grid);
      return wrap;
    }
    function waterfall() {
      const wrap = el('div', 'sp-wf');
      for (const px of d.waterfall as number[]) {
        const row = el('div', 'sp-wf__row');
        row.append(el('span', 'sp-wf__size', `${px}`), live(sample, px, 'sp-live sp-wf__text'));
        wrap.append(row);
      }
      wrap.append(el('div', 'sp-wf__gap'));
      for (const px of [24, 16]) { const row = el('div', 'sp-wf__row'); row.append(el('span', 'sp-wf__size', `${px}`), live(d.pangram as string, px, 'sp-live sp-wf__text')); wrap.append(row); }
      return wrap;
    }
    function features() {
      const f = info!;
      const wrap = el('div', 'sp-ft');
      if (!f.features.length) { wrap.append(el('p', 'sp__empty', 'This font has no OpenType layout features.')); return wrap; }
      for (const t of f.features) {
        const row = el('div', 'sp-ft__row'); row.dataset.tag = t;
        const txt = FEATURE_SAMPLE[t] ?? sample;
        const off = live(txt, 28, 'sp-live sp-ft__sample'); off.style.fontFeatureSettings = `"${t}" 0`;
        const onEl = live(txt, 28, 'sp-live sp-ft__sample'); onEl.style.fontFeatureSettings = `"${t}" 1`;
        row.append(el('span', 'sp-ft__tag', t), el('span', 'sp-ft__name', FEATURE_NAMES[t] ?? ''), off, onEl);
        wrap.append(row);
      }
      wrap.prepend(el('p', 'sp__caption', 'Each feature off, then on. Toggle features in the inspector to apply them everywhere.'));
      return wrap;
    }
    function scale() {
      const wrap = el('div', 'sp-sc');
      wrap.append(el('p', 'sp__caption', `${RATIOS.find(r => r[1] === ratio)?.[0] ?? 'Ratio'} (${ratio}) from ${base} px.`));
      for (const s of typeScale(base, ratio, d.stepsUp as number, d.stepsDown as number)) {
        const row = el('div', 'sp-sc__row'); row.dataset.step = String(s.step);
        row.append(el('span', 'sp-sc__step', `${s.step}`), el('span', 'sp-sc__px', `${s.px} px · ${(s.px / 16).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} rem`), live(sample, s.px, 'sp-live sp-sc__text'));
        wrap.append(row);
      }
      return wrap;
    }
    function renderFeatures() {
      if (!info?.features.length) { featHost.replaceChildren(note('No features in this font.')); return; }
      featHost.replaceChildren(chips<string>({ multi: true, value: [...on], options: info.features.map(t => ({ value: t, label: t, title: FEATURE_NAMES[t] })),
        onChange: v => { on = new Set(v as string[]); settings.set('features', [...on]); render(); } }).el);
    }

    /* ---------------- export ---------------- */
    const fileBase = () => (source?.name ?? 'font').replace(/\.[^.]+$/, '');
    function cssTokens(): string {
      const f = info!, unit = d.scaleUnit as 'rem' | 'px';
      const steps = typeScale(base, ratio, d.stepsUp as number, d.stepsDown as number);
      const fmt = source?.name.split('.').pop()?.toLowerCase() ?? 'woff2';
      const format = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[fmt] ?? fmt;
      return [
        `/* ${f.family} ${f.style}: type scale from Lathe Specimen. ${RATIOS.find(r => r[1] === ratio)?.[0] ?? 'Ratio'} (${ratio}), base ${base}px. */`,
        '@font-face {', `  font-family: "${f.family}";`, `  src: url("./${source?.name}") format("${format}");`,
        ...(f.weight ? [`  font-weight: ${f.weight};`] : []), `  font-style: ${/italic|oblique/i.test(f.style) ? 'italic' : 'normal'};`, '  font-display: swap;', '}', '',
        ':root {', `  --font-family: "${f.family}", system-ui, sans-serif;`, `  --scale-ratio: ${ratio};`,
        ...steps.map(s => `  --step-${s.step < 0 ? `n${-s.step}` : s.step}: ${unit === 'rem' ? `${+(s.px / 16).toFixed(4)}rem` : `${s.px}px`};${unit === 'rem' ? ` /* ${s.px}px */` : ''}`),
        ...(on.size ? [`  --font-features: ${ffs()};`] : []),
        '}', '',
      ].join('\n');
    }
    async function exportCss() {
      if (!info) { emit('toast', 'Load a font first'); return; }
      await saveExport(new Blob([cssTokens()], { type: 'text/css' }), `${fileBase()}-scale.css`, 'specimen');
    }

    /** Draws font outlines into the PDF as vector paths. */
    function outline(doc: jsPDF, cmds: PathCommand[]) {
      const ops: { op: string; c?: number[] }[] = [];
      for (const c of cubicCommands(cmds)) {
        if (c.type === 'M') ops.push({ op: 'm', c: [c.x!, c.y!] });
        else if (c.type === 'L') ops.push({ op: 'l', c: [c.x!, c.y!] });
        else if (c.type === 'C') ops.push({ op: 'c', c: [c.x1!, c.y1!, c.x2!, c.y2!, c.x!, c.y!] });
        else if (c.type === 'Z') ops.push({ op: 'h' });
      }
      if (ops.length) doc.path(ops, 'F');
    }
    /** Lines of `text` set in the font at `size`, wrapped to `width` (points). */
    function wrapFont(text: string, size: number, width: number): string[] {
      const words = text.split(/\s+/); const out: string[] = []; let cur = '';
      for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (textWidth(info!.font, t, size) > width && cur) { out.push(cur); cur = w; } else cur = t; }
      if (cur) out.push(cur); return out;
    }
    async function exportPdf() {
      if (!info) { emit('toast', 'Load a font first'); return; }
      const f = info;
      statusbar.set({ name: source?.name, state: 'Writing specimen PDF' });
      const pg = d.pdfPage as string;
      const doc = new jsPDF({ unit: 'pt', format: pg.startsWith('A4') ? 'a4' : 'letter', orientation: pg.endsWith('landscape') ? 'landscape' : 'portrait' });
      const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
      const label = (t: string, x: number, y: number, size = 8) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.text(t, x, y); };
      const foot = (n: number) => label(`${f.family} ${f.style} · Lathe Specimen · ${n}`, M, H - 20, 7);
      let page = 1;
      // Cover
      const big = Math.min(160, (W - 2 * M) / Math.max(1e-6, textWidth(f.font, f.family, 1)));
      outline(doc, textCommands(f.font, f.family, M, M + big * 0.9, big));
      label([f.style, f.format, f.version ?? '', f.designer ?? ''].filter(Boolean).join('  ·  '), M, M + big * 0.9 + 28, 10);
      let y = M + big * 0.9 + 80;
      for (const ln of wrapFont(sample, 36, W - 2 * M)) { outline(doc, textCommands(f.font, ln, M, y, 36)); y += 44; }
      y += 12;
      for (const ln of wrapFont(d.pangram as string, 18, W - 2 * M)) { outline(doc, textCommands(f.font, ln, M, y, 18)); y += 24; }
      label(`Ascender ${f.ascender}   Cap height ${f.capHeight ?? '—'}   x-height ${f.xHeight ?? '—'}   Descender ${f.descender}   Units per em ${f.upm}   Glyphs ${f.glyphs}`, M, H - 44, 8);
      foot(page);
      // Waterfall
      doc.addPage(); page++;
      label('Waterfall', M, M, 10); y = M + 20;
      for (const px of d.waterfall as number[]) {
        const pt = px * 0.75; y += pt * 1.2; if (y > H - 40) break;
        label(`${px} px`, M, y, 7);
        let t = sample; while (t.length > 1 && textWidth(f.font, t, pt) > W - 2 * M - 40) t = t.slice(0, -1);
        outline(doc, textCommands(f.font, t, M + 40, y, pt));
        y += 6;
      }
      foot(page);
      // Glyphs
      const cols = Math.floor((W - 2 * M) / 44), cell = (W - 2 * M) / cols, rows = Math.floor((H - 2 * M - 30) / cell);
      const n = Math.min(f.glyphs, d.maxGlyphs as number);
      for (let i = 0; i < n; i++) {
        if (i % (cols * rows) === 0) { doc.addPage(); page++; label(`Glyphs ${i + 1}–${Math.min(n, i + cols * rows)} of ${f.glyphs}`, M, M, 10); foot(page); }
        const k = i % (cols * rows), cx = M + (k % cols) * cell, cy = M + 20 + Math.floor(k / cols) * cell;
        const g = f.font.glyphs.get(i), size = cell * 0.55, adv = (g.advanceWidth ?? f.upm / 2) * size / f.upm;
        doc.setDrawColor(220); doc.setLineWidth(0.3); doc.rect(cx, cy, cell, cell);
        outline(doc, g.getPath(cx + (cell - adv) / 2, cy + cell * 0.68, size).commands);
        if (g.unicode != null) label(g.unicode.toString(16).toUpperCase().padStart(4, '0'), cx + 2, cy + cell - 3, 4.5);
      }
      // Scale
      doc.addPage(); page++;
      label(`Type scale · ${RATIOS.find(r => r[1] === ratio)?.[0] ?? ''} ${ratio} from ${base} px`, M, M, 10); y = M + 16;
      for (const s of typeScale(base, ratio, d.stepsUp as number, d.stepsDown as number)) {
        const pt = s.px * 0.75; y += pt * 1.15; if (y > H - 40) break;
        label(`${s.step}  ${s.px}px`, M, y, 7);
        let t = sample; while (t.length > 1 && textWidth(f.font, t, pt) > W - 2 * M - 70) t = t.slice(0, -1);
        outline(doc, textCommands(f.font, t, M + 70, y, pt)); y += 8;
      }
      foot(page);
      doc.setProperties({ title: `${f.family} ${f.style} specimen`, creator: 'Lathe Specimen' });
      const blob = doc.output('blob');
      await saveExport(blob, `${fileBase()}-specimen.pdf`, 'specimen');
      statusbar.set({ name: source?.name, state: `Specimen PDF: ${page} pages · ${formatBytes(blob.size)}` });
    }

    render();
    return { unmount() { input.off(); }, export: () => void exportPdf() };
  },
};
