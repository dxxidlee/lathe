/* Mood-strip: a floating strip of reference images. Drop, paste or link refs; Float keeps them
   above other apps via Document Picture-in-Picture, or a popup window where PiP is missing.
   Ported from reference/mood-strip. Palette extraction (median cut), URL upgrading, drag reorder,
   pop-out and PiP float are the original logic. Changes for Lathe:
   - Images live in the shared asset tray; the board stores references (fixes the restore race,
     no data URLs in storage).
   - Float falls back to a popup window when Document PiP is unavailable (VERIFY.md).
   - "Paste link" is an inspector field instead of prompt(); Clear confirms in a Lathe modal.
   - The Tauri desktop branches are gone (v1 is browser-only). */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { button, field, modal, note, section, statList } from '../../ui/primitives';
import { assetUrl } from '../../lib/assets';
import { downloadBlob } from '../../lib/download';
import './mood-strip.css';

interface Ref {
  id: string; name: string; src: string; assetId?: string;
  palette: string[] | null; palOpen: boolean;
  origin: string | null; upgraded: boolean; hardThumb: boolean;
}
type SavedRef = Omit<Ref, 'palette' | 'palOpen' | 'src'> & { src?: string };

const ICON = {
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.1" fill="currentColor" stroke="none"/><circle cx="9.5" cy="15" r="1.1" fill="currentColor" stroke="none"/></svg>',
  popout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v11"/><path d="M8 11l4 4 4-4"/><path d="M4 19h16"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16"/><path d="M9 6V4h6v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/* ============ COLOR EXTRACTION (median cut) ============ */
type Px = [number, number, number];
function extractPalette(img: HTMLImageElement, n: number, maxSample: number): string[] | null {
  const scale = Math.min(1, maxSample / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, w, h).data; }
  catch { return null; } // tainted canvas (cross-origin)
  const px: Px[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 125) continue;
    px.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!px.length) return null;

  function widestChannel(b: Px[]) {
    let best = 0, bestR = -1;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
      if (hi - lo > bestR) { bestR = hi - lo; best = c; }
    }
    return best;
  }
  function range(b: Px[]) {
    if (!b || !b.length) return -1;
    let m = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255, hi = 0;
      for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
      if (hi - lo > m) m = hi - lo;
    }
    return m;
  }
  const avg = (b: Px[]): Px => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)];
  };
  const lum = (c: Px) => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  const toHex = (c: Px) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

  let boxes: Px[][] = [px];
  while (boxes.length < n) {
    boxes.sort((a, b) => range(b) - range(a));
    const box = boxes.shift();
    if (!box || box.length < 2) { if (box) boxes.push(box); break; }
    const ch = widestChannel(box);
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    boxes.push(box.slice(0, mid), box.slice(mid));
  }
  return boxes.filter(b => b && b.length).map(avg).sort((a, b) => lum(b) - lum(a)).slice(0, n).map(toHex);
}

/* ============ URL UPGRADING ============
   Most sites serve a downscaled thumbnail in the grid and keep the original at a predictable path. */
function upgradeUrl(url: string) {
  let u = url;
  try {
    if (/pinimg\.com/i.test(u)) u = u.replace(/\/\d+x\d*\//, '/originals/');
    else if (/tumblr\.com/i.test(u)) u = u.replace(/_(75|100|250|400|500|540|640)\.(jpe?g|png|gif)/i, '_1280.$2');
    else if (/-\d{2,4}x\d{2,4}\.(jpe?g|png|webp)/i.test(u)) u = u.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp))/i, '$1');
    else if (/squarespace-cdn\.com/i.test(u)) u = u.replace(/\?format=\d+w/i, '?format=2500w');
    else if (/cdn\.shopify\.com/i.test(u)) u = u.replace(/_(pico|icon|thumb|small|compact|medium|large|grande|\d+x\d*)(\.(jpe?g|png|webp))/i, '$2');
    else if (/mir-s3-cdn-cf\.behance\.net/i.test(u)) u = u.replace(/\/projects\/\d+\//, '/projects/original/');
    else if (/images\.unsplash\.com/i.test(u)) u = u.replace(/([?&])w=\d+/i, '$1w=2400');
    else if (/wikimedia\.org.*\/thumb\//i.test(u)) u = u.replace(/\/thumb\//, '/').replace(/\/\d+px-[^/]+$/, '');
  } catch { return url; }
  return u;
}
const isHardThumb = (url: string) => /encrypted-tbn\d?\.gstatic\.com/i.test(url) || /^data:image\/(gif|png);base64,R0lGOD/i.test(url);

