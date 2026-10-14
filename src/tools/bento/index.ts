/* Bento: compose assets into bento-box slides on a 12×8 grid. Standalone, and the output stage for
   Audit. Exports .pptx (editable), .pdf, .png, .svg and "Copy for Figma". */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { COLS, DECK_MIME, ROWS, emptyDeck, parseDeck, uid, type Deck, type Tile, type TileType } from './model';
import { BRAND_SLIDE_MIME, type BrandSlide } from '../audit/brand-slide';
import { ensureLayout, layoutSlide, reshuffle, variantsFor } from './layout';
import { allSlides, drawSlide, type DrawConfig } from './draw';
import { slideSvg } from './render-svg';
import { copyForFigma, deckToPdf, deckToPptx, slideToPng, slideToSvg, slidesToPngZip, type ExportCtx } from './export';
import { proxied } from './images';
import { advancedSection, button, chips, field, note, section, select, slider, textarea } from '../../ui/primitives';
import { assetUrl } from '../../lib/assets';
import { saveExport } from '../../lib/download';
import './bento.css';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'deck';
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)); };

export const tool: LatheTool = {
  id: 'deck',
  name: 'Deck',
  group: 'Workbench',
  defaults,
  accepts: ['image/*', DECK_MIME, BRAND_SLIDE_MIME, 'application/json'],

  mount({ defaults: d, stage, inspector, statusbar, assets, settings, emit }) {
    const cfg: DrawConfig = {
      slideW: 13.333, slideH: 7.5, margin: d.margin as number, gutter: d.gutter as number, pad: d.padding as number,
      sizes: {
        display: d.displaySize as number, title: d.titleSize as number, body: d.bodySize as number, caption: d.captionSize as number,
        stat: d.statSize as number, statLabel: d.statLabelSize as number, hex: d.hexSize as number,
      },
      font: d.font as string, showCaptions: d.showCaptions as boolean,
    };
    const xctx: ExportCtx = { cfg, assets, imageMaxPx: d.imageMaxPx as number, pngWidth: d.pngWidth as number };

    let deck: Deck = parseDeck(settings.get('deck', null)) ?? emptyDeck('Untitled deck', d.theme as Deck['theme']);
    deck.slides = deck.slides.map(ensureLayout);
    if (!deck.slides.length) deck.slides.push({ id: uid('s'), tiles: [], variant: 0 });
    let cur = Math.min(settings.get('slide', 0), deck.slides.length - 1);
    let sel: string | null = null;

    const views = () => allSlides(deck, cfg);
    const isCredits = (i: number) => i >= deck.slides.length;
    const save = () => { settings.set('deck', deck); settings.set('slide', cur); };
    // Remote images preview through the same-origin proxy: some archives refuse hotlinked requests.
    const href = (src: string, thumb?: string) => {
      if (src.startsWith('asset:')) { const a = assets.get(src.slice(6)); return a ? assetUrl(a) : undefined; }
      const u = thumb || src;
      return /^https?:/.test(u) ? proxied(u) : u;
    };

    /* ---------------- stage ---------------- */
    const root = document.createElement('div'); root.className = 'bt';
    const main = document.createElement('div'); main.className = 'bt__main';
    const slideEl = document.createElement('div'); slideEl.className = 'bt__slide';
    const svgHost = document.createElement('div'); svgHost.className = 'bt__svg';
    const overlay = document.createElement('div'); overlay.className = 'bt__overlay';
    const emptyEl = document.createElement('div'); emptyEl.className = 'bt__empty';
    emptyEl.textContent = 'Drop images here, send an Audit collection, or add tiles from the inspector.';
    slideEl.append(svgHost, overlay, emptyEl);
    main.appendChild(slideEl);
    const strip = document.createElement('div'); strip.className = 'bt__strip';
    root.append(main, strip);
    stage.appendChild(root);

    const fit = () => {
      const cs = getComputedStyle(main);
      const W = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const H = main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let w = W, h = W * 9 / 16;
      if (h > H) { h = H; w = H * 16 / 9; }
      slideEl.style.width = `${Math.floor(w)}px`; slideEl.style.height = `${Math.floor(h)}px`;
    };
    const ro = new ResizeObserver(fit); ro.observe(main);

    /* ---------------- inspector ---------------- */
    const deckSec = section('Deck');
    const titleField = field({ label: 'Title', value: deck.title, onChange: v => { deck.title = v.trim() || 'Untitled deck'; commit(); } });
    const themeChips = chips<'dark' | 'light'>({ label: 'Theme', value: deck.theme, options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], onChange: v => { deck.theme = v as Deck['theme']; commit(); } });
    const captionChips = chips<'true' | 'false'>({ label: 'Credit lines', value: String(cfg.showCaptions) as 'true' | 'false', options: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }], onChange: v => { cfg.showCaptions = v === 'true'; render(); } });
    const deckInfo = note('');
    deckSec.body.append(titleField.el, themeChips.el, captionChips.el, deckInfo);

    const slideSec = section('Slide');
    const slideInfo = note('');
    const slideRow = document.createElement('div'); slideRow.className = 'l-row';
    slideRow.append(
      button({ label: 'Reshuffle', primary: true, onClick: () => { if (isCredits(cur)) return; deck.slides[cur] = reshuffle(deck.slides[cur]); commit(); } }),
      button({ label: 'Add slide', onClick: () => { deck.slides.splice(cur + 1, 0, { id: uid('s'), tiles: [], variant: 0 }); cur = Math.min(cur + 1, deck.slides.length - 1); sel = null; commit(); } }),
      button({ label: 'Duplicate', onClick: () => { if (isCredits(cur)) return; const s = structuredClone(deck.slides[cur]); s.id = uid('s'); s.tiles.forEach(t => { t.id = uid(); }); deck.slides.splice(cur + 1, 0, s); cur++; commit(); } }),
      button({ label: 'Delete', onClick: () => { if (isCredits(cur) || deck.slides.length < 2) return; deck.slides.splice(cur, 1); cur = Math.max(0, cur - 1); sel = null; commit(); } }),
    );
    const moveRow = document.createElement('div'); moveRow.className = 'l-row';
    moveRow.append(
      button({ label: '← Move', onClick: () => moveSlide(-1) }),
      button({ label: 'Move →', onClick: () => moveSlide(1) }),
    );
    slideSec.body.append(slideInfo, slideRow, moveRow);

    const addSec = section('Add tile');
    const addRow = document.createElement('div'); addRow.className = 'l-row';
    const ADDS: [TileType, string, Partial<Tile>][] = [
      ['text', 'Title', { role: 'title', text: 'Title' }],
      ['text', 'Text', { role: 'body', text: 'Write something.' }],
      ['stat', 'Stat', { value: '42', label: 'Label' }],
      ['palette', 'Palette', { colors: [...(d.starterPalette as string[])] }],
      ['hexlist', 'Hex list', { colors: [...(d.starterPalette as string[])] }],
      ['type', 'Type', { family: 'Helvetica Neue', sample: 'Every default was someone else’s decision.' }],
    ];
    for (const [type, label, data] of ADDS) addRow.append(button({ label, onClick: () => addTile({ id: uid(), type, ...data }) }));
    const trayPick = select<string>({ label: 'Image from the tray', value: '', options: [], onChange: () => {} });
    const fillTray = () => trayPick.setOptions([{ value: '', label: 'Choose an image…' }, ...assets.list().filter(a => a.type.startsWith('image/')).map(a => ({ value: a.id, label: a.name }))], '');
    addSec.body.append(addRow, trayPick.el, button({ label: 'Add image', onClick: () => { const a = assets.get(trayPick.input.value); if (a) addImageAsset(a); } }));

    const tileSec = section('Tile');
    const tileBody = document.createElement('div'); tileBody.className = 'l-section__body';
    tileSec.body.replaceWith(tileBody);

    const outSec = section('Export');
    const outRow = document.createElement('div'); outRow.className = 'l-row';
    const status = note(''); status.setAttribute('role', 'status');
    outRow.append(
      button({ label: '.pptx', primary: true, onClick: () => void run('pptx') }),
      button({ label: '.pdf', onClick: () => void run('pdf') }),
      button({ label: '.png', onClick: () => void run('png') }),
      button({ label: '.png all', onClick: () => void run('pngzip') }),
      button({ label: '.svg', onClick: () => void run('svg') }),
      button({ label: 'Copy for Figma', onClick: () => void run('figma') }),
    );
    outSec.body.append(outRow, status, button({ label: 'Save to Library', onClick: async () => {
      const { supabase } = await import('../../lib/supabase');
      if (!supabase) { emit('toast', 'Sign in to save'); return; }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { emit('toast', 'Sign in to save'); return; }
      const { cloudSaveItem } = await import('../../lib/cloud-library');
      await cloudSaveItem(user.id, { type: 'deck', name: deck.title || 'Untitled deck', toolId: 'deck', data: deck });
      emit('toast', 'Saved to Library');
    }}), note('Decks export with an auto-generated credits slide. Fonts: Helvetica Neue, with Arial declared as the fallback.'));
    const advSec = advancedSection();
    advSec.body.append(
      note(`Font: ${cfg.font}`),
      slider({ label: 'Margin', min: 0, max: 150, value: Math.round(cfg.margin * 100), format: v => `${(v / 100).toFixed(2)} in`, onChange: v => { cfg.margin = v / 100; render(); } }).el,
      slider({ label: 'Gutter', min: 0, max: 60, value: Math.round(cfg.gutter * 100), format: v => `${(v / 100).toFixed(2)} in`, onChange: v => { cfg.gutter = v / 100; render(); } }).el,
      slider({ label: 'Tile padding', min: 0, max: 60, value: Math.round(cfg.pad * 100), format: v => `${(v / 100).toFixed(2)} in`, onChange: v => { cfg.pad = v / 100; render(); } }).el,
      slider({ label: 'Display text', min: 12, max: 200, value: cfg.sizes.display, unit: ' pt', onChange: v => { cfg.sizes.display = v; render(); } }).el,
      slider({ label: 'Title text', min: 8, max: 120, value: cfg.sizes.title, unit: ' pt', onChange: v => { cfg.sizes.title = v; render(); } }).el,
      slider({ label: 'Body text', min: 6, max: 48, value: cfg.sizes.body, unit: ' pt', onChange: v => { cfg.sizes.body = v; render(); } }).el,
      slider({ label: 'Caption text', min: 5, max: 24, value: cfg.sizes.caption, unit: ' pt', onChange: v => { cfg.sizes.caption = v; render(); } }).el,
      slider({ label: 'Stat value', min: 12, max: 240, value: cfg.sizes.stat, unit: ' pt', onChange: v => { cfg.sizes.stat = v; render(); } }).el,
      slider({ label: 'Stat label', min: 6, max: 48, value: cfg.sizes.statLabel, unit: ' pt', onChange: v => { cfg.sizes.statLabel = v; render(); } }).el,
      slider({ label: 'Hex labels', min: 5, max: 24, value: cfg.sizes.hex, unit: ' pt', onChange: v => { cfg.sizes.hex = v; render(); } }).el,
      slider({ label: 'Image max px', min: 400, max: 6000, value: xctx.imageMaxPx, unit: ' px', onChange: v => { xctx.imageMaxPx = v; } }).el,
    );
    inspector.append(deckSec.el, slideSec.el, addSec.el, tileSec.el, advSec.el, outSec.el);

    /* ---------------- render ---------------- */
    let brandDomEl: HTMLElement | null = null; // cached brand slide DOM for the current slide
    function render() {
      const vs = views();
      if (cur >= vs.length) cur = vs.length - 1;
      const slide = vs[cur];
      const credits = isCredits(cur);
      const isBrand = !!slide.brand;

      // Clean up previous brand DOM if switching away
      if (brandDomEl) { brandDomEl.remove(); brandDomEl = null; }

      if (isBrand) {
        // Render brand slide via its own pixel-precise DOM renderer, scaled to fit
        import('../audit/brand-slide-render').then(({ renderSlideDOM }) => {
          const SW = 1920, SH = 1080;
          svgHost.innerHTML = '';
          brandDomEl = renderSlideDOM(slide.brand!);
          const containerW = svgHost.clientWidth || slideEl.clientWidth || 800;
          const containerH = svgHost.clientHeight || slideEl.clientHeight || 450;
          const scale = Math.min(containerW / SW, containerH / SH);
          brandDomEl.style.cssText += `transform-origin:top left;transform:scale(${scale});`;
          svgHost.appendChild(brandDomEl);
        });
        overlay.replaceChildren();
        emptyEl.hidden = true;
      } else {
        const drawing = drawSlide(slide, deck, cfg);
        svgHost.innerHTML = slideSvg(drawing, cfg, p => href(p.src, p.thumb), { idPrefix: 'p' });
        emptyEl.hidden = slide.tiles.length > 0;
        overlay.replaceChildren(...(credits ? [] : drawing.tileBoxes.map(b => {
          const t = slide.tiles.find(x => x.id === b.id)!;
          const el = document.createElement('div');
          el.className = `bt__tile${t.id === sel ? ' is-selected' : ''}${t.locked ? ' is-locked' : ''}`;
          el.dataset.id = t.id;
          el.style.left = `${b.x / cfg.slideW * 100}%`; el.style.top = `${b.y / cfg.slideH * 100}%`;
          el.style.width = `${b.w / cfg.slideW * 100}%`; el.style.height = `${b.h / cfg.slideH * 100}%`;
          el.setAttribute('aria-label', `${t.type} tile`);
          if (t.locked) { const lk = document.createElement('span'); lk.className = 'bt__lock'; lk.textContent = 'Locked'; el.appendChild(lk); }
          if (t.id === sel) { const h = document.createElement('div'); h.className = 'bt__handle'; h.dataset.handle = '1'; h.setAttribute('aria-label', 'Resize'); el.appendChild(h); }
          return el;
        })));
      }
      // filmstrip
      strip.replaceChildren(...vs.map((s, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = `bt__thumb${i === cur ? ' is-active' : ''}`;
        b.setAttribute('aria-label', isCredits(i) ? `Credits slide ${i + 1}` : s.brand ? `Brand slide ${i + 1}` : `Slide ${i + 1}`);
        if (s.brand) {
          // Brand slide thumbnail: render DOM at small scale
          import('../audit/brand-slide-render').then(({ renderSlideDOM }) => {
            const dom = renderSlideDOM(s.brand!);
            dom.style.cssText += 'width:100%;height:100%;';
            b.insertBefore(dom, b.firstChild);
          });
        } else {
          b.innerHTML = slideSvg(drawSlide(s, deck, cfg), cfg, p => href(p.src, p.thumb), { idPrefix: `t${i}` });
        }
        const n = document.createElement('span'); n.className = 'bt__num'; n.textContent = isCredits(i) ? `${i + 1} · auto` : s.brand ? `${i + 1} · brand` : String(i + 1);
        b.appendChild(n);
        b.addEventListener('click', () => { cur = i; sel = null; save(); render(); });
        return b;
      }));
      // inspector state
      const vcount = variantsFor(slide.tiles.length).length;
      slideInfo.textContent = credits ? 'Credits are generated from every image’s credit and update on their own.'
        : isBrand ? `Slide ${cur + 1} of ${deck.slides.length} · brand board`
        : `Slide ${cur + 1} of ${deck.slides.length} · ${slide.tiles.length} tiles · layout ${slide.variant % Math.max(1, vcount) + 1} of ${vcount}`;
      deckInfo.textContent = `${deck.slides.length} slides + ${vs.length - deck.slides.length} credits`;
      renderTileEditor();
      statusbar.set({ name: `${deck.title}  ${vs.length} slides`, state: credits ? 'Credits (auto)' : `Slide ${cur + 1}` });
    }

    function commit(relayout = false) {
      if (relayout && !isCredits(cur) && !deck.slides[cur]?.brand) deck.slides[cur] = layoutSlide(deck.slides[cur]);
      save(); render();
    }

    function moveSlide(dir: number) {
      const j = cur + dir;
      if (isCredits(cur) || j < 0 || j >= deck.slides.length) return;
      [deck.slides[cur], deck.slides[j]] = [deck.slides[j], deck.slides[cur]]; cur = j; commit();
    }

    function addTile(t: Tile) {
      if (isCredits(cur)) cur = deck.slides.length - 1;
      deck.slides[cur].tiles.push(t);
      sel = t.id;
      commit(true);
    }
    function addImageAsset(a: Asset) {
      addTile({ id: uid(), type: 'image', src: `asset:${a.id}`, aspect: a.width && a.height ? a.width / a.height : undefined, fit: 'cover', caption: false });
    }

    /* ---------------- tile editor ---------------- */
    function renderTileEditor() {
      const slide = isCredits(cur) ? null : deck.slides[cur];
      const t = slide?.tiles.find(x => x.id === sel);
      tileBody.replaceChildren();
      if (!t || !slide) { tileBody.append(note('Select a tile to edit it. Drag a tile onto another to swap them; drag the corner to resize.')); return; }
      const update = (patch: Partial<Tile>, relayout = false) => { Object.assign(t, patch); commit(relayout); };
      tileBody.append(note(`${t.type[0].toUpperCase()}${t.type.slice(1)} tile`));
      if (t.type === 'text') {
        tileBody.append(
          select<NonNullable<Tile['role']>>({ label: 'Role', value: t.role ?? 'body', options: [{ value: 'display', label: 'Display' }, { value: 'title', label: 'Title' }, { value: 'body', label: 'Body' }, { value: 'caption', label: 'Caption' }], onChange: v => update({ role: v }) }).el,
          textareaEl('Text', t.text ?? '', v => update({ text: v })),
        );
      } else if (t.type === 'stat') {
        tileBody.append(field({ label: 'Value', value: t.value ?? '', onChange: v => update({ value: v }) }).el, field({ label: 'Label', value: t.label ?? '', onChange: v => update({ label: v }) }).el);
      } else if (t.type === 'palette' || t.type === 'hexlist') {
        tileBody.append(textareaEl('Hex values', (t.colors ?? []).join('\n'), v => {
          const cols = (v.match(/#?[0-9a-f]{6}\b/gi) || []).map(h => ('#' + h.replace('#', '')).toUpperCase());
          if (cols.length) update({ colors: cols });
        }));
      } else if (t.type === 'type') {
        tileBody.append(field({ label: 'Family', value: t.family ?? '', onChange: v => update({ family: v }) }).el, field({ label: 'Sample', value: t.sample ?? '', onChange: v => update({ sample: v }) }).el);
      } else if (t.type === 'image' || t.type === 'logo') {
        tileBody.append(
          chips<'cover' | 'contain'>({ label: 'Fit', value: t.fit ?? (t.type === 'logo' ? 'contain' : 'cover'), options: [{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }], onChange: v => update({ fit: v as 'cover' | 'contain' }) }).el,
          chips<'image' | 'logo'>({ label: 'Treat as', value: t.type, options: [{ value: 'image', label: 'Image' }, { value: 'logo', label: 'Logo' }], onChange: v => update({ type: v as TileType }) }).el,
        );
        if (t.credit) tileBody.append(chips<'on' | 'off'>({ label: 'Credit line', value: t.caption === false ? 'off' : 'on', options: [{ value: 'on', label: 'Show' }, { value: 'off', label: 'Hide' }], onChange: v => update({ caption: v === 'on' }) }).el, note(`${t.credit.title} · ${t.credit.license}`));
      }
      const span = document.createElement('div'); span.className = 'bt__span';
      (['x', 'y', 'w', 'h'] as const).forEach(k => {
        const f = field({ label: k.toUpperCase(), type: 'number', value: String(t.rect?.[k] ?? 0), onChange: v => {
          const r = { ...t.rect! }; r[k] = Math.round(Number(v)) || 0;
          r.w = Math.max(1, Math.min(COLS, r.w)); r.h = Math.max(1, Math.min(ROWS, r.h));
          r.x = Math.max(0, Math.min(COLS - r.w, r.x)); r.y = Math.max(0, Math.min(ROWS - r.h, r.y));
          update({ rect: r });
        } });
        f.input.setAttribute('aria-label', `Span ${k}`);
        span.append(f.el);
      });
      const row = document.createElement('div'); row.className = 'l-row';
      row.append(
        button({ label: t.locked ? 'Unlock' : 'Lock', onClick: () => update({ locked: !t.locked }) }),
        button({ label: 'Remove', onClick: () => { slide.tiles = slide.tiles.filter(x => x.id !== t.id); sel = null; commit(true); } }),
      );
      tileBody.append(note('Span on the 12 × 8 grid'), span, row);
    }
    function textareaEl(label: string, value: string, onCommit: (v: string) => void) {
      const ta = textarea({ label, value, rows: 4, onInput: () => {} });
      ta.input.addEventListener('change', () => onCommit(ta.input.value));
      return ta.el;
    }

    /* ---------------- pointer: select, swap, resize ---------------- */
    let drag: { id: string; mode: 'move' | 'resize'; x0: number; y0: number; el: HTMLElement; moved: boolean } | null = null;
    const cellAt = (cx: number, cy: number) => {
      const r = slideEl.getBoundingClientRect();
      const fx = (cx - r.left) / r.width * cfg.slideW, fy = (cy - r.top) / r.height * cfg.slideH;
      const cw = (cfg.slideW - 2 * cfg.margin) / COLS, ch = (cfg.slideH - 2 * cfg.margin) / ROWS;
      return { col: Math.floor((fx - cfg.margin) / cw), row: Math.floor((fy - cfg.margin) / ch) };
    };
    overlay.addEventListener('pointerdown', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.bt__tile'); if (!el) return;
      e.preventDefault();
      const id = el.dataset.id!;
      if (sel !== id) { sel = id; render(); }
      const fresh = overlay.querySelector<HTMLElement>(`.bt__tile[data-id="${id}"]`)!;
      drag = { id, mode: (e.target as HTMLElement).dataset.handle ? 'resize' : 'move', x0: e.clientX, y0: e.clientY, el: fresh, moved: false };
      fresh.setPointerCapture?.(e.pointerId);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      if (drag.mode === 'move') { drag.el.style.transform = `translate(${dx}px, ${dy}px)`; drag.el.classList.add('is-dragging'); }
      else {
        const t = deck.slides[cur].tiles.find(x => x.id === drag!.id)!;
        const c = cellAt(e.clientX, e.clientY);
        const w = Math.max(1, Math.min(COLS - t.rect!.x, c.col - t.rect!.x + 1)), h = Math.max(1, Math.min(ROWS - t.rect!.y, c.row - t.rect!.y + 1));
        if (w !== t.rect!.w || h !== t.rect!.h) { t.rect = { ...t.rect!, w, h }; render(); drag.el = overlay.querySelector<HTMLElement>(`.bt__tile[data-id="${t.id}"]`)!; }
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const d0 = drag; drag = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (d0.mode === 'resize') { if (d0.moved) save(); return; }
      d0.el.style.transform = ''; d0.el.classList.remove('is-dragging');
      if (!d0.moved) return;
      d0.el.style.visibility = 'hidden';
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.bt__tile');
      d0.el.style.visibility = '';
      const slide = deck.slides[cur];
      const a = slide.tiles.find(x => x.id === d0.id), b = under && slide.tiles.find(x => x.id === under.dataset.id);
      if (a && b && a !== b) { [a.rect, b.rect] = [b.rect, a.rect]; commit(); } else render();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!stage.closest('[data-active-tab]')) return;
      if (typing(e.target) || !sel || isCredits(cur) || e.metaKey || e.ctrlKey) return;
      const slide = deck.slides[cur], t = slide.tiles.find(x => x.id === sel); if (!t?.rect) return;
      const r = { ...t.rect };
      const k = e.key;
      if (k === 'Delete' || k === 'Backspace') { slide.tiles = slide.tiles.filter(x => x.id !== sel); sel = null; e.preventDefault(); commit(true); return; }
      if (k === 'Escape') { sel = null; render(); return; }
      const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      if (e.shiftKey) { r.w = Math.max(1, Math.min(COLS - r.x, r.w + dx)); r.h = Math.max(1, Math.min(ROWS - r.y, r.h + dy)); }
      else { r.x = Math.max(0, Math.min(COLS - r.w, r.x + dx)); r.y = Math.max(0, Math.min(ROWS - r.h, r.y + dy)); }
      t.rect = r; commit();
    };
    document.addEventListener('keydown', onKey);

    /* ---------------- exports ---------------- */
    async function run(kind: 'pptx' | 'pdf' | 'png' | 'pngzip' | 'svg' | 'figma') {
      const vs = views();
      const base = slug(deck.title);
      const one = drawSlide(vs[cur], deck, cfg);
      const nn = String(cur + 1).padStart(2, '0');
      status.textContent = 'Exporting…';
      try {
        if (kind === 'pptx') await saveExport(await deckToPptx(vs.map(s => drawSlide(s, deck, cfg)), deck, xctx), `${base}.pptx`, 'deck');
        else if (kind === 'pdf') await saveExport(await deckToPdf(vs.map(s => drawSlide(s, deck, cfg)), xctx, deck.title), `${base}.pdf`, 'deck');
        else if (kind === 'png') await saveExport(await slideToPng(one, xctx), `${base}-slide-${nn}.png`, 'deck');
        else if (kind === 'pngzip') await saveExport(await slidesToPngZip(vs.map(s => drawSlide(s, deck, cfg)), xctx, base), `${base}-slides.zip`, 'deck');
        else if (kind === 'svg') await saveExport(new Blob([await slideToSvg(one, xctx)], { type: 'image/svg+xml' }), `${base}-slide-${nn}.svg`, 'deck');
        else { await copyForFigma(one, xctx); emit('toast', 'Slide copied as SVG. Paste into Figma for editable layers.'); }
        status.textContent = kind === 'figma' ? 'Copied for Figma' : `Exported ${kind === 'pngzip' ? `${vs.length} slides` : kind === 'png' || kind === 'svg' ? `slide ${cur + 1}` : `${vs.length} slides`}`;
      } catch (err) {
        console.error('[bento] export failed', err);
        status.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    /* ---------------- incoming files ---------------- */
    async function load(a: Asset) {
      if (a.type === DECK_MIME || a.type === 'application/json' || /\.deck\.json$/i.test(a.name)) {
        try {
          const parsed = parseDeck(JSON.parse(await a.blob.text()));
          if (!parsed) throw new Error('not a deck');
          deck = { ...parsed, slides: parsed.slides.map(ensureLayout) };
          if (!deck.slides.length) deck.slides.push({ id: uid('s'), tiles: [], variant: 0 });
          cur = 0; sel = null;
          titleField.input.value = deck.title; themeChips.set(deck.theme);
          commit();
          emit('toast', `Loaded “${deck.title}”: ${deck.slides.length} slides`);
        } catch { emit('toast', 'That file is not a deck'); }
        return;
      }
      if (a.type === BRAND_SLIDE_MIME || /\.brand-slide\.json$/i.test(a.name)) {
        try {
          const slide = JSON.parse(await a.blob.text()) as BrandSlide;
          const { brandSlideToDecSlide } = await import('./brand-layout');
          const newSlide = brandSlideToDecSlide(slide);

          deck.theme = slide.theme;
          deck.slides.push(newSlide);
          cur = deck.slides.length - 1;
          sel = null;
          if (deck.title === 'Untitled deck') {
            deck.title = (settings.get('brandName', 'Brand') as string) + ' audit';
          }
          titleField.input.value = deck.title;
          themeChips.set(deck.theme);
          commit();
          const filled = slide.slots.filter(s => s.assetUrl).length;
          emit('toast', `Brand slide: ${filled} images, ${slide.palette.length} colors`);
        } catch (e) {
          console.error('[deck] brand slide error', e);
          emit('toast', 'Could not read brand slide');
        }
        return;
      }
      if (a.type.startsWith('image/')) { addImageAsset(a); return; }
      emit('toast', `Deck takes images or decks, not ${a.type || 'this file'}`);
    }
    const off = assets.onChange(e => {
      if (e.type === 'load' && e.target === 'deck') void load(e.asset);
      if (e.type !== 'load') fillTray();
    });

    fillTray();
    fit();
    render();

    return {
      unmount() { off(); ro.disconnect(); document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('keydown', onKey); if (drag) drag = null; },
      export: () => void run('pptx'),
    };
  },
};
