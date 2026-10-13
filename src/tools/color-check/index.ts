/* Color-check: WCAG 2.2 / APCA contrast matrix from pasted hex codes.
   Ported from reference/color-check. Matrix on the stage, controls in the inspector. */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import {
  buildReport, buildSvg, fontFaceRule, hexToRgb, matrixHtml, minTierFor, parseColors, repair, score, wcagRatio,
  type Params, type Standard, type Threshold,
} from './engine';
import { button, chips, label, modal, note, section, statList, textarea } from '../../ui/primitives';
import { saveExport } from '../../lib/download';
import './color-check.css';

type FontChoice = string; // a family name, or '__mono'
const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
const FONT_FORMATS: Record<string, string> = { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' };

export const tool: LatheTool = {
  id: 'contrast',
  name: 'Contrast',
  group: 'Workbench',
  defaults,
  accepts: ['text/plain', 'font/*'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const state = {
      input: settings.get('input', ''),
      standard: settings.get<Standard>('standard', d.standard as Standard),
      threshold: settings.get<Threshold>('threshold', d.threshold as Threshold),
      chartFont: settings.get<FontChoice>('chartFont', d.chartFont as string),
      exportFormat: settings.get<'svg' | 'html'>('exportFormat', d.exportFormat as 'svg' | 'html'),
    };
    /** Uploaded chart font, kept as a tray asset so it survives reloads. */
    let uploaded: { family: string; dataUrl: string; format: string } | null = null;
    let fontStyle: HTMLStyleElement | null = null;

    const g = d.gradeColors as Record<'fail' | 'aaLarge' | 'aa' | 'aaa', string>;
    const params = (): Params => ({
      standard: state.standard,
      wcag: { AAA: d.wcagAAA as number, AA: d.wcagAA as number, AALarge: d.wcagAALarge as number },
      apca: { AAA: d.apcaAAA as number, AA: d.apcaAA as number, AALarge: d.apcaAALarge as number },
      repairTarget: d.repairTarget as number,
      repairStep: d.repairStep as number,
      repairMaxSteps: d.repairMaxSteps as number,
      dimOpacity: d.dimOpacity as number,
      grade: [g.fail, g.aaLarge, g.aa, g.aaa],
      exportStroke: d.exportStroke as string,
      exportLabel: d.exportLabel as string,
      fontStack: state.chartFont === '__mono' ? MONO_STACK : `'${state.chartFont}', Helvetica, Arial, sans-serif`,
      fontFaceCss: uploaded && state.chartFont === uploaded.family
        ? fontFaceRule(uploaded.family, uploaded.dataUrl, uploaded.format)
        : '',
    });

    /* ---- stage ---- */
    const root = document.createElement('div');
    root.className = 'cc';
    const wrap = document.createElement('div');
    wrap.className = 'cc__matrix';
    root.appendChild(wrap);
    stage.appendChild(root);

    /* ---- inspector ---- */
    const pal = section('Palette');
    const hex = textarea({ label: 'Hex values', value: state.input, placeholder: 'Paste hex values', rows: 5, onInput: v => { state.input = v; settings.set('input', v); render(); } });
    hex.input.setAttribute('aria-label', 'Hex values');
    const counts = note('');
    pal.body.append(hex.el, counts);

    const std = section('Standard');
    std.body.append(
      chips<Standard>({ label: 'Standard', value: state.standard,
        options: [{ value: 'wcag', label: 'WCAG 2.2' }, { value: 'apca', label: 'APCA WCAG 3' }],
        onChange: v => { state.standard = v as Standard; settings.set('standard', v); render(); } }).el,
      chips<Threshold>({ label: 'Show only', value: state.threshold,
        options: [{ value: 'all', label: 'All' }, { value: 'AALarge', label: 'AA Lg+' }, { value: 'AA', label: 'AA+' }, { value: 'AAA', label: 'AAA' }],
        onChange: v => { state.threshold = v as Threshold; settings.set('threshold', v); render(); } }).el,
    );

    const res = section('Results');
    const stats = statList();
    res.body.append(stats.el);

    const fontSec = section('Chart font');
    const fontFile = document.createElement('input');
    Object.assign(fontFile, { type: 'file', accept: '.ttf,.otf,.woff,.woff2', hidden: true });
    const fontHint = note('');
    const fontOptions = () => [
      { value: d.chartFont as string, label: d.chartFont as string },
      { value: '__mono', label: 'System mono' },
      ...(uploaded ? [{ value: uploaded.family, label: uploaded.family }] : []),
    ];
    let fontChips = chips<string>({ label: 'Family', value: state.chartFont, options: fontOptions(), onChange: v => setFont(v as string) });
    const fontRow = document.createElement('div');
    fontRow.className = 'l-group';
    fontRow.append(fontChips.el);
    fontSec.body.append(fontRow, button({ label: 'Upload font', onClick: () => fontFile.click() }), fontHint, fontFile);
    const rebuildFontChips = () => {
      const next = chips<string>({ label: 'Family', value: state.chartFont, options: fontOptions(), onChange: v => setFont(v as string) });
      fontChips.el.replaceWith(next.el); fontChips = next;
    };

    const out = section('Export');
    const fmt = chips<'svg' | 'html'>({ label: 'Format', value: state.exportFormat,
      options: [{ value: 'svg', label: '.svg' }, { value: 'html', label: '.html' }],
      onChange: v => { state.exportFormat = v as 'svg' | 'html'; settings.set('exportFormat', v); } });
    const exportBtn = button({ label: 'Export', primary: true, onClick: () => void doExport() });
    out.body.append(fmt.el, exportBtn);

    inspector.append(pal.el, std.el, res.el, fontSec.el, out.el);

    /* ---- render ---- */
    function render() {
      const p = params();
      const colors = parseColors(state.input);
      const pairs = colors.length * (colors.length - 1);
      counts.textContent = colors.length ? `${colors.length} colors · ${pairs} pairings` : 'Separate with spaces, commas or new lines. # optional.';
      const s = score(colors, p);
      stats.set([['Pass', String(s.pass)], ['Large only', String(s.large)], ['Fail', String(s.fail)], ['Usable', s.usable]]);
      exportBtn.disabled = !colors.length;
      statusbar.set(colors.length
        ? { name: `${colors.length} colors  ${pairs} pairings`, state: `${s.usable} usable · ${state.standard === 'wcag' ? 'WCAG 2.2' : 'APCA'}` }
        : { state: 'Paste hex values' });
      if (!colors.length) {
        wrap.innerHTML = '<div class="cc__empty">Paste hex codes in the inspector to build the matrix.</div>';
        return;
      }
      wrap.innerHTML = matrixHtml(colors, minTierFor(state.threshold), p, true);
    }

    /* Failing cells open auto-repair (click or Enter). */
    const openFromCell = (td: HTMLElement | null) => { if (td?.dataset.fg && td.dataset.bg) openRepair(td.dataset.fg, td.dataset.bg); };
    wrap.addEventListener('click', e => openFromCell((e.target as HTMLElement).closest<HTMLElement>('td.is-repairable')));
    wrap.addEventListener('keydown', e => { if (e.key === 'Enter') openFromCell((e.target as HTMLElement).closest<HTMLElement>('td.is-repairable')); });

    function openRepair(fg: string, bg: string) {
      const p = params();
      const fgRgb = hexToRgb(fg)!, bgRgb = hexToRgb(bg)!; const orig = wcagRatio(fgRgb, bgRgb);
      const fixFg = repair(fgRgb, bgRgb, p); const fixBg = repair(bgRgb, fgRgb, p);
      const body = document.createElement('div');
      body.className = 'cc-repair';
      const preview = (fgc: string, bgc: string, text: string) => {
        const el = document.createElement('div');
        el.className = 'cc-repair__preview';
        el.style.background = bgc; el.style.color = fgc; el.textContent = text;
        return el;
      };
      body.appendChild(preview(fg, bg, `Current · ${orig.toFixed(2)}`));
      const opt = (lbl: string, nf: string, nb: string, changed: string | null) => {
        if (!changed) return null;
        const r = wcagRatio(hexToRgb(nf)!, hexToRgb(nb)!);
        const el = document.createElement('div');
        el.className = 'cc-repair__opt';
        const hexEl = document.createElement('div'); hexEl.className = 'cc-repair__hex'; hexEl.textContent = changed;
        const ratio = document.createElement('div'); ratio.className = 'cc-repair__ratio'; ratio.textContent = `${r.toFixed(2)} · AA ✓`;
        el.append(label(lbl), preview(nf, nb, 'Aa'), hexEl, ratio,
          button({ label: 'Copy hex', onClick: () => { void navigator.clipboard.writeText(changed).then(() => emit('toast', `${changed} copied`), () => emit('toast', 'Copy blocked by the browser')); } }));
        return el;
      };
      const opts = [opt('Shift foreground', fixFg || fg, bg, fixFg), opt('Shift background', fg, fixBg || bg, fixBg)].filter(Boolean) as HTMLElement[];
      if (opts.length) { const grid = document.createElement('div'); grid.className = 'cc-repair__grid'; grid.append(...opts); body.appendChild(grid); }
      else body.appendChild(note('No nearby lightness shift reaches AA. These hues are too close.'));
      modal({ title: `Auto-repair · ${orig.toFixed(2)} → ${p.repairTarget}`, body });
    }

    /* ---- fonts ---- */
    function setFont(v: string) {
      state.chartFont = v; settings.set('chartFont', v);
      fontHint.textContent = uploaded && v === uploaded.family ? `Embedded ${uploaded.family}. Travels inside the SVG.` : '';
      render();
    }
    async function useFontAsset(a: Asset, select: boolean) {
      const ext = a.name.split('.').pop()!.toLowerCase();
      const format = FONT_FORMATS[ext] ?? 'truetype';
      const family = a.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9 _-]/g, '') || 'Custom Font';
      const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(a.blob); });
      uploaded = { family, dataUrl, format };
      fontStyle ??= document.head.appendChild(document.createElement('style'));
      fontStyle.textContent = fontFaceRule(family, dataUrl, format);
      settings.set('fontAsset', a.id);
      rebuildFontChips();
      if (select) setFont(family); else render();
    }
    fontFile.addEventListener('change', async () => {
      const f = fontFile.files?.[0]; fontFile.value = '';
      if (!f) return;
      const a = await assets.add(f, { source: 'drop' });
      await useFontAsset(a, true);
    });

    /* ---- export ---- */
    async function doExport() {
      const colors = parseColors(state.input);
      if (!colors.length) { emit('toast', 'Paste hex values first'); return; }
      const n = settings.get<number>('exportSeq', 0) + 1;
      settings.set('exportSeq', n);
      const p = params();
      const [text, type, ext] = state.exportFormat === 'html'
        ? [buildReport(colors, state.threshold, p), 'text/html', 'html']
        : [buildSvg(colors, state.threshold, p), 'image/svg+xml', 'svg'];
      await saveExport(new Blob([text], { type }), `color-check-${n}.${ext}`, 'contrast');
    }

    /* ---- assets handed to the tool ---- */
    const off = assets.onChange(async e => {
      if (e.type !== 'load' || e.target !== 'contrast') return;
      const a = e.asset;
      if (a.type.startsWith('font/') || /\.(ttf|otf|woff2?)$/i.test(a.name)) { await useFontAsset(a, true); return; }
      if (a.type.startsWith('text/')) {
        state.input = await a.blob.text(); hex.input.value = state.input; settings.set('input', state.input); render(); return;
      }
      emit('toast', `Contrast takes hex lists or fonts, not ${a.type || 'this file'}`);
    });

    const savedFont = assets.get(settings.get<string>('fontAsset', ''));
    if (savedFont) void useFontAsset(savedFont, false);
    render();

    return {
      unmount() { off(); fontStyle?.remove(); },
      export: () => void doExport(),
    };
  },
};
