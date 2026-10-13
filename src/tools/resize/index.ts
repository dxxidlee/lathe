/* Resize (Layout): adaptive resizing, Bannerflow-style. Drop an Illustrator SVG whose layer names
   carry rules (`logo [anchor:tl, scale:0.3-1]`), list the sizes, and every variant renders live;
   typing in a text field updates them all, and variants whose text overflows are flagged.
   Phase 1: parser, rules, text fields, batch grid. No export yet. The engine is
   src/lib/resize-engine (no DOM); this file is only its interface. */
import type { Asset, LatheTool } from '../types';
import { defaults, PRESETS, SAMPLES } from './defaults';
import { button, note, section, statList, textarea } from '../../ui/primitives';
import {
  approxShaper, layoutToSVG, newMaster, newProject, parse, parseSizes, ratioLabel, render, sizesToText, valuesFor, withSizes,
  type Breakpoint, type Layout, type Master, type Project, type Shaper,
} from '../../lib/resize-engine';
import type { LoadedFont } from '../../lib/resize-engine/shaper';
import headlineCta from '../../../fixtures/headline-cta.svg?raw';
import logoLockup from '../../../fixtures/logo-lockup.svg?raw';
import tiledPattern from '../../../fixtures/tiled-pattern.svg?raw';
import interUrl from '../../../fixtures/fonts/inter-latin.ttf?url';
import './resize.css';

const SAMPLE_SVG: Record<(typeof SAMPLES)[number], { svg: string; name: string; label: string }> = {
  'headline-cta': { svg: headlineCta, name: 'headline-cta.svg', label: 'Headline + CTA' },
  'logo-lockup': { svg: logoLockup, name: 'logo-lockup.svg', label: 'Logo lockup' },
  'tiled-pattern': { svg: tiledPattern, name: 'tiled-pattern.svg', label: 'Tiled pattern' },
};
const FONT_FILE = /\.(ttf|otf|ttc|woff2?)$/i;
const isFont = (a: { type: string; name: string }) => a.type.startsWith('font/') || /font/.test(a.type) || FONT_FILE.test(a.name);
/** Faces registered for drawing, kept for the session so remounting doesn't reload them. */
const registered = new Map<string, FontFace>();

async function sfnt(blob: Blob): Promise<ArrayBuffer> {
  const bytes = await blob.arrayBuffer();
  const sig = String.fromCharCode(...new Uint8Array(bytes, 0, 4));
  if (sig === 'wOF2') {
    const { default: decompress } = await import('woff2-encoder/decompress');
    const out = await decompress(new Uint8Array(bytes));
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  }
  if (sig === 'wOFF') throw new Error('WOFF (version 1) isn’t supported; use TTF, OTF or WOFF2');
  return bytes;
}

