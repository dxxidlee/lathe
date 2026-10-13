/* Mesh-gradient: animated mesh gradients, families/variants/palettes, grain, PNG/JPEG/GIF out.
   Ported from reference/mesh-gradient. Canvas + handles on the stage, controls in the inspector.
   gif.js now comes from npm with its worker bundled (the original fetched both from cdnjs). */
import GIF from 'gif.js';
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url';
import type { LatheTool } from '../types';
import { defaults } from './defaults';
import {
  ELEMENTAL, FAMILIES, RATIOS, cl, clone, createEngine, mkStops, ratioN,
  type Controls, type FamKey, type MeshState, type Phase, type Stop,
} from './engine';
import { button, chips, note, section, select, slider } from '../../ui/primitives';
import { saveExport } from '../../lib/download';
import './mesh-gradient.css';

const SVG_NS = 'http://www.w3.org/2000/svg';
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export const tool: LatheTool = {
  id: 'gradient',
  name: 'Gradient',
  group: 'Offcuts',
  defaults,

  mount({ defaults: d, changedDefaults, stage, inspector, statusbar, settings, emit, onActivate }) {
    const PALETTES = d.palettes as Record<string, string[]>;
    const LOOP_S = d.loopSeconds as number;
    if (!(d.palette as string in PALETTES)) d.palette = Object.keys(PALETTES)[0];

    /* ---------- state (persisted) ---------- */
    const saved = settings.get<Partial<MeshState> & { ctl?: Partial<Controls> }>('state', {});
    // A default edited in the Defaults panel replaces the matching working value.
    const DROP: Record<string, (keyof MeshState | `ctl.${keyof Controls}`)[]> = {
      family: ['fam', 'variant'], variant: ['variant'], palette: ['palette', 'base', 'elems'], palettes: ['palette', 'base', 'elems'],
      ratio: ['ratio'], seed: ['seed'], density: ['ctl.den'], angle: ['ctl.ang'], blur: ['ctl.soft'], grain: ['ctl.grain'],
      drift: ['ctl.drift'], cycle: ['ctl.cyc'],
    };
    for (const k of changedDefaults) for (const f of DROP[k] ?? []) {
      if (f.startsWith('ctl.')) { if (saved.ctl) delete saved.ctl[f.slice(4) as keyof Controls]; }
      else delete saved[f as keyof MeshState];
    }
    if (saved.palette && !(saved.palette in PALETTES)) { delete saved.palette; delete saved.base; }
    const S: MeshState = {
      fam: (saved.fam && saved.fam in FAMILIES ? saved.fam : d.family) as FamKey,
      variant: saved.variant ?? (d.variant as string),
      palette: saved.palette ?? (d.palette as string),
      seed: saved.seed ?? (d.seed as number),
      base: saved.base ?? mkStops(PALETTES[d.palette as string]),
      elems: saved.elems ?? {},
      selEl: null,
      ratio: saved.ratio ?? (d.ratio as string),
      cx: saved.cx ?? 0.5, cy: saved.cy ?? 0.5,
    };
    if (!FAMILIES[S.fam].vars.includes(S.variant)) S.variant = FAMILIES[S.fam].vars[0];
    const ctl: Controls = {
      den: d.density as number, ang: d.angle as number, soft: d.blur as number,
      grain: d.grain as number, drift: d.drift as number, cyc: d.cycle as number, ...saved.ctl,
    };
    const PH: Phase = { t: 0, on: false, frame: 0 };
    const engine = createEngine(S, ctl, PH);
    let persistT = 0;
    const persist = () => {
      clearTimeout(persistT);
      persistT = window.setTimeout(() => {
        const { selEl: _sel, ...rest } = S; void _sel;
        settings.set('state', { ...rest, ctl: { ...ctl } });
      }, 200);
    };

    /* ---------- stage ---------- */
    const root = document.createElement('div'); root.className = 'mg';
    const wrap = document.createElement('div'); wrap.className = 'mg__wrap';
    const cv = document.createElement('canvas'); cv.className = 'mg__canvas';
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Gradient preview');
    const ov = document.createElementNS(SVG_NS, 'svg'); ov.setAttribute('class', 'mg__ov');
    wrap.append(cv, ov); root.appendChild(wrap); stage.appendChild(root);
    let cw = 0, ch = 0;

    /* ---------- inspector ---------- */
    const setup = section('Setup');
    const famChips = chips<FamKey>({ label: 'Family', value: S.fam,
      options: (Object.keys(FAMILIES) as FamKey[]).map(k => ({ value: k, label: FAMILIES[k].label })),
      onChange: v => {
        S.fam = v as FamKey; S.variant = FAMILIES[S.fam].vars[0]; S.selEl = null; S.elems = {};
        buildVars(); syncStops(); draw(); persist();
      } });
    const varSel = select<string>({ label: 'Variant', value: S.variant, options: [],
      onChange: v => { S.variant = v; S.selEl = null; S.elems = {}; syncStops(); draw(); persist(); } });
    const ratioChips = chips<string>({ label: 'Ratio', value: S.ratio, options: RATIOS.map(r => ({ value: r, label: r })),
      onChange: v => { S.ratio = v as string; draw(); persist(); } });
    setup.body.append(famChips.el, varSel.el, ratioChips.el);

    const pal = section('Palette');
    const palSel = select<string>({ label: 'Palette', value: S.palette,
      options: Object.keys(PALETTES).map(k => ({ value: k, label: sentence(k) })),
      onChange: v => {
        S.palette = v;
        const st = mkStops(PALETTES[v]);
        if (S.selEl != null) S.elems[S.selEl] = st; else { S.base = st; S.elems = {}; }
        syncStops(); draw(); persist();
      } });
    const stops = document.createElement('div'); stops.className = 'l-row';
    const stopsNote = note('');
    pal.body.append(palSel.el, stops, stopsNote);

    const mkSlider = (label: string, key: keyof Controls, min: number, max: number, step = 1) => slider({
      label, min, max, step, value: ctl[key],
      onChange: v => { ctl[key] = v; if (!PH.on) draw(); persist(); },
    });
    const sliders = {
      den: mkSlider('Density', 'den', 1, 12, .5), ang: mkSlider('Angle', 'ang', 0, 360),
      soft: mkSlider('Blur', 'soft', 0, 100), grain: mkSlider('Grain', 'grain', 0, 100),
      drift: mkSlider('Drift', 'drift', 0, 100), cyc: mkSlider('Cycle', 'cyc', 0, 3),
    };
    const form = section('Form');
    form.body.append(sliders.den.el, sliders.ang.el);
    const finish = section('Finish');
    finish.body.append(sliders.soft.el, sliders.grain.el);
    const motion = section('Motion');
    const playBtn = button({ label: 'Play', onClick: () => togglePlay() });
    motion.body.append(sliders.drift.el, sliders.cyc.el, playBtn);

    const out = section('Export');
    const row = document.createElement('div'); row.className = 'l-row';
    const gifBtn = button({ label: '.gif', onClick: () => void exportGif() });
    row.append(
      button({ label: '.png', primary: true, onClick: () => exportAt('image/png', 'png') }),
      button({ label: '.jpeg', onClick: () => exportAt('image/jpeg', 'jpeg', (d.jpegQuality as number) / 100) }),
      gifBtn,
      button({ label: 'Randomize', onClick: () => randomize() }),
    );
    const status = note(''); status.setAttribute('role', 'status');
    out.body.append(row, status);
    inspector.append(setup.el, pal.el, form.el, finish.el, motion.el, out.el);

    const setStatus = (s: string) => { status.textContent = s; updateStatusbar(s); };
    function exportSize() {
      const r = ratioN(S.ratio);
      const W = r >= 1 ? (d.exportLandscapeWidth as number) : (d.exportPortraitWidth as number);
      return { W, H: Math.round(W / r) };
    }
    function updateStatusbar(state = PH.on ? 'Playing' : 'Ready') {
      const { W, H } = exportSize();
      statusbar.set({ name: `${S.fam}-${S.variant}  ${S.ratio}  seed ${S.seed}`, width: W, height: H, state });
    }

    /* ---------- UI build ---------- */
    function buildVars() {
      const list = FAMILIES[S.fam].vars;
      if (!list.includes(S.variant)) S.variant = list[0];
      varSel.setOptions(list.map(v => ({ value: v, label: sentence(v) })), S.variant);
      famChips.set(S.fam);
    }
    function editTarget(): Stop[] {
      if (S.selEl != null) {
        if (!S.elems[S.selEl]) S.elems[S.selEl] = clone(S.base);
        return S.elems[S.selEl];
      }
      return S.base;
    }
    function syncStops() {
      const tgt = editTarget();
      stops.replaceChildren(...tgt.map((o, i) => {
        const inp = document.createElement('input');
        inp.type = 'color'; inp.value = o.color; inp.className = 'l-swatch-input';
        inp.setAttribute('aria-label', `Stop ${i + 1}`);
        inp.addEventListener('input', () => { editTarget()[i].color = inp.value; draw(); persist(); });
        return inp;
      }));
      stopsNote.textContent = S.selEl != null ? `Editing element ${S.selEl + 1}. Click empty space to edit the whole gradient.`
        : ELEMENTAL.includes(S.variant) ? 'Click an element in the preview to recolor it alone.' : '';
    }
    function randomize() {
      const keys = Object.keys(PALETTES);
      S.palette = keys[Math.floor(Math.random() * keys.length)];
      S.base = mkStops(PALETTES[S.palette]);
      S.elems = {}; S.selEl = null;
      S.seed = Math.floor(Math.random() * 999);
      ctl.ang = Math.floor(Math.random() * 360); sliders.ang.set(ctl.ang);
      ctl.den = +(2 + Math.random() * 8).toFixed(1); sliders.den.set(ctl.den);
      S.cx = .3 + Math.random() * .4; S.cy = .3 + Math.random() * .4;
      palSel.set(S.palette); syncStops(); draw(); persist();
    }

    /* ---------- overlay handles ---------- */
    const svgEl = (tag: string, at: Record<string, string | number>) => {
      const e = document.createElementNS(SVG_NS, tag);
      for (const k in at) e.setAttribute(k, String(at[k]));
      return e;
    };
    function drawOverlay() {
      ov.replaceChildren(); ov.setAttribute('width', String(cw)); ov.setAttribute('height', String(ch));
      ov.style.width = cw + 'px'; ov.style.height = ch + 'px';
      if (PH.on) return;
      const ctrl = FAMILIES[S.fam].ctrl[S.variant];
      if (ctrl !== 'none') {
        const cxp = S.cx * cw, cyp = S.cy * ch, len = Math.min(cw, ch) * .32, a = ctl.ang * Math.PI / 180;
        const hx = cxp + Math.cos(a) * len, hy = cyp + Math.sin(a) * len;
        ov.appendChild(svgEl('line', { x1: cxp - Math.cos(a) * len, y1: cyp - Math.sin(a) * len, x2: hx, y2: hy, class: 'mg__axis' }));
        const ah = svgEl('circle', { cx: hx, cy: hy, r: 8, class: 'mg__handle hit' });
        ov.appendChild(ah);
        ov.appendChild(svgEl('circle', { cx: hx, cy: hy, r: 3, class: 'mg__dot' }));
        dragHandle(ah, (px, py) => {
          const ang = (Math.atan2(py - S.cy * ch, px - S.cx * cw) * 180 / Math.PI + 360) % 360;
          ctl.ang = Math.round(ang); sliders.ang.set(ctl.ang); draw(); persist();
        });
        if (ctrl === 'center') {
          const cr = svgEl('circle', { cx: cxp, cy: cyp, r: 9, class: 'mg__center hit' });
          ov.appendChild(cr);
          ov.appendChild(svgEl('circle', { cx: cxp, cy: cyp, r: 2, class: 'mg__dot mg__dot--light' }));
          dragHandle(cr, (px, py) => { S.cx = cl(px / cw); S.cy = cl(py / ch); draw(); persist(); });
        } else ov.appendChild(svgEl('circle', { cx: cxp, cy: cyp, r: 4, class: 'mg__dot mg__dot--light' }));
      }
      if (S.selEl != null && ELEMENTAL.includes(S.variant)) drawElHighlight();
    }
    function drawElHighlight() {
      const v = S.variant, i = S.selEl!, cxp = S.cx * cw, cyp = S.cy * ch;
      const S_ = { class: 'mg__sel' };
      if (v === 'stripes') {
        const D = Math.round(ctl.den), span = Math.hypot(cw, ch) * 1.15, bh = span / D, y = -span / 2 + i * bh;
        const gp = svgEl('g', { transform: `translate(${cxp} ${cyp}) rotate(${ctl.ang})` });
        gp.appendChild(svgEl('rect', { x: -span / 2, y, width: span, height: bh, ...S_ })); ov.appendChild(gp);
      } else if (v === 'radial') {
        const D = Math.round(ctl.den), R = Math.hypot(cw, ch) * .72;
        ov.appendChild(svgEl('circle', { cx: cxp, cy: cyp, r: (i + 1) / D * R, ...S_ }));
        if (i > 0) ov.appendChild(svgEl('circle', { cx: cxp, cy: cyp, r: i / D * R, ...S_ }));
      } else {
        const e = engine.layout(cw, ch).find(el => el.i === i); if (!e) return;
        if (e.kind === 'circle') ov.appendChild(svgEl('circle', { cx: e.cx, cy: e.cy, r: e.r, ...S_ }));
        else if (e.kind === 'rect') ov.appendChild(svgEl('rect', { x: e.x, y: e.y, width: e.w, height: e.h, ...S_ }));
      }
    }
    function dragHandle(el: Element, onMove: (x: number, y: number) => void) {
      el.addEventListener('pointerdown', ev => {
        const e = ev as PointerEvent;
        e.preventDefault(); e.stopPropagation();
        const rect = cv.getBoundingClientRect();
        const mv = (m: PointerEvent) => onMove(m.clientX - rect.left, m.clientY - rect.top);
        const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
        document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
      });
    }
    cv.addEventListener('pointerdown', e => {
      if (PH.on || !ELEMENTAL.includes(S.variant)) return;
      const r = cv.getBoundingClientRect(), i = engine.hitTest(e.clientX - r.left, e.clientY - r.top, cw, ch);
      if (i == null) { if (S.selEl != null) { S.selEl = null; syncStops(); draw(); } return; }
      S.selEl = i;
      if (!S.elems[i]) S.elems[i] = clone(S.base);
      syncStops(); draw();
    });

    /* ---------- stills export ---------- */
    function exportAt(type: string, ext: string, q?: number) {
      const { W, H } = exportSize();
      const r = ratioN(S.ratio);
      const off = document.createElement('canvas');
      engine.renderGrad(off, W, H, r >= 1 ? W : H);
      off.toBlob(b => {
        if (!b) { emit('toast', 'Could not encode the image'); return; }
        void saveExport(b, `${S.fam}-${S.variant}-${S.ratio.replace(':', 'x')}-${S.seed}.${ext}`, 'gradient');
        setStatus(`Exported ${W}×${H} .${ext}`);
      }, type, q);
      draw();
    }

    /* ---------- animation ---------- */
    let animRAF = 0;
    let tabActive = true;
    const offActivate = onActivate(a => {
      tabActive = a;
      if (a && PH.on && !animRAF) animTick(); // restart animation when tab becomes active
    });
    function animTick() {
      if (!tabActive) { animRAF = 0; return; }
      PH.t = ((performance.now() / 1000) % LOOP_S) / LOOP_S;
      PH.frame++;
      let W = Math.round(cw), H = Math.round(ch);
      const cap = 980; if (W > cap) { const k = cap / W; W = cap; H = Math.round(H * k); }
      engine.renderGrad(cv, W, H, W);
      animRAF = requestAnimationFrame(animTick);
    }
    function togglePlay() {
      if (PH.on) {
        PH.on = false; cancelAnimationFrame(animRAF); animRAF = 0;
        PH.t = 0; playBtn.textContent = 'Play'; draw();
      } else {
        PH.on = true; playBtn.textContent = 'Stop'; drawOverlay(); animTick();
      }
      updateStatusbar();
    }

    /* ---------- gif (gif.js from npm, worker bundled) ---------- */
    async function exportGif() {
      if (gifBtn.disabled) return;
      gifBtn.disabled = true;
      try {
        const fps = d.gifFps as number, F = LOOP_S * fps;
        const r = ratioN(S.ratio), size = d.gifSize as number;
        const W = r >= 1 ? size : Math.round(size * r), H = Math.round(W / r);
        const off = document.createElement('canvas');
        const gif = new GIF({ workers: 2, quality: d.gifQuality as number, width: W, height: H, workerScript: gifWorkerUrl });
        const wasOn = PH.on; PH.on = true;
        for (let f = 0; f < F; f++) {
          PH.t = f / F; PH.frame = f;
          engine.renderGrad(off, W, H, W);
          gif.addFrame(off, { copy: true, delay: 1000 / fps });
          if (f % 5 === 0) { setStatus(`Rendering frames ${f + 1}/${F}`); await new Promise(r => setTimeout(r)); }
        }
        PH.on = wasOn; if (!wasOn) { PH.t = 0; draw(); }
        setStatus('Encoding GIF…');
        gif.on('progress', (p: number) => setStatus(`Encoding GIF ${Math.round(p * 100)}%`));
        gif.on('finished', (b: Blob) => {
          void saveExport(b, `${S.fam}-${S.variant}-loop.gif`, 'gradient');
          setStatus('GIF saved'); gifBtn.disabled = false;
        });
        gif.render();
      } catch (err) {
        console.error(err);
        setStatus('GIF export failed: ' + (err instanceof Error ? err.message : String(err)));
        gifBtn.disabled = false;
      }
    }

    /* ---------- draw ---------- */
    function fit() {
      const aW = Math.max(80, root.clientWidth - 48), aH = Math.max(160, root.clientHeight ? root.clientHeight - 48 : Math.min(window.innerHeight * .55, 640));
      const r = ratioN(S.ratio);
      cw = aW; ch = cw / r;
      if (ch > aH) { ch = aH; cw = ch * r; }
      cw = Math.round(cw); ch = Math.round(ch);
      wrap.style.width = cw + 'px'; wrap.style.height = ch + 'px';
      cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    }
    function draw() {
      fit();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let W = Math.round(cw * dpr), H = Math.round(ch * dpr);
      const cap = 1600; if (W > cap) { const k = cap / W; W = cap; H = Math.round(H * k); }
      engine.renderGrad(cv, W, H, W);
      drawOverlay();
      ratioChips.set(S.ratio);
      updateStatusbar();
    }

    buildVars(); syncStops();
    const ro = new ResizeObserver(() => { if (!PH.on) draw(); });
    ro.observe(root);
    draw();

    return {
      unmount() { ro.disconnect(); cancelAnimationFrame(animRAF); PH.on = false; clearTimeout(persistT); offActivate(); },
      export: () => exportAt('image/png', 'png'),
    };
  },
};
