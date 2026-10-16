/* Kinetic-type (Motion): text and a font in; stagger, fall, drift, scramble and dissolve presets with
   duration, stagger, easing and loop; GIF and WebM out. Fonts dropped here (or sent from the tray)
   replace Helvetica Neue for the animation. */
import GIF from 'gif.js';
import gifWorkerUrl from 'gif.js/dist/gif.worker.js?url';
import fixWebmDuration from 'fix-webm-duration';
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { cycle, drawFrame, layout, slots, type Easing, type Letter, type Loop, type Preset, type Spec } from './motion';
import { sendControl } from '../../lib/image-input';
import { saveExport } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { advancedSection, button, chips, note, section, select, slider, statList, textarea } from '../../ui/primitives';
import './kinetic-type.css';

const FONT_EXT = /\.(ttf|otf|woff2?)$/i;

export const tool: LatheTool = {
  id: 'kinetic-type',
  name: 'Kinetic Type',
  group: 'Offcuts',
  defaults,
  accepts: ['font/*', 'text/plain', 'application/font-woff', 'application/x-font-ttf', 'application/x-font-otf', 'application/vnd.ms-opentype'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit, onActivate, requireAuth }) {
    const [cw, ch] = String(d.canvas).split('x').map(Number);
    const s: Spec = {
      text: settings.get('text', d.text as string), font: d.font as string, weight: settings.get('weight', d.weight as number),
      size: settings.get('size', d.size as number), tracking: d.tracking as number, leading: d.leading as number,
      ink: settings.get('ink', d.ink as string), paper: settings.get('paper', d.paper as string),
      w: settings.get('w', cw), h: settings.get('h', ch),
      preset: settings.get<Preset>('preset', d.preset as Preset), duration: settings.get('duration', d.duration as number),
      stagger: settings.get('stagger', d.stagger as number), hold: d.hold as number,
      easing: settings.get<Easing>('easing', d.easing as Easing), loop: settings.get<Loop>('loop', d.loop as Loop),
    };
    let fontName = 'Helvetica Neue';
    let letters: Letter[] = [];
    let playing = true, t0 = performance.now(), paused = 0;
    const fps = d.fps as number;

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'kt';
    const cv = document.createElement('canvas'); cv.className = 'kt__canvas';
    const ctx = cv.getContext('2d')!;
    const scratch = new OffscreenCanvas(1, 1);
    root.append(cv); stage.appendChild(root);

    /* ---------------- inspector ---------------- */
    const set = <K extends keyof Spec>(k: K, v: Spec[K], relayout = false) => { s[k] = v; settings.set(k, v); if (relayout) relay(); restart(); };
    const tSec = section('Text');
    tSec.body.append(textarea({ label: 'Text', value: s.text, rows: 3, onInput: v => set('text', v || ' ', true) }).el);
    const fontStats = statList([['Typeface', fontName]]);
    const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = '.ttf,.otf,.woff,.woff2'; fileIn.hidden = true;
    fileIn.addEventListener('change', async () => { const f = fileIn.files?.[0]; if (f) void useFont(await assets.add(f, { name: f.name, source: 'drop' })); fileIn.value = ''; });
    tSec.body.append(fontStats.el, fileIn,
      button({ label: 'Use a font file', onClick: () => fileIn.click() }),
      slider({ label: 'Size', min: 24, max: 400, value: s.size, unit: ' px', onChange: v => set('size', v, true) }).el);

    const mSec = section('Motion');
    mSec.body.append(
      chips<Preset>({ value: s.preset, options: [{ value: 'stagger', label: 'Stagger' }, { value: 'fall', label: 'Fall' }, { value: 'drift', label: 'Drift' }, { value: 'scramble', label: 'Scramble' }, { value: 'dissolve', label: 'Dissolve' }], onChange: v => set('preset', v as Preset) }).el,
    );

    const lSec = section('Look');
    const colors = document.createElement('div'); colors.className = 'l-row kt-colors';
    const color = (lbl: string, k: 'ink' | 'paper') => {
      const w = document.createElement('label'); w.className = 'kt-color';
      const c = document.createElement('input'); c.type = 'color'; c.className = 'l-swatch-input'; c.value = s[k].toLowerCase(); c.setAttribute('aria-label', lbl);
      c.addEventListener('input', () => set(k, c.value.toUpperCase()));
      w.append(c, document.createTextNode(lbl)); return w;
    };
    colors.append(color('Ink', 'ink'), color('Paper', 'paper'));
    lSec.body.append(colors);

    const advSec = advancedSection();
    advSec.body.append(
      slider({ label: 'Duration', min: 4, max: 100, value: Math.round(s.duration * 10), format: v => `${(v / 10).toFixed(1)} s`, onChange: v => set('duration', v / 10) }).el,
      slider({ label: 'Stagger', min: 0, max: 300, value: Math.round(s.stagger * 1000), format: v => `${v} ms`, onChange: v => set('stagger', v / 1000) }).el,
      select<Easing>({ label: 'Easing', value: s.easing, options: (['linear', 'easeOutCubic', 'easeInOutCubic', 'easeOutBack', 'easeOutBounce'] as Easing[]).map(e => ({ value: e, label: e })), onChange: v => set('easing', v) }).el,
      chips<Loop>({ label: 'Loop', value: s.loop, options: [{ value: 'loop', label: 'Loop' }, { value: 'pingpong', label: 'Ping-pong' }, { value: 'once', label: 'Once' }], onChange: v => set('loop', v as Loop) }).el,
      select<string>({ label: 'Weight', value: String(s.weight), options: [300, 400, 500, 700].map(w => ({ value: String(w), label: String(w) })), onChange: v => set('weight', Number(v), true) }).el,
      select<string>({ label: 'Canvas', value: `${s.w}x${s.h}`, options: ['1080x1080', '1080x1350', '1920x1080', '1080x1920'].map(v => ({ value: v, label: v.replace('x', ' \u00d7 ') })),
        onChange: v => { const [w, h] = v.split('x').map(Number); s.w = w; s.h = h; settings.set('w', w); settings.set('h', h); relay(); restart(); } }).el,
      slider({ label: 'Hold', min: 0, max: 50, value: Math.round(s.hold * 10), format: v => `${(v / 10).toFixed(1)} s`, onChange: v => { s.hold = v / 10; restart(); } }).el,
      slider({ label: 'Tracking', min: -100, max: 300, value: Math.round(s.tracking * 1000), format: v => `${(v / 1000).toFixed(3)} em`, onChange: v => { s.tracking = v / 1000; relay(); restart(); } }).el,
      slider({ label: 'Leading', min: 80, max: 200, value: Math.round(s.leading * 100), format: v => `${(v / 100).toFixed(2)}\u00d7`, onChange: v => { s.leading = v / 100; relay(); restart(); } }).el,
    );

    const pSec = section('Playback');
    const playBtn = button({ label: 'Pause', onClick: () => { playing = !playing; if (playing) t0 = performance.now() - paused * 1000; playBtn.textContent = playing ? 'Pause' : 'Play'; } });
    const scrub = slider({ label: 'Time', min: 0, max: 1000, value: 0, format: v => `${((v / 1000) * cycle(s, slots(letters))).toFixed(2)} s`, onChange: v => { playing = false; playBtn.textContent = 'Play'; paused = (v / 1000) * cycle(s, slots(letters)); draw(paused); } });
    pSec.body.append(playBtn, scrub.el);

    const oSec = section('Export');
    const oRow = document.createElement('div'); oRow.className = 'l-row';
    const gifBtn = button({ label: 'Export GIF', primary: true, onClick: () => void exportGif() });
    const webmBtn = button({ label: 'Export WebM', onClick: () => void exportWebm() });
    oRow.append(gifBtn, webmBtn);
    const oStats = statList();
    let lastBlob: Blob | null = null, lastName = '';
    const send = sendControl({ from: 'kinetic-type', type: () => (lastBlob ? lastBlob.type : null), get: async () => (lastBlob ? assets.add(lastBlob, { name: lastName, source: 'export', origin: 'kinetic-type' }) : null), emit });
    oSec.body.append(oRow, oStats.el, note(`One full cycle at ${fps} fps. GIF ${d.gifWidth} px wide; WebM at the canvas size, recorded in real time.`), send.el, button({ label: 'Save to Library', onClick: async () => { if (requireAuth(() => {})) return;
      const { supabase } = await import('../../lib/supabase');
      if (!supabase) { emit('toast', 'Sign in to save'); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { emit('toast', 'Sign in to save'); return; }
      const { cloudSaveItem } = await import('../../lib/cloud-library');
      await cloudSaveItem(user.id, { type: 'image', name: `Kinetic · ${s.text.slice(0, 20)}`, toolId: 'kinetic-type' });
      emit('toast', 'Saved to Library');
    }}));
    inspector.append(tSec.el, mSec.el, lSec.el, advSec.el, pSec.el, oSec.el);

    /* ---------------- fonts ---------------- */
    const off = assets.onChange(e => {
      if (e.type !== 'load' || e.target !== 'kinetic-type') return;
      if (e.asset.type.startsWith('font/') || FONT_EXT.test(e.asset.name)) void useFont(e.asset);
      else if (e.asset.type.startsWith('text/')) void e.asset.blob.text().then(t => set('text', t.trim().slice(0, 200) || s.text, true));
      else emit('toast', `Kinetic Type takes a font or text, not ${e.asset.type || e.asset.name}`);
    });
    async function useFont(a: Asset) {
      try {
        const family = `LatheKinetic${Date.now().toString(36)}`;
        const face = new FontFace(family, await a.blob.arrayBuffer());
        await face.load(); document.fonts.add(face);
        s.font = `"${family}", ${d.font}`; fontName = a.name.replace(/\.[^.]+$/, '');
        settings.set('fontAsset', a.id);
        fontStats.set([['Typeface', fontName]]);
        relay(); restart();
      } catch (e) { emit('toast', `Could not load ${a.name} as a font`); console.warn(e); }
    }

    /* ---------------- loop ---------------- */
    function relay() {
      cv.width = s.w; cv.height = s.h; scratch.width = s.w; scratch.height = s.h;
      letters = layout(ctx, s);
    }
    const restart = () => { t0 = performance.now(); if (!playing) draw(paused); };
    const draw = (t: number) => drawFrame(ctx, s, letters, t, Math.floor(t * fps), scratch);
    let raf = 0;
    let active = true;
    const offActivate = onActivate(a => {
      active = a;
      if (a && !raf) tick(); // restart when tab becomes active
    });
    const tick = () => {
      if (!active) { raf = 0; return; }
      raf = requestAnimationFrame(tick);
      if (!playing) return;
      const c = cycle(s, slots(letters));
      let t = (performance.now() - t0) / 1000;
      t = s.loop === 'once' ? Math.min(t, c) : t % c;
      paused = t;
      draw(Math.floor(t * fps) / fps); // step at the export frame rate, so the preview matches
      scrub.set(Math.round((t / c) * 1000));
      statusbar.set({ name: fontName, width: s.w, height: s.h, state: `${s.preset} · ${c.toFixed(2)} s cycle · ${s.loop}` });
    };

    /* ---------------- export ---------------- */
    const base = () => `kinetic-${s.preset}-${s.text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/-$/, '')}`;
    async function exportGif() {
      gifBtn.disabled = true;
      try {
        const c = cycle(s, slots(letters)), n = Math.max(1, Math.round(c * fps));
        const W = Math.min(s.w, d.gifWidth as number), H = Math.round(s.h * W / s.w);
        const off = new OffscreenCanvas(s.w, s.h), octx = off.getContext('2d')!;
        const small = document.createElement('canvas'); small.width = W; small.height = H;
        const sctx = small.getContext('2d', { willReadFrequently: true })!;
        const gif = new GIF({ workers: 2, quality: d.gifQuality as number, width: W, height: H, workerScript: gifWorkerUrl, repeat: s.loop === 'once' ? -1 : 0 });
        const lay = layout(octx, s);
        for (let i = 0; i < n; i++) {
          drawFrame(octx, s, lay, i / fps, i, new OffscreenCanvas(s.w, s.h));
          sctx.drawImage(off, 0, 0, W, H);
          gif.addFrame(sctx, { copy: true, delay: Math.round(1000 / fps) });
          if (i % 10 === 0) { statusbar.set({ name: fontName, state: `GIF frame ${i + 1} of ${n}` }); await new Promise(r => setTimeout(r)); }
        }
        const blob = await new Promise<Blob>(res => { gif.on('progress', p => statusbar.set({ name: fontName, state: `Encoding GIF ${Math.round(p * 100)}%` })); gif.on('finished', res); gif.render(); });
        lastBlob = blob; lastName = `${base()}.gif`;
        await saveExport(blob, lastName, 'kinetic-type');
        oStats.set([['GIF', `${W}×${H} · ${n} frames · ${formatBytes(blob.size)}`]]); send.refresh();
      } finally { gifBtn.disabled = false; }
    }
    async function exportWebm() {
      if (typeof MediaRecorder === 'undefined') { emit('toast', 'This browser cannot record WebM'); return; }
      webmBtn.disabled = true;
      const wasPlaying = playing; playing = false;
      try {
        const c = cycle(s, slots(letters));
        const stream = cv.captureStream(fps);
        const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: (d.webmBitrate as number) * 1e6 });
        const chunks: Blob[] = [];
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        const done = new Promise<void>(res => { rec.onstop = () => res(); });
        rec.start(250);
        const start = performance.now();
        await new Promise<void>(res => {
          const step = () => {
            const t = (performance.now() - start) / 1000;
            draw(Math.min(t, c));
            statusbar.set({ name: fontName, state: `Recording WebM ${Math.min(100, Math.round((t / c) * 100))}%` });
            if (t >= c) { res(); return; }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        rec.stop(); await done; stream.getTracks().forEach(tr => tr.stop());
        const raw = new Blob(chunks, { type: 'video/webm' });
        const blob = await fixWebmDuration(raw, Math.round(c * 1000), { logger: false });
        lastBlob = blob; lastName = `${base()}.webm`;
        await saveExport(blob, lastName, 'kinetic-type');
        oStats.set([['WebM', `${s.w}×${s.h} · ${c.toFixed(2)} s · ${formatBytes(blob.size)}`]]); send.refresh();
      } finally { webmBtn.disabled = false; playing = wasPlaying; t0 = performance.now(); }
    }

    // A font kept from last time.
    const saved = assets.get(settings.get<string>('fontAsset', ''));
    relay();
    void document.fonts.ready.then(() => { relay(); if (saved) void useFont(saved); });
    tick();
    return {
      unmount() { cancelAnimationFrame(raf); off(); offActivate(); },
      export: () => void exportGif(),
    };
  },
};