function resolveBest(rawUrl: string, timeoutMs: number, done: (src: string, upgraded: boolean) => void) {
  const up = upgradeUrl(rawUrl);
  if (up === rawUrl) { done(rawUrl, false); return; }
  const test = new Image();
  let settled = false;
  const finish = (src: string, upgraded: boolean) => { if (settled) return; settled = true; done(src, upgraded); };
  test.onload = () => finish(up, true);
  test.onerror = () => finish(rawUrl, false);
  setTimeout(() => finish(rawUrl, false), timeoutMs);
  test.src = up;
}

/** Copies the opener's stylesheets into a child document (PiP or popup) so it matches exactly. */
function copyStylesInto(doc: Document, from: Document = document) {
  from.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach(l => {
    const el = doc.createElement('link'); el.rel = 'stylesheet'; el.href = l.href;
    if (l.media) el.media = l.media;
    doc.head.appendChild(el);
  });
  from.querySelectorAll('style').forEach(s => {
    const el = doc.createElement('style'); el.textContent = s.textContent; doc.head.appendChild(el);
  });
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

type PipWindow = Window;
declare global { interface Window { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<PipWindow>; window: PipWindow | null } } }

export const tool: LatheTool = {
  id: 'reference',
  name: 'Mood-strip',
  group: 'Drawer',
  defaults,
  accepts: ['image/*'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const LOWRES = d.lowResEdge as number;
    const SWATCHES = d.paletteSize as number;
    let refs: Ref[] = [];
    let seq = 0;

    /* ---- stage ---- */
    const root = document.createElement('div'); root.className = 'ms';
    const strip = document.createElement('div'); strip.className = 'ms-strip';
    const empty = document.createElement('div'); empty.className = 'ms-empty';
    empty.innerHTML = '<p>Drop images here, or press <b>⌘V</b>.</p><p>Pinterest, Tumblr and Shopify links upgrade to full size on their own.</p><p>On <b>Google Images</b>, click the thumbnail first and drag from the large preview. The grid only holds a small copy.</p>';
    const dropEl = document.createElement('div'); dropEl.className = 'ms-drop'; dropEl.innerHTML = '<span>Drop to add</span>';
    root.append(strip, dropEl); stage.appendChild(root);
    const fileInput = document.createElement('input');
    Object.assign(fileInput, { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    root.appendChild(fileInput);

    /* ---- inspector ---- */
    const board = section('Board');
    const stats = statList();
    const floatBtn = button({ label: 'Float', onClick: () => { if (floatWin) closeFloat(); else void floatStrip(); } });
    const row = document.createElement('div'); row.className = 'l-row';
    row.append(button({ label: 'Add images', primary: true, onClick: () => fileInput.click() }), floatBtn,
      button({ label: 'Clear', onClick: () => clearAll() }));
    const pipOk = 'documentPictureInPicture' in window;
    board.body.append(stats.el, row, note(pipOk
      ? 'Float opens an always-on-top window you can keep over Photoshop or Figma.'
      : 'This browser has no Picture-in-Picture for pages, so Float opens a separate window instead.'));
    const link = section('Link');
    const linkField = field({ label: 'Image link', value: '', placeholder: 'https://…', onChange: () => {} });
    const addLink = () => { const v = linkField.input.value.trim(); if (v) { addUrl(v); linkField.input.value = ''; } };
    linkField.input.addEventListener('keydown', e => { if (e.key === 'Enter') addLink(); });
    link.body.append(linkField.el, button({ label: 'Add link', onClick: addLink }));
    inspector.append(board.el, link.el);

    /* ============ ADD REFS ============ */
    async function addFile(file: File | Blob, name?: string) {
      if (!file || !file.type.startsWith('image/')) return;
      const a = await assets.add(file, { source: 'drop', name });
      addAsset(a);
    }
    function addAsset(a: Asset) {
      if (!a.type.startsWith('image/')) { emit('toast', `Mood-strip takes images, not ${a.type || 'this file'}`); return; }
      addRef(a.name, assetUrl(a), { assetId: a.id });
    }
    function addUrl(url: string) {
      url = (url || '').trim();
      if (!url) return;
      const name = (url.split('/').pop() || 'image').split('?')[0].slice(0, 42) || 'image';
      if (isHardThumb(url)) { addRef(name, url, { hardThumb: true, origin: url }); return; }
      resolveBest(url, d.upgradeTimeoutMs as number, (best, upgraded) => {
        addRef(name, best, { origin: url, upgraded });
        if (upgraded) emit('toast', 'Upgraded to full size');
      });
    }
    function addRef(name: string, src: string, meta: { assetId?: string; origin?: string; upgraded?: boolean; hardThumb?: boolean } = {}) {
      refs.push({
        id: 'r' + (++seq), name, src, assetId: meta.assetId,
        palette: null, palOpen: false,
        origin: meta.origin || null, upgraded: !!meta.upgraded, hardThumb: !!meta.hardThumb,
      });
      render();
      requestAnimationFrame(() => { strip.scrollTop = strip.scrollHeight; root.scrollTop = root.scrollHeight; });
    }

    /* ============ RENDER ============ */
    function render() {
      stats.set([['References', `${refs.length}`]]);
      statusbar.set({ name: `${refs.length} ${refs.length === 1 ? 'ref' : 'refs'}`, state: floatWin ? 'Floating' : 'Ready' });
      strip.replaceChildren();
      if (!refs.length) strip.appendChild(empty);
      else refs.forEach((ref, idx) => strip.appendChild(buildCard(ref, idx)));
      persist();
    }
    function persist() {
      const slim: SavedRef[] = refs.map(r => ({
        id: r.id, name: r.name, assetId: r.assetId, origin: r.origin, upgraded: r.upgraded, hardThumb: r.hardThumb,
        ...(r.assetId ? {} : { src: r.src }),
      }));
      settings.set('refs', slim);
    }

    function buildCard(ref: Ref, idx: number) {
      const doc = strip.ownerDocument;
      const card = doc.createElement('div');
      card.className = 'ms-card'; card.dataset.id = ref.id; card.draggable = true;

      const img = doc.createElement('img');
      img.className = 'ms-card-img'; img.src = ref.src; img.alt = ref.name; img.crossOrigin = 'anonymous';
      img.addEventListener('error', () => { if (img.crossOrigin) { img.crossOrigin = null; img.src = ref.src; } }, { once: true });
      card.appendChild(img);

      const bar = doc.createElement('div'); bar.className = 'ms-bar';
      const label = doc.createElement('div'); label.className = 'ms-label';
      label.textContent = String(idx + 1).padStart(2, '0') + '  ' + ref.name;
      bar.appendChild(label);
      const dim = doc.createElement('div'); dim.className = 'ms-dim'; dim.textContent = '···';
      bar.appendChild(dim);

      const warn = doc.createElement('div'); warn.className = 'ms-lowres';
      const showDims = () => {
        const w = img.naturalWidth, h = img.naturalHeight;
        if (!w) return;
        dim.textContent = w + ' × ' + h;
        const small = Math.max(w, h) < LOWRES;
        dim.classList.toggle('low', small);
        dim.title = small ? 'Low resolution source' : 'Full resolution';
        if (small) {
          warn.classList.add('show'); warn.innerHTML = '';
          const msg = doc.createElement('div');
          msg.innerHTML = ref.hardThumb
            ? '<b>Thumbnail from a search grid.</b> Google serves a small preview here, not the real file. Open the image on its own page and drag it from there.'
            : '<b>Low resolution source.</b> The site handed over a preview file. Try opening the image directly and dragging that.';
          warn.appendChild(msg);
          if (ref.origin) {
            const btn = doc.createElement('button'); btn.className = 'ms-fix'; btn.textContent = 'Open source';
            btn.addEventListener('click', () => window.open(ref.origin!, '_blank', 'noopener'));
            warn.appendChild(btn);
          }
        }
      };
      if (img.complete && img.naturalWidth) showDims(); else img.addEventListener('load', showDims);

      bar.appendChild(iconBtn(doc, ICON.palette, 'Colors', ref.palOpen, () => togglePalette(ref, card, img)));
      bar.appendChild(iconBtn(doc, ICON.popout, 'Pop out', false, () => popOut(ref)));
      bar.appendChild(iconBtn(doc, ICON.save, 'Save', false, () => saveRef(ref)));
      bar.appendChild(iconBtn(doc, ICON.del, 'Remove', false, () => removeRef(ref.id)));
      card.appendChild(bar); card.appendChild(warn);

      const pal = doc.createElement('div'); pal.className = 'ms-palette' + (ref.palOpen ? ' open' : '');
      card.appendChild(pal);
      if (ref.palOpen) fillPalette(pal, ref, img);
      wireDrag(card, ref);
      return card;
    }
    function iconBtn(doc: Document, svg: string, title: string, active: boolean, fn: () => void) {
      const b = doc.createElement('button');
      b.className = 'ms-icon' + (active ? ' on' : ''); b.innerHTML = svg; b.title = title;
      b.setAttribute('aria-label', title);
      b.addEventListener('click', e => { e.stopPropagation(); fn(); });
      b.addEventListener('dragstart', e => e.preventDefault());
      return b;
    }

    /* ============ PALETTE UI ============ */
    function togglePalette(ref: Ref, card: HTMLElement, img: HTMLImageElement) {
      ref.palOpen = !ref.palOpen;
      const pal = card.querySelector('.ms-palette')!, btn = card.querySelector('.ms-icon')!;
      pal.classList.toggle('open', ref.palOpen); btn.classList.toggle('on', ref.palOpen);
      if (ref.palOpen) fillPalette(pal as HTMLElement, ref, img);
    }
    function fillPalette(pal: HTMLElement, ref: Ref, img: HTMLImageElement) {
      const doc = pal.ownerDocument;
      const build = () => {
        if (!ref.palette) ref.palette = extractPalette(img, SWATCHES, d.paletteSample as number);
        if (!ref.palette) {
          pal.innerHTML = '<div class="ms-note">This image is served from another site and blocks color reading.<br>Save it, then drop the file back in.</div>';
          return;
        }
        pal.innerHTML = '';
        const row = doc.createElement('div'); row.className = 'ms-sw-row';
        const hexes = doc.createElement('div'); hexes.className = 'ms-sw-hexes';
        ref.palette.forEach(hex => {
          const sw = doc.createElement('button'); sw.className = 'ms-sw';
          sw.style.background = hex; sw.title = 'Copy ' + hex; sw.setAttribute('aria-label', 'Copy ' + hex);
          sw.addEventListener('click', () => copy(hex, hex + ' copied'));
          row.appendChild(sw);
          const h = doc.createElement('div'); h.className = 'ms-sw-hex'; h.textContent = hex.replace('#', '');
          hexes.appendChild(h);
        });
        pal.append(row, hexes);
        const acts = doc.createElement('div'); acts.className = 'ms-pal-actions';
        const all = doc.createElement('button'); all.className = 'ms-mini'; all.textContent = 'Copy all';
        all.addEventListener('click', () => copy(ref.palette!.join('\n'), `${ref.palette!.length} hex codes copied`));
        const css = doc.createElement('button'); css.className = 'ms-mini'; css.textContent = 'Copy as CSS';
        css.addEventListener('click', () => {
          const txt = ref.palette!.map((h, i) => '  --color-' + (i + 1) + ': ' + h + ';').join('\n');
          copy(':root {\n' + txt + '\n}', 'CSS copied');
        });
        acts.append(all, css); pal.appendChild(acts);
      };
      if (img.complete && img.naturalWidth) build(); else img.addEventListener('load', build, { once: true });
    }
    function copy(text: string, msg: string) {
      navigator.clipboard.writeText(text).then(() => emit('toast', msg), () => {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); ta.remove(); emit('toast', msg);
      });
    }

    /* ============ SAVE / REMOVE ============ */
    function saveRef(ref: Ref) {
      const a = ref.assetId ? assets.get(ref.assetId) : undefined;
      const name = ref.name.includes('.') ? ref.name : ref.name + '.png';
      if (a) { downloadBlob(a.blob, name); return; }
      const el = document.createElement('a'); el.href = ref.src; el.download = name;
      document.body.appendChild(el); el.click(); el.remove();
    }
    function removeRef(id: string) { refs = refs.filter(r => r.id !== id); render(); }
    function clearAll() {
      if (!refs.length) return;
      const body = document.createElement('div');
      body.className = 'l-section__body';
      const close = modal({
        title: `Remove all ${refs.length} references?`,
        body: [body],
      });
      body.append(note('The images stay in the asset tray.'), button({ label: 'Remove all', primary: true, onClick: () => { refs = []; render(); close(); } }));
    }

    /* ============ POP-OUT ============
       A real, separate browser window per image; falls back to an in-page float if pop-ups are blocked. */
    const webPops = new Set<Window>();
    const inlineFloats = new Set<HTMLElement>();
    function popOut(ref: Ref) {
      const w = window.open('', 'moodstrip-pop-' + ref.id + '-' + Date.now().toString(36), 'width=340,height=430,menubar=no,toolbar=no,location=no,status=no');
      if (!w) { emit('toast', 'Allow pop-ups to open windows'); popOutInline(ref); return; }
      webPops.add(w);
      buildPopout(w, ref);
      w.addEventListener('pagehide', () => webPops.delete(w));
    }
    function buildPopout(w: Window, ref: Ref) {
      const doc = w.document;
      doc.title = ref.name || 'Mood-strip';
      copyStylesInto(doc);
      doc.body.className = 'ms-window';
      const body = doc.createElement('div'); body.className = 'ms-float-body';
      const img = doc.createElement('img'); img.src = ref.src; img.alt = ref.name || '';
      body.appendChild(img);
      const foot = doc.createElement('div'); foot.className = 'ms-float-foot';
      const dims = doc.createElement('div'); dims.className = 'ms-float-dims';
      const setDims = () => { if (img.naturalWidth) dims.textContent = img.naturalWidth + '×' + img.naturalHeight; };
      img.addEventListener('load', setDims); setDims();
      foot.appendChild(dims);
      let actual = false;
      const zoom = doc.createElement('button'); zoom.className = 'ms-tool'; zoom.textContent = '1:1'; zoom.title = 'Toggle actual pixel size';
      zoom.addEventListener('click', () => {
        actual = !actual;
        body.style.placeItems = actual ? 'start' : 'center';
        body.style.overflow = actual ? 'auto' : 'hidden';
        img.style.maxWidth = actual ? 'none' : '100%';
        img.style.maxHeight = actual ? 'none' : '100%';
        img.style.width = actual ? img.naturalWidth + 'px' : '';
      });
      foot.appendChild(zoom);
      const pip = (w as Window).documentPictureInPicture;
      if (pip) {
        const fl = doc.createElement('button'); fl.className = 'ms-tool'; fl.textContent = 'Float'; fl.title = 'Keep this reference above other apps';
        fl.addEventListener('click', async () => {
          try {
            const p = await pip.requestWindow({ width: 320, height: 400 });
            copyStylesInto(p.document, doc);
            p.document.title = ref.name || 'Mood-strip';
            p.document.body.className = 'ms-window ms-window--pip';
            const pi = p.document.createElement('img'); pi.src = ref.src;
            p.document.body.appendChild(pi);
          } catch {
            // Only one PiP window at a time; if it is in use the pop-out stays an ordinary window.
            fl.textContent = 'Float unavailable';
            setTimeout(() => { fl.textContent = 'Float'; }, 1600);
          }
        });
        foot.appendChild(fl);
      }
      const lab = doc.createElement('label'); lab.textContent = 'Opacity';
      const rng = doc.createElement('input'); rng.type = 'range'; rng.min = '15'; rng.max = '100'; rng.value = '100';
      const pct = doc.createElement('div'); pct.className = 'ms-float-pct'; pct.textContent = '100%';
      rng.addEventListener('input', () => { body.style.opacity = String(Number(rng.value) / 100); pct.textContent = rng.value + '%'; });
      foot.append(lab, rng, pct);
      doc.body.append(body, foot);
    }
    function popOutInline(ref: Ref) {
      const win = document.createElement('div'); win.className = 'ms-float';
      const rect = root.getBoundingClientRect();
      const n = inlineFloats.size;
      win.style.left = Math.min(rect.left + 40 + n * 22, window.innerWidth - 300) + 'px';
      win.style.top = (rect.top + 40 + n * 22) + 'px';
      const head = document.createElement('div'); head.className = 'ms-float-head';
      const t = document.createElement('div'); t.className = 'ms-float-title'; t.textContent = ref.name;
      head.appendChild(t);
      const zoom = document.createElement('button'); zoom.className = 'ms-icon ms-icon--text'; zoom.textContent = '1:1'; zoom.title = 'Toggle actual pixel size';
      head.appendChild(zoom);
      const x = document.createElement('button'); x.className = 'ms-icon'; x.innerHTML = ICON.close; x.title = 'Close'; x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', () => { win.remove(); inlineFloats.delete(win); });
      head.appendChild(x);
      win.appendChild(head);
      const body = document.createElement('div'); body.className = 'ms-float-body';
      const im = document.createElement('img'); im.src = ref.src; im.alt = ref.name; body.appendChild(im);
      win.appendChild(body);
      let actual = false;
      zoom.addEventListener('click', () => {
        actual = !actual; zoom.classList.toggle('on', actual);
        body.style.overflow = actual ? 'auto' : 'hidden'; body.style.placeItems = actual ? 'start' : 'center';
        im.style.maxWidth = actual ? 'none' : '100%'; im.style.maxHeight = actual ? 'none' : '100%';
        im.style.width = actual ? im.naturalWidth + 'px' : ''; im.style.height = actual ? 'auto' : '';
      });
      const foot = document.createElement('div'); foot.className = 'ms-float-foot';
      const dims = document.createElement('div'); dims.className = 'ms-float-dims';
      const setDims = () => { if (im.naturalWidth) dims.textContent = im.naturalWidth + '×' + im.naturalHeight; };
      if (im.complete && im.naturalWidth) setDims(); else im.addEventListener('load', setDims, { once: true });
      foot.appendChild(dims);
      const lab = document.createElement('label'); lab.textContent = 'Opacity';
      const id = 'op-' + Math.random().toString(36).slice(2, 8); lab.htmlFor = id;
      const rng = document.createElement('input'); rng.type = 'range'; rng.min = '15'; rng.max = '100'; rng.value = '100'; rng.id = id;
      const pct = document.createElement('div'); pct.className = 'ms-float-pct'; pct.textContent = '100%';
      rng.addEventListener('input', () => { win.style.opacity = String(Number(rng.value) / 100); pct.textContent = rng.value + '%'; });
      foot.append(lab, rng, pct); win.appendChild(foot);
      const grip = document.createElement('div'); grip.className = 'ms-float-grip'; win.appendChild(grip);
      document.body.appendChild(win); inlineFloats.add(win);
      makeDraggable(win, head); makeResizable(win, grip);
    }
    let zTop = 100;
    function makeDraggable(el: HTMLElement, handle: HTMLElement) {
      let sx = 0, sy = 0, ox = 0, oy = 0, moving = false;
      handle.addEventListener('pointerdown', e => {
        if ((e.target as HTMLElement).closest('.ms-icon')) return;
        moving = true; sx = e.clientX; sy = e.clientY;
        const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
        handle.setPointerCapture(e.pointerId); el.style.zIndex = String(++zTop);
      });
      handle.addEventListener('pointermove', e => {
        if (!moving) return;
        el.style.left = (ox + e.clientX - sx) + 'px'; el.style.top = (oy + e.clientY - sy) + 'px';
      });
      handle.addEventListener('pointerup', e => { moving = false; try { handle.releasePointerCapture(e.pointerId); } catch { /* released */ } });
    }
    function makeResizable(el: HTMLElement, grip: HTMLElement) {
      let sx = 0, sy = 0, sw = 0, sh = 0, sizing = false;
      grip.addEventListener('pointerdown', e => {
        sizing = true; sx = e.clientX; sy = e.clientY;
        const r = el.getBoundingClientRect(); sw = r.width; sh = r.height;
        grip.setPointerCapture(e.pointerId); e.stopPropagation();
      });
      grip.addEventListener('pointermove', e => {
        if (!sizing) return;
        el.style.width = Math.max(130, sw + e.clientX - sx) + 'px'; el.style.height = Math.max(110, sh + e.clientY - sy) + 'px';
      });
      grip.addEventListener('pointerup', e => { sizing = false; try { grip.releasePointerCapture(e.pointerId); } catch { /* released */ } });
    }

    /* ============ REORDER BY DRAG ============ */
    let dragId: string | null = null;
    function wireDrag(card: HTMLElement, ref: Ref) {
      card.addEventListener('dragstart', e => {
        dragId = ref.id; card.classList.add('dragging');
        if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ref.id); } catch { /* ignore */ } }
      });
      card.addEventListener('dragend', () => {
        dragId = null; card.classList.remove('dragging');
        card.ownerDocument.querySelectorAll('.ms-card').forEach(c => c.classList.remove('drop-above', 'drop-below'));
      });
      card.addEventListener('dragover', e => {
        if (!dragId || dragId === ref.id) return;
        e.preventDefault(); e.stopPropagation();
        const r = card.getBoundingClientRect(); const above = e.clientY < r.top + r.height / 2;
        card.classList.toggle('drop-above', above); card.classList.toggle('drop-below', !above);
      });
      card.addEventListener('dragleave', () => card.classList.remove('drop-above', 'drop-below'));
      card.addEventListener('drop', e => {
        if (!dragId || dragId === ref.id) return;
        e.preventDefault(); e.stopPropagation();
        const r = card.getBoundingClientRect(); const above = e.clientY < r.top + r.height / 2;
        const from = refs.findIndex(x => x.id === dragId);
        if (from < 0) return;
        const moved = refs.splice(from, 1)[0];
        let to = refs.findIndex(x => x.id === ref.id);
        if (!above) to++;
        refs.splice(to, 0, moved);
        dragId = null; render();
      });
    }

    /* ============ DROP FROM OUTSIDE ============
       Handled here (files, dragged web images, links) and kept from the shell's drop-anywhere,
       which would otherwise add the same file twice. */
    let dragDepth = 0;
    const onDragEnter = (e: DragEvent) => { e.stopPropagation(); if (dragId) return; dragDepth++; dropEl.classList.add('on'); };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); if (!dragId && e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; };
    const onDragLeave = (e: DragEvent) => { e.stopPropagation(); if (dragId) return; dragDepth--; if (dragDepth <= 0) { dragDepth = 0; dropEl.classList.remove('on'); } };
    const onDrop = (e: DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      dragDepth = 0; dropEl.classList.remove('on');
      if (dragId) return;
      const dt = e.dataTransfer; if (!dt) return;
      const trayId = dt.getData('application/x-lathe-asset');
      if (trayId) { const a = assets.get(trayId); if (a) addAsset(a); return; }
      if (dt.files && dt.files.length) { Array.from(dt.files).forEach(f => void addFile(f)); return; }
      const html = dt.getData('text/html');
      if (html) { const m = html.match(/<img[^>]+src=["']([^"']+)["']/i); if (m) { addUrl(m[1]); return; } }
      const uri = dt.getData('text/uri-list') || dt.getData('text/plain');
      if (uri) addUrl(uri);
    };
    root.addEventListener('dragenter', onDragEnter); root.addEventListener('dragover', onDragOver);
    root.addEventListener('dragleave', onDragLeave); root.addEventListener('drop', onDrop);

    /* ============ PASTE ============ */
    const onPaste = (e: ClipboardEvent) => {
      if (!stage.closest('[data-active-tab]')) return;
      if (typing(e.target)) return; // the link field handles its own paste
      const items = e.clipboardData && e.clipboardData.items;
      if (items) for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) void addFile(f, f.name || 'pasted.png'); return; }
      }
      const txt = e.clipboardData && e.clipboardData.getData('text');
      if (txt && /^https?:\/\//i.test(txt.trim())) addUrl(txt);
    };
    window.addEventListener('paste', onPaste);

    fileInput.addEventListener('change', () => { Array.from(fileInput.files || []).forEach(f => void addFile(f)); fileInput.value = ''; });

    /* ============ FLOAT ============
       Document Picture-in-Picture is the only web API that yields a real always-on-top window.
       Elsewhere, a popup window holds the strip (not always-on-top, but separate and movable).
       The live strip element is moved across, so every listener keeps working. */
    let floatWin: Window | null = null, stripHome: HTMLElement | null = null;
    async function floatStrip() {
      if (floatWin) { floatWin.focus(); return; }
      let w: Window | null = null;
      const pip = window.documentPictureInPicture;
      if (pip) {
        try { w = await pip.requestWindow({ width: d.floatWidth as number, height: d.floatHeight as number }); }
        catch { emit('toast', 'Could not open the floating window'); return; }
      } else {
        w = window.open('', 'moodstrip-float', `width=${d.floatWidth},height=${d.floatHeight},menubar=no,toolbar=no,location=no,status=no`);
        if (!w) { emit('toast', 'Allow pop-ups to float the strip'); return; }
      }
      floatWin = w;
      copyStylesInto(w.document);
      w.document.title = 'Mood-strip';
      w.document.body.className = 'ms-window ms-window--strip';
      stripHome = document.createElement('div'); stripHome.className = 'ms-home'; stripHome.textContent = 'Strip is floating.';
      strip.replaceWith(stripHome);
      w.document.body.appendChild(strip);
      floatBtn.textContent = 'Return strip';
      w.addEventListener('pagehide', returnStrip);
      render();
    }
    function returnStrip() {
      if (stripHome) { stripHome.replaceWith(strip); stripHome = null; }
      floatWin = null; floatBtn.textContent = 'Float';
      render();
    }
    function closeFloat() { const w = floatWin; returnStrip(); try { w?.close(); } catch { /* closed */ } }

    /* ---- assets handed to the tool (drop on the shell, Send to, tray) ---- */
    const off = assets.onChange(e => { if (e.type === 'load' && e.target === 'reference') addAsset(e.asset); });
    const onUnload = () => webPops.forEach(w => { try { w.close(); } catch { /* closed */ } });
    window.addEventListener('pagehide', onUnload);

    /* ---- restore before the first save (fixes the original's restore race) ---- */
    for (const r of settings.get<SavedRef[]>('refs', [])) {
      let src = r.src;
      if (r.assetId) { const a = assets.get(r.assetId); if (!a) continue; src = assetUrl(a); }
      if (!src) continue;
      refs.push({ ...r, src, palette: null, palOpen: false });
      seq = Math.max(seq, parseInt(String(r.id).slice(1), 10) || 0);
    }
    render();

    return {
      unmount() {
        off();
        window.removeEventListener('paste', onPaste);
        window.removeEventListener('pagehide', onUnload);
        if (floatWin) closeFloat();
        inlineFloats.forEach(f => f.remove());
      },
    };
  },
};