export const tool: LatheTool = {
  id: 'resize',
  name: 'Resize',
  group: 'Workbench',
  defaults,
  accepts: ['image/svg+xml', 'font/*', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    let project: Project = settings.get<Project | null>('project', null) ?? newProject('Resize');
    const doc = () => project.masters[0] ?? null;
    const set = () => doc()?.sizeSets[0] ?? null;
    let master: Master | null = null;
    let shaper: Shaper = approxShaper();
    let fonts: LoadedFont[] = [];
    let fontsReady = false;
    let layouts: { id: string; layout: Layout }[] = [];
    let saveTimer = 0;
    const save = (soon = false) => {
      clearTimeout(saveTimer);
      const go = () => { project.updatedAt = Date.now(); settings.set('project', project); };
      if (soon) saveTimer = window.setTimeout(go, 300); else go();
    };
    const parseOpts = () => ({ lineHeight: d.lineHeight as number, breakpoints: d.breakpoints as Breakpoint[] });

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'rz';
    const grid = document.createElement('div'); grid.className = 'rz__grid';
    root.append(grid); stage.appendChild(root);
    const cards = new Map<string, { fig: HTMLElement; art: HTMLElement; meta: HTMLElement; flags: HTMLElement }>();

    /* ---------------- inspector ---------------- */
    const fileIn = Object.assign(document.createElement('input'), { type: 'file', accept: '.svg,image/svg+xml,.ttf,.otf,.ttc,.woff2', multiple: true, hidden: true });
    fileIn.addEventListener('change', () => { void takeFiles([...fileIn.files ?? []]); fileIn.value = ''; });
    const mSec = section('Master');
    const mStats = statList();
    const warnBox = document.createElement('div'); warnBox.style.display = 'contents';
    const sampleRow = document.createElement('div'); sampleRow.className = 'l-row';
    for (const k of SAMPLES) sampleRow.append(button({ label: SAMPLE_SVG[k].label, onClick: () => loadSvg(SAMPLE_SVG[k].svg, SAMPLE_SVG[k].name) }));
    mSec.body.append(button({ label: 'Upload SVG', primary: true, onClick: () => { fileIn.accept = '.svg,image/svg+xml'; fileIn.click(); } }),
      note('Or drop an SVG anywhere. Samples:'), sampleRow, mStats.el, warnBox, fileIn);

    const sSec = section('Sizes');
    const sizeText = textarea({ label: 'One w×h per line', value: '', rows: 6, onInput: v => setSizes(v) });
    const sizeNote = note('');
    const presetRow = document.createElement('div'); presetRow.className = 'l-row';
    for (const p of d.presets as typeof PRESETS) presetRow.append(button({ label: p.ratio, title: `Add ${p.w}×${p.h}`, onClick: () => addSize(p.w, p.h) }));
    sSec.body.append(presetRow, sizeText.el, sizeNote);

    const fSec = section('Text fields');
    fSec.el.classList.add('rz-fields');
    const fieldEls = new Map<string, { input: HTMLTextAreaElement; state: HTMLElement }>();

    const tSec = section('Fonts');
    const fontList = document.createElement('ul'); fontList.className = 'rz-fonts';
    tSec.body.append(fontList, button({ label: 'Add font files', onClick: () => { fileIn.accept = '.ttf,.otf,.ttc,.woff2'; fileIn.click(); } }),
      note('Text is measured with HarfBuzz on these files, so line breaks match in every browser. Missing fonts use Inter.'));
    inspector.append(mSec.el, sSec.el, fSec.el, tSec.el);

    /* ---------------- loading ---------------- */
    function loadSvg(svg: string, name: string, keepDoc = false) {
      let m: Master;
      try { m = parse(svg, parseOpts()); }
      catch (e) { emit('toast', `Couldn’t read ${name}: ${e instanceof Error ? e.message : e}`); return; }
      master = m;
      if (!keepDoc) {
        const sizes = set()?.variants.map(v => v.size) ?? parseSizes(d.sizes as string).sizes;
        project = { ...project, masters: [newMaster(name, svg, sizes)] };
        save();
      }
      buildMaster(); buildFields(); buildFonts(); buildCards(); renderAll();
    }
    async function takeFiles(files: File[]) {
      for (const f of files) await take(await assets.add(f, { source: 'drop' }));
    }
    async function take(a: Asset) {
      if (a.type === 'image/svg+xml' || /\.svg$/i.test(a.name)) loadSvg(await a.blob.text(), a.name);
      else if (isFont(a)) {
        const ids = settings.get<string[]>('fontAssets', []);
        if (!ids.includes(a.id)) settings.set('fontAssets', [...ids, a.id]);
        await setupFonts();
      } else emit('toast', `Resize takes an SVG or font files, not ${a.type || a.name}`);
    }
    const off = assets.onChange(e => { if (e.type === 'load' && e.target === 'resize') void take(e.asset); });

    async function setupFonts() {
      const { createShaper, loadFonts } = await import('../../lib/resize-engine/shaper');
      const list: LoadedFont[] = [];
      try { list.push(...loadFonts(await (await fetch(interUrl)).arrayBuffer())); } catch (e) { console.error('Stand-in font', e); }
      for (const id of settings.get<string[]>('fontAssets', [])) {
        const a = assets.get(id);
        if (!a) continue;
        try { list.push(...loadFonts(await sfnt(a.blob))); }
        catch (e) { emit('toast', `${a.name}: ${e instanceof Error ? e.message : e}`); }
      }
      await Promise.all(list.map(async f => {
        const k = `${f.css}|${f.key}`;
        if (registered.has(k)) return;
        const face = new FontFace(f.css, f.data as Uint8Array<ArrayBuffer>, { weight: f.wght ? `${f.wght.min} ${f.wght.max}` : String(f.weight), style: f.italic ? 'italic' : 'normal' });
        try { await face.load(); document.fonts.add(face); registered.set(k, face); } catch { /* drawing falls back; measuring still works */ }
      }));
      fonts = list; shaper = list.length ? createShaper(list) : approxShaper(); fontsReady = true;
      buildFonts(); renderAll();
    }

    /* ---------------- sizes ---------------- */
    function setSizes(text: string) {
      const s = set(); if (!s) return;
      const { sizes, errors } = parseSizes(text);
      sizeNote.textContent = errors.join(' · ');
      project.masters[0].sizeSets[0] = withSizes(s, sizes);
      save(true); buildCards(); renderAll();
    }
    function addSize(w: number, h: number) {
      const s = set(); if (!s) { emit('toast', 'Load an SVG first'); return; }
      if (s.variants.some(v => v.size.w === w && v.size.h === h)) { emit('toast', `${w}×${h} is already in the list`); return; }
      project.masters[0].sizeSets[0] = withSizes(s, [...s.variants.map(v => v.size), { w, h }]);
      save(); sizeText.input.value = sizesToText(set()!.variants.map(v => v.size)); buildCards(); renderAll();
    }

    /* ---------------- building ---------------- */
    function buildMaster() {
      const m = master, dc = doc();
      mStats.set(m && dc ? [
        ['File', dc.fileName],
        ['Artboard', `${m.width}×${m.height}`],
        ['Layers placed', String(m.units.length)],
        ['Text fields', String(m.fields.length)],
        ['Breakpoints', m.breakpoints.map(b => `${b.id} ${b.min ?? 0}–${b.max ?? '∞'}`).join(', ')],
      ] : [['File', '—']]);
      warnBox.replaceChildren(...(m?.warnings ?? []).map(w => Object.assign(document.createElement('p'), { className: 'rz-warn', textContent: w.message })));
      sizeText.input.value = sizesToText(set()?.variants.map(v => v.size) ?? []);
    }
    function buildFields() {
      fieldEls.clear();
      const m = master, s = set();
      if (!m || !s) { fSec.body.replaceChildren(note('Load an SVG.')); return; }
      if (!m.fields.length) { fSec.body.replaceChildren(note('No text fields. Name a live text layer with [text:fieldId] to make it editable.')); return; }
      fSec.body.replaceChildren(...m.fields.map(f => {
        const rules = [f.fit.length ? `fit ${f.fit.join(' + ')}` : 'no fit rule', f.min ? `min ${f.min}px` : '', f.lines ? `${f.lines} lines` : ''].filter(Boolean).join(' · ');
        const t = textarea({ label: `${f.label} · ${rules}`, value: s.fieldValues[f.id] ?? f.value, rows: Math.max(1, f.lines ?? f.value.split('\n').length), onInput: v => {
          set()!.fieldValues[f.id] = v; renderAll(); save(true);
        } });
        t.input.dataset.field = f.id;
        const state = document.createElement('div'); state.className = 'rz-field__state';
        fieldEls.set(f.id, { input: t.input, state });
        t.el.append(state);
        return t.el;
      }), button({ label: 'Reset to the file’s text', onClick: () => {
        set()!.fieldValues = {}; save(); buildFields(); renderAll();
      } }));
    }
    function buildFonts() {
      const m = master;
      if (!m) { fontList.replaceChildren(); return; }
      fontList.replaceChildren(...m.fonts.map(req => {
        const li = document.createElement('li');
        const r = fontsReady ? shaper.resolve(req) : null;
        const name = req.postscript ?? `${req.family} ${req.weight}`;
        li.append(Object.assign(document.createElement('span'), { textContent: name }),
          Object.assign(document.createElement('span'), { className: r && !r.exact ? 'is-missing' : '', textContent: !r ? 'Loading…' : r.exact ? `${fonts.find(f => f.css === r.css)?.family ?? r.css} ${r.weight}` : 'Missing · using Inter' }));
        return li;
      }));
      if (!m.fonts.length) fontList.append(Object.assign(document.createElement('li'), { textContent: 'No live text.' }));
    }
    function buildCards() {
      cards.clear();
      const s = set();
      if (!master || !s) { grid.replaceChildren(Object.assign(document.createElement('div'), { className: 'rz__empty', textContent: 'Drop a tagged SVG, or pick a sample in the inspector.' })); return; }
      if (!s.variants.length) { grid.replaceChildren(Object.assign(document.createElement('div'), { className: 'rz__empty', textContent: 'Add sizes in the inspector, one w×h per line.' })); return; }
      grid.replaceChildren(...s.variants.map(v => {
        const fig = document.createElement('figure'); fig.className = 'rz-card'; fig.dataset.variant = `${v.size.w}x${v.size.h}`;
        fig.style.width = `min(100%, calc(var(--rz-h) * ${v.size.w / v.size.h}))`;
        const art = document.createElement('div'); art.className = 'rz-card__art'; art.style.aspectRatio = `${v.size.w} / ${v.size.h}`;
        const cap = document.createElement('figcaption'); cap.className = 'rz-card__cap';
        const meta = Object.assign(document.createElement('span'), { className: 'rz-card__meta' });
        const flags = Object.assign(document.createElement('div'), { className: 'rz-card__flags' });
        cap.append(Object.assign(document.createElement('span'), { className: 'rz-card__size', textContent: `${v.size.w}×${v.size.h}` }), meta, flags);
        fig.append(art, cap);
        cards.set(v.id, { fig, art, meta, flags });
        return fig;
      }));
    }

    /* ---------------- render ---------------- */
    function renderAll() {
      const m = master, s = set();
      if (!m || !s) { status(); return; }
      layouts = s.variants.map(v => ({ id: v.id, layout: render(m, v.size, valuesFor(s, v), { shaper, shrinkFloor: d.shrinkFloor as number, ellipsis: d.ellipsis as string, overrides: v.overrides }) }));
      for (const { id, layout } of layouts) {
        const c = cards.get(id); if (!c) continue;
        const v = s.variants.find(x => x.id === id)!;
        c.art.innerHTML = layoutToSVG(layout, { idPrefix: `rz-${id}` });
        c.fig.classList.toggle('is-overflow', layout.overflow);
        c.meta.textContent = [ratioLabel(v.size), layout.breakpoint].filter(Boolean).join(' · ');
        const label = (f: string) => m.fields.find(x => x.id === f)?.label ?? f;
        const flag = (text: string, cls = '') => Object.assign(document.createElement('span'), { className: `rz-flag ${cls}`, textContent: text });
        c.flags.replaceChildren(
          ...Object.entries(layout.fields).filter(([, r]) => r.overflow).map(([f]) => flag(`${label(f)} overflows`, 'rz-flag--overflow')),
          ...Object.entries(layout.fields).filter(([, r]) => r.truncated && !r.overflow).map(([f]) => flag(`${label(f)} truncated`)),
          ...layout.hidden.map(h => flag(`${h} hidden`)),
        );
        c.fig.title = layout.warnings.map(w => w.message).join('\n');
      }
      for (const f of m.fields) {
        const el = fieldEls.get(f.id); if (!el) continue;
        const shown = layouts.filter(l => l.layout.fields[f.id]);
        const over = shown.filter(l => l.layout.fields[f.id].overflow).length;
        const shrunk = shown.filter(l => l.layout.fields[f.id].status === 'shrunk').length;
        const trunc = shown.filter(l => l.layout.fields[f.id].truncated).length;
        el.state.classList.toggle('is-overflow', over > 0);
        el.state.textContent = !shown.length ? 'Hidden in every size' : [over ? `Overflows in ${over} of ${shown.length}` : `Fits all ${shown.length}`, shrunk ? `shrunk in ${shrunk}` : '', trunc ? `truncated in ${trunc}` : ''].filter(Boolean).join(' · ');
      }
      status();
    }
    function status() {
      const dc = doc();
      if (!master || !dc) { statusbar.set({ name: 'Resize', state: 'no master' }); return; }
      const over = layouts.filter(l => l.layout.overflow).length;
      statusbar.set({ name: dc.fileName, width: master.width, height: master.height, bytes: new Blob([dc.svg]).size,
        state: `${layouts.length} variant${layouts.length === 1 ? '' : 's'}${over ? ` · ${over} overflowing` : ''}${fontsReady ? '' : ' · loading fonts'}` });
    }

    /* ---------------- boot ---------------- */
    const dc = doc();
    if (dc) loadSvg(dc.svg, dc.fileName, true);
    else if (d.sample !== 'none' && SAMPLE_SVG[d.sample as keyof typeof SAMPLE_SVG]) loadSvg(SAMPLE_SVG[d.sample as keyof typeof SAMPLE_SVG].svg, SAMPLE_SVG[d.sample as keyof typeof SAMPLE_SVG].name);
    else { buildMaster(); buildFields(); buildCards(); status(); }
    void setupFonts();

    return () => { off(); clearTimeout(saveTimer); save(); };
  },
};
