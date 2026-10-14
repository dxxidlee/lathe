/* Bento: compose assets into bento-box slides on a 12×8 grid. Standalone, and the output stage for
   Audit. Exports .pptx (editable), .pdf, .png, .svg and "Copy for Figma". */
import type { Asset, LatheTool } from '../types';
import { defaults } from './defaults';
import { COLS, DECK_MIME, ROWS, emptyDeck, parseDeck, uid, type Deck, type Tile, type TileType } from './model';
import { BRAND_SLIDE_MIME, type BrandSlide, getTemplate as getBrandTemplate, resolveSlotRect, SLIDE_W as B_SW, SLIDE_H as B_SH, GUTTER_FX, GUTTER_FY } from '../audit/brand-slide';
import { ensureLayout, layoutSlide, reshuffle, variantsFor } from './layout';
import { allSlides, drawSlide, type DrawConfig } from './draw';
import { slideSvg } from './render-svg';
import { copyForFigma, deckToPdf, addGridSlidesToPptx, writePptx, slideToPng, slideToSvg, brandSlideToPptx, brandSlideToSvg, brandSlideToPng, brandSlideToPdf, type ExportCtx } from './export';
import { proxied } from './images';
import { advancedSection, button, chips, field, note, section, select, slider, textarea } from '../../ui/primitives';
import { assetUrl } from '../../lib/assets';
import { saveExport } from '../../lib/download';
import { buildBoundaries, boundariesForHandle, computeResize, applyResize, boundaryAtPoint, fillNeighbor, applyRemoval, type TileRect, type Boundary, type HandleDir } from './resize';
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

    /* ---- undo / redo (per-deck, full-snapshot) ---- */
    type UndoEntry = { snapshot: string; cur: number; sel: string | null };
    const undoStack: UndoEntry[] = [], redoStack: UndoEntry[] = [];
    let lastSnap = JSON.stringify(deck);

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
    const guides = document.createElement('div'); guides.className = 'bt__guides';
    slideEl.append(svgHost, overlay, guides, emptyEl);
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
      button({ label: 'Reshuffle', primary: true, onClick: () => {
        if (isCredits(cur)) return;
        const slide = deck.slides[cur];
        if (slide.brand) {
          slide.brand.variant = (slide.brand.variant + 1) % 4;
          slide.brand.removed = [];
          for (const sd of slide.brand.slots) delete sd.rect;
          commit();
          emit('toast', 'Layout reset · Undo');
        } else { deck.slides[cur] = reshuffle(slide); commit(); }
      } }),
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
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
    function addSelectionChrome(el: HTMLElement, wPx: number, hPx: number) {
      for (const h of HANDLES) {
        const d = document.createElement('div');
        d.className = 'bt__handle'; d.dataset.handle = h;
        el.appendChild(d);
      }
      const dim = document.createElement('div');
      dim.className = 'bt__dim';
      dim.textContent = `${Math.round(wPx)} × ${Math.round(hPx)}`;
      el.appendChild(dim);
    }
    let brandDomEl: HTMLElement | null = null;
    const updateBrandTileCSS = (sd: { name: string; focalX: number; focalY: number; cropZoom: number; fit: string }) => {
      if (!brandDomEl) return;
      const img = brandDomEl.querySelector<HTMLImageElement>(`[data-slot="${sd.name}"] img`);
      if (!img) return;
      const z = sd.cropZoom ?? 1;
      img.style.objectPosition = `${sd.focalX * 100}% ${sd.focalY * 100}%`;
      img.style.objectFit = sd.fit;
      img.style.transform = z !== 1 ? `scale(${z})` : '';
      img.style.transformOrigin = z !== 1 ? `${sd.focalX * 100}% ${sd.focalY * 100}%` : '';
    };
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
          svgHost.innerHTML = '';
          brandDomEl = renderSlideDOM(slide.brand!);
          const containerW = svgHost.clientWidth || slideEl.clientWidth || 800;
          const containerH = svgHost.clientHeight || slideEl.clientHeight || 450;
          const scale = Math.min(containerW / B_SW, containerH / B_SH);
          brandDomEl.style.cssText += `transform-origin:top left;transform:scale(${scale});`;
          svgHost.appendChild(brandDomEl);
        });
        // Clickable overlays on each brand tile
        const template = getBrandTemplate(slide.brand!.variant);
        const removedSet = new Set(slide.brand!.removed ?? []);
        overlay.replaceChildren(...template.filter(slot => !removedSet.has(slot.name)).map(slot => {
          const sd = slide.brand!.slots.find(s => s.name === slot.name);
          const r = resolveSlotRect(slot, sd?.rect);
          const el = document.createElement('div');
          el.className = `bt__tile${sel === slot.name ? ' is-selected' : ''}${cropSlot === slot.name ? ' is-cropping' : ''}`;
          el.dataset.id = slot.name;
          el.style.left = `${r.x / B_SW * 100}%`;
          el.style.top = `${r.y / B_SH * 100}%`;
          el.style.width = `${r.w / B_SW * 100}%`;
          el.style.height = `${r.h / B_SH * 100}%`;
          el.style.position = 'absolute';
          el.setAttribute('aria-label', `${slot.role} tile: ${slot.name}`);
          if (sel === slot.name && !cropSlot) addSelectionChrome(el, Math.round(r.w), Math.round(r.h));
          return el;
        }));
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
          if (t.id === sel && t.rect) addSelectionChrome(el, t.rect.w, t.rect.h);
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
            b.insertBefore(dom, b.firstChild);
            requestAnimationFrame(() => {
              const scale = (b.clientWidth || 144) / B_SW;
              dom.style.cssText += `transform-origin:top left;transform:scale(${scale});`;
            });
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
      slideInfo.textContent = credits ? 'Credits update automatically.'
        : isBrand ? `Slide ${cur + 1} of ${deck.slides.length} · layout ${(slide.brand!.variant % 4) + 1} of 4`
        : `Slide ${cur + 1} of ${deck.slides.length} · ${slide.tiles.length} tiles · layout ${slide.variant % Math.max(1, vcount) + 1} of ${vcount}`;
      deckInfo.textContent = `${deck.slides.length} slides + ${vs.length - deck.slides.length} credits`;
      renderTileEditor();
      statusbar.set({ name: `${deck.title}  ${vs.length} slides`, state: credits ? 'Credits (auto)' : `Slide ${cur + 1}` });
    }

    function commit(relayout = false) {
      undoStack.push({ snapshot: lastSnap, cur, sel });
      redoStack.length = 0;
      if (undoStack.length > 50) undoStack.shift();
      applyCommit(relayout);
    }
    function applyCommit(relayout = false) {
      if (relayout && !isCredits(cur) && !deck.slides[cur]?.brand) deck.slides[cur] = layoutSlide(deck.slides[cur]);
      save(); render();
      lastSnap = JSON.stringify(deck);
    }
    function undo() {
      const entry = undoStack.pop();
      if (!entry) return;
      redoStack.push({ snapshot: JSON.stringify(deck), cur, sel });
      deck = JSON.parse(entry.snapshot);
      cur = Math.min(entry.cur, deck.slides.length - 1);
      sel = entry.sel;
      titleField.input.value = deck.title; themeChips.set(deck.theme);
      applyCommit();
    }
    function redo() {
      const entry = redoStack.pop();
      if (!entry) return;
      undoStack.push({ snapshot: JSON.stringify(deck), cur, sel });
      deck = JSON.parse(entry.snapshot);
      cur = Math.min(entry.cur, deck.slides.length - 1);
      sel = entry.sel;
      titleField.input.value = deck.title; themeChips.set(deck.theme);
      applyCommit();
    }

    function removeBrandTile(slotName: string) {
      const brand = deck.slides[cur]?.brand;
      if (!brand) return;
      const template = getBrandTemplate(brand.variant);
      const slotDef = template.find(s => s.name === slotName);
      if (!slotDef || slotDef.role === 'logo' || slotDef.role === 'palette') return;
      const removedSet = new Set(brand.removed ?? []);
      const rects = brandTileRects(brand).filter(t => !removedSet.has(t.name));
      const removedTile = rects.find(t => t.name === slotName);
      if (!removedTile) return;
      const neighbor = fillNeighbor(removedTile, rects, GUTTER_FX, GUTTER_FY);
      if (neighbor) {
        const tileMap = new Map(rects.map(t => [t.name, { ...t }]));
        applyRemoval(tileMap, slotName, neighbor, GUTTER_FX, GUTTER_FY);
        for (const [name, rect] of tileMap) {
          if (name === slotName) continue;
          const sd = brand.slots.find(s => s.name === name);
          if (sd) sd.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
          else brand.slots.push({ name, assetUrl: null, assetThumbUrl: null, fit: 'cover', cropX: 0.5, cropY: 0.3, cropZoom: 1, removedBg: false, focalX: 0.5, focalY: 0.3, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
        }
      }
      brand.removed = [...removedSet, slotName];
      sel = null;
      commit();
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
      // Brand slide tile editor
      if (slide?.brand && sel) {
        const brand = slide.brand;
        const template = getBrandTemplate(brand.variant);
        const slotDef = template.find(s => s.name === sel);
        if (!slotDef) { tileBody.append(note('Select a tile.')); return; }
        const slotData = brand.slots.find(s => s.name === sel);
        const r = resolveSlotRect(slotDef, slotData?.rect);
        // Position fields (W/H editable)
        const posRow = document.createElement('div'); posRow.className = 'bt__span';
        const mkPosField = (lbl: string, val: number, editable: boolean, onChange?: (v: number) => void) => {
          const f = field({ label: lbl, type: 'number', value: String(Math.round(val)), onChange: v => {
            if (!editable || !onChange) return;
            const n = Number(v); if (!Number.isFinite(n) || n < 1) return;
            onChange(n);
          }});
          if (!editable) f.input.readOnly = true;
          return f.el;
        };
        posRow.append(
          mkPosField('X', r.x, false),
          mkPosField('Y', r.y, false),
          mkPosField('W', r.w, true, w => {
            const sd = slotData ?? brand.slots[brand.slots.push({ name: sel!, assetUrl: null, assetThumbUrl: null, fit: 'cover', cropX: 0.5, cropY: 0.3, cropZoom: 1, removedBg: false, focalX: 0.5, focalY: 0.3 }) - 1];
            sd.rect = { x: r.x / B_SW, y: r.y / B_SH, w: w / B_SW, h: r.h / B_SH };
            commit();
          }),
          mkPosField('H', r.h, true, h => {
            const sd = slotData ?? brand.slots[brand.slots.push({ name: sel!, assetUrl: null, assetThumbUrl: null, fit: 'cover', cropX: 0.5, cropY: 0.3, cropZoom: 1, removedBg: false, focalX: 0.5, focalY: 0.3 }) - 1];
            sd.rect = { x: r.x / B_SW, y: r.y / B_SH, w: r.w / B_SW, h: h / B_SH };
            commit();
          }),
        );
        tileBody.append(posRow);
        if (slotDef.role === 'logo') {
          tileBody.append(field({ label: 'Background', value: brand.logo.bgColor, onChange: v => {
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { brand.logo.bgColor = v.length === 4 ? '#' + v[1]+v[1]+v[2]+v[2]+v[3]+v[3] : v; commit(); }
          }}).el);
          return;
        }
        if (slotDef.role === 'palette') {
          tileBody.append(note(brand.palette.join(', ')));
          return;
        }
        // Motion tile
        const hasGif = slotData?.gifUrl || (brand.motion?.slotName === sel && brand.motion?.gifUrl);
        if (hasGif) {
          const gifSrc = slotData?.gifUrl || brand.motion!.gifUrl!;
          tileBody.append(note('Motion tile'));
          tileBody.append(button({ label: 'Download GIF', onClick: () => {
            const a = document.createElement('a');
            a.href = gifSrc;
            a.download = `${deck.title || 'brand'}-motion.gif`;
            a.click();
          }}));
          tileBody.append(button({ label: 'Remove motion', onClick: () => {
            if (slotData) { delete slotData.isMotion; delete slotData.gifUrl; delete slotData.posterUrl; }
            if (brand.motion?.slotName === sel) brand.motion = null;
            commit();
          }}));
        } else if (slotData?.assetUrl) {
          tileBody.append(
            chips<'cover' | 'contain'>({ label: 'Fit', value: slotData.fit, options: [{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }], onChange: v => { slotData.fit = v as 'cover' | 'contain'; commit(); } }).el,
            button({ label: 'Remove image', onClick: () => { slotData.assetUrl = null; slotData.assetThumbUrl = null; commit(); } }),
            button({ label: 'Crop', onClick: () => { if (sel) enterCrop(sel); } }),
            button({ label: 'Set as motion tile', onClick: async () => {
              if (!slotData.assetUrl) return;
              emit('toast', 'Converting to GIF…');
              try {
                const { videoToGif } = await import('./motion');
                const r = resolveSlotRect(slotDef, slotData.rect);
                const result = await videoToGif(slotData.assetUrl, Math.round(r.w));
                slotData.isMotion = true;
                slotData.gifUrl = URL.createObjectURL(result.gif);
                slotData.posterUrl = URL.createObjectURL(result.poster);
                commit();
                emit('toast', `GIF ready: ${result.frames} frames, ${Math.round(result.gif.size / 1024)}KB`);
              } catch (e) { emit('toast', `GIF failed: ${e instanceof Error ? e.message : e}`); }
            }}),
          );
        } else {
          tileBody.append(note('Empty slot — drop an image.'));
        }
        tileBody.append(button({ label: 'Remove tile', onClick: () => { if (sel) removeBrandTile(sel); } }));
        return;
      }
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
    let bResize: {
      handle: HandleDir; bx: Boundary | null; by: Boundary | null;
      orig: Map<string, TileRect>; x0: number; y0: number;
      snapX: number[]; snapY: number[]; startAr: number; moved: boolean;
    } | null = null;

    function brandTileRects(brand: BrandSlide): TileRect[] {
      const tmpl = getBrandTemplate(brand.variant);
      const removedSet = new Set(brand.removed ?? []);
      return tmpl.filter(s => !removedSet.has(s.name)).map(s => {
        const sd = brand.slots.find(d => d.name === s.name);
        const r = sd?.rect;
        return r ? { name: s.name, x: r.x, y: r.y, w: r.w, h: r.h } : { name: s.name, x: s.x / B_SW, y: s.y / B_SH, w: s.w / B_SW, h: s.h / B_SH };
      });
    }

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
      if (deck.slides[cur]?.brand) {
        if (cropSlot) return;
        const handle = (e.target as HTMLElement).dataset.handle as HandleDir | undefined;
        if (handle) {
          const brand = deck.slides[cur].brand!;
          const rects = brandTileRects(brand);
          const boundaries = buildBoundaries(rects, GUTTER_FX, GUTTER_FY);
          const { bx, by } = boundariesForHandle(id, handle, boundaries);
          const orig = new Map(rects.map(t => [t.name, { ...t }]));
          const tile = orig.get(id)!;
          const xTargets: number[] = [0.5], yTargets: number[] = [0.5];
          for (const b of boundaries) (b.axis === 'x' ? xTargets : yTargets).push(b.pos);
          bResize = { handle, bx, by, orig, x0: e.clientX, y0: e.clientY, snapX: xTargets, snapY: yTargets, startAr: tile.w / tile.h, moved: false };
          document.addEventListener('pointermove', onBrandResize);
          document.addEventListener('pointerup', onBrandResizeUp);
          return;
        }
        const tmpl = getBrandTemplate(deck.slides[cur].brand!.variant);
        const sd = tmpl.find(s => s.name === id);
        if (!sd) return;
        if (sd.role === 'logo' || sd.role === 'palette') return;
        const fresh = overlay.querySelector<HTMLElement>(`.bt__tile[data-id="${id}"]`)!;
        drag = { id, mode: 'move', x0: e.clientX, y0: e.clientY, el: fresh, moved: false };
        fresh.setPointerCapture?.(e.pointerId);
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        return;
      }
      const fresh = overlay.querySelector<HTMLElement>(`.bt__tile[data-id="${id}"]`)!;
      drag = { id, mode: (e.target as HTMLElement).dataset.handle ? 'resize' : 'move', x0: e.clientX, y0: e.clientY, el: fresh, moved: false };
      fresh.setPointerCapture?.(e.pointerId);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    // Gutter hover + drag (brand slides)
    overlay.addEventListener('mousemove', e => {
      if (drag || bResize || cropSlot || !deck.slides[cur]?.brand) { overlay.style.cursor = ''; return; }
      if ((e.target as HTMLElement).closest('.bt__tile')) { overlay.style.cursor = ''; return; }
      const sr = slideEl.getBoundingClientRect();
      const px = (e.clientX - sr.left) / sr.width, py = (e.clientY - sr.top) / sr.height;
      const brand = deck.slides[cur].brand!;
      const rects = brandTileRects(brand);
      const tiles = new Map(rects.map(t => [t.name, t]));
      const boundaries = buildBoundaries(rects, GUTTER_FX, GUTTER_FY);
      const hit = boundaryAtPoint(boundaries, tiles, px, py, GUTTER_FX, GUTTER_FY);
      overlay.style.cursor = hit ? (hit.axis === 'x' ? 'col-resize' : 'row-resize') : '';
    });
    slideEl.addEventListener('pointerdown', e => {
      if (drag || bResize || cropSlot || !deck.slides[cur]?.brand) return;
      if ((e.target as HTMLElement).closest('.bt__tile')) return;
      const sr = slideEl.getBoundingClientRect();
      const px = (e.clientX - sr.left) / sr.width, py = (e.clientY - sr.top) / sr.height;
      const brand = deck.slides[cur].brand!;
      const rects = brandTileRects(brand);
      const boundaries = buildBoundaries(rects, GUTTER_FX, GUTTER_FY);
      const tiles = new Map(rects.map(t => [t.name, t]));
      const hit = boundaryAtPoint(boundaries, tiles, px, py, GUTTER_FX, GUTTER_FY);
      if (!hit) return;
      e.preventDefault();
      const orig = new Map(rects.map(t => [t.name, { ...t }]));
      const xTargets: number[] = [0.5], yTargets: number[] = [0.5];
      for (const b of boundaries) (b.axis === 'x' ? xTargets : yTargets).push(b.pos);
      bResize = {
        handle: hit.axis === 'x' ? 'e' : 's',
        bx: hit.axis === 'x' ? hit : null,
        by: hit.axis === 'y' ? hit : null,
        orig, x0: e.clientX, y0: e.clientY,
        snapX: xTargets, snapY: yTargets,
        startAr: 1, moved: false,
      };
      document.addEventListener('pointermove', onBrandResize);
      document.addEventListener('pointerup', onBrandResizeUp);
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
      const slide = deck.slides[cur];
      if (slide?.brand) {
        d0.el.style.transform = ''; d0.el.classList.remove('is-dragging');
        if (!d0.moved) return;
        d0.el.style.visibility = 'hidden';
        const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.bt__tile');
        d0.el.style.visibility = '';
        if (under && under.dataset.id !== d0.id) {
          const a = slide.brand.slots.find(s => s.name === d0.id);
          const b = slide.brand.slots.find(s => s.name === under.dataset.id);
          if (a && b) {
            const tmp = { assetUrl: a.assetUrl, assetThumbUrl: a.assetThumbUrl, fit: a.fit, cropX: a.cropX, cropY: a.cropY, cropZoom: a.cropZoom, removedBg: a.removedBg, focalX: a.focalX, focalY: a.focalY };
            Object.assign(a, { assetUrl: b.assetUrl, assetThumbUrl: b.assetThumbUrl, fit: b.fit, cropX: b.cropX, cropY: b.cropY, cropZoom: b.cropZoom, removedBg: b.removedBg, focalX: b.focalX, focalY: b.focalY });
            Object.assign(b, tmp);
            commit();
            return;
          }
        }
        render(); return;
      }
      if (d0.mode === 'resize') { if (d0.moved) commit(); return; }
      d0.el.style.transform = ''; d0.el.classList.remove('is-dragging');
      if (!d0.moved) return;
      d0.el.style.visibility = 'hidden';
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.bt__tile');
      d0.el.style.visibility = '';
      const a = slide.tiles.find(x => x.id === d0.id), b = under && slide.tiles.find(x => x.id === under.dataset.id);
      if (a && b && a !== b) { [a.rect, b.rect] = [b.rect, a.rect]; commit(); } else render();
    };

    /* ---- brand tile resize handlers ---- */
    const onBrandResize = (e: PointerEvent) => {
      if (!bResize) return;
      const slideRect = slideEl.getBoundingClientRect();
      const rawDx = (e.clientX - bResize.x0) / slideRect.width;
      const rawDy = (e.clientY - bResize.y0) / slideRect.height;
      if (!bResize.moved && Math.hypot(rawDx, rawDy) < 0.002) return;
      bResize.moved = true;
      const tiles = new Map(bResize.orig);
      // work on copies
      const work = new Map<string, TileRect>();
      for (const [k, v] of tiles) work.set(k, { ...v });
      const snapTx = 8 / slideRect.width;
      const snapTy = 8 / slideRect.height;
      const res = computeResize(work, bResize.bx, bResize.by, rawDx, rawDy, 0.06, 0.06, bResize.snapX, snapTx, e.shiftKey, bResize.startAr, bResize.snapY, snapTy);
      applyResize(work, bResize.bx, bResize.by, res.dx, res.dy);
      // Update overlay tiles visually
      for (const [name, t] of work) {
        const oel = overlay.querySelector<HTMLElement>(`.bt__tile[data-id="${name}"]`);
        if (oel) {
          oel.style.left = `${t.x * 100}%`; oel.style.top = `${t.y * 100}%`;
          oel.style.width = `${t.w * 100}%`; oel.style.height = `${t.h * 100}%`;
        }
        // Update brand DOM tiles
        if (brandDomEl) {
          const btel = brandDomEl.querySelector<HTMLElement>(`[data-slot="${name}"]`);
          if (btel) { btel.style.left = `${t.x * B_SW}px`; btel.style.top = `${t.y * B_SH}px`; btel.style.width = `${t.w * B_SW}px`; btel.style.height = `${t.h * B_SH}px`; }
        }
      }
      // Guide lines
      guides.innerHTML = '';
      if (res.snapX !== null) {
        const g = document.createElement('div'); g.className = 'bt__guide bt__guide--v';
        g.style.left = `${res.snapX * 100}%`;
        guides.appendChild(g);
      }
      if (res.snapY !== null) {
        const g = document.createElement('div'); g.className = 'bt__guide bt__guide--h';
        g.style.top = `${res.snapY * 100}%`;
        guides.appendChild(g);
      }
      // Update dimension pill
      const selTile = work.get(sel ?? '');
      if (selTile) {
        const dim = overlay.querySelector('.bt__dim');
        if (dim) dim.textContent = `${Math.round(selTile.w * B_SW)} × ${Math.round(selTile.h * B_SH)}`;
      }
    };
    const onBrandResizeUp = () => {
      if (!bResize) return;
      document.removeEventListener('pointermove', onBrandResize);
      document.removeEventListener('pointerup', onBrandResizeUp);
      guides.innerHTML = '';
      if (!bResize.moved) { bResize = null; return; }
      // Apply final positions to brand slot rects
      const brand = deck.slides[cur].brand!;
      // Replay the last pointer position's delta
      // Actually, apply the visual state: read from overlay elements
      const template = getBrandTemplate(brand.variant);
      for (const slot of template) {
        const oel = overlay.querySelector<HTMLElement>(`.bt__tile[data-id="${slot.name}"]`);
        if (!oel) continue;
        const fx = parseFloat(oel.style.left) / 100;
        const fy = parseFloat(oel.style.top) / 100;
        const fw = parseFloat(oel.style.width) / 100;
        const fh = parseFloat(oel.style.height) / 100;
        const orig = bResize.orig.get(slot.name);
        if (orig && (Math.abs(fx - orig.x) > 0.0001 || Math.abs(fy - orig.y) > 0.0001 || Math.abs(fw - orig.w) > 0.0001 || Math.abs(fh - orig.h) > 0.0001)) {
          const sd = brand.slots.find(s => s.name === slot.name);
          if (sd) sd.rect = { x: fx, y: fy, w: fw, h: fh };
          else {
            // logo/palette: store rect on the template slot via a new slot entry
            brand.slots.push({ name: slot.name, assetUrl: null, assetThumbUrl: null, fit: 'cover', cropX: 0.5, cropY: 0.3, cropZoom: 1, removedBg: false, focalX: 0.5, focalY: 0.3, rect: { x: fx, y: fy, w: fw, h: fh } });
          }
        }
      }
      bResize = null;
      commit();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!stage.closest('[data-active-tab]')) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); return; }
      }
      if (typing(e.target) || !sel || isCredits(cur) || e.metaKey || e.ctrlKey) return;
      if (e.key === 'Escape') {
        if (cropSlot) return;
        sel = null; render(); return;
      }
      if (e.key === 'Enter' && deck.slides[cur]?.brand && sel && !cropSlot) {
        enterCrop(sel); e.preventDefault(); return;
      }
      // Brand tiles: delete or no-op
      if (deck.slides[cur]?.brand) {
        if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeBrandTile(sel); }
        return;
      }
      const slide = deck.slides[cur], t = slide.tiles.find(x => x.id === sel); if (!t?.rect) return;
      const r = { ...t.rect };
      const k = e.key;
      if (k === 'Delete' || k === 'Backspace') { slide.tiles = slide.tiles.filter(x => x.id !== sel); sel = null; e.preventDefault(); commit(true); return; }
      const dx = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, dy = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      if (!dx && !dy) return;
      e.preventDefault();
      if (e.shiftKey) { r.w = Math.max(1, Math.min(COLS - r.x, r.w + dx)); r.h = Math.max(1, Math.min(ROWS - r.y, r.h + dy)); }
      else { r.x = Math.max(0, Math.min(COLS - r.w, r.x + dx)); r.y = Math.max(0, Math.min(ROWS - r.h, r.y + dy)); }
      t.rect = r; commit();
    };
    document.addEventListener('keydown', onKey);

    /* ---------------- brand tile: crop mode ---------------- */
    let cropSlot: string | null = null;
    let cropCleanup: (() => void) | null = null;
    let cropBar: HTMLElement | null = null;
    let cropOrig: { focalX: number; focalY: number; cropZoom: number } | null = null;

    function enterCrop(slotName: string) {
      if (cropSlot) confirmCrop();
      const brand = deck.slides[cur]?.brand;
      if (!brand) return;
      const slotData = brand.slots.find(s => s.name === slotName);
      if (!slotData?.assetUrl) return;

      cropSlot = slotName;
      cropOrig = { focalX: slotData.focalX, focalY: slotData.focalY, cropZoom: slotData.cropZoom };
      // Dim non-cropped tiles
      overlay.classList.add('is-crop-active');
      slideEl.classList.add('is-crop-active');
      const tileEl = overlay.querySelector<HTMLElement>(`.bt__tile[data-id="${slotName}"]`);
      if (tileEl) tileEl.classList.add('is-cropping');

      // Floating toolbar
      cropBar = document.createElement('div');
      cropBar.className = 'bt__crop-bar';
      cropBar.innerHTML = `<span class="bt__crop-label">Crop</span>`;
      const zoomSlider = document.createElement('input');
      Object.assign(zoomSlider, { type: 'range', min: '50', max: '300', step: '5', value: String(Math.round((slotData.cropZoom ?? 1) * 100)) });
      zoomSlider.className = 'bt__crop-zoom';
      zoomSlider.addEventListener('input', () => {
        slotData.cropZoom = Number(zoomSlider.value) / 100;
        updateBrandTileCSS(slotData);
      });
      cropBar.appendChild(zoomSlider);
      const cancelBtn = document.createElement('button'); cancelBtn.type = 'button';
      cancelBtn.className = 'bt__crop-btn'; cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => cancelCrop());
      cropBar.appendChild(cancelBtn);
      const confirmBtn = document.createElement('button'); confirmBtn.type = 'button';
      confirmBtn.className = 'bt__crop-btn bt__crop-btn--confirm'; confirmBtn.textContent = '✓';
      confirmBtn.addEventListener('click', () => confirmCrop());
      cropBar.appendChild(confirmBtn);
      slideEl.appendChild(cropBar);

      const onCropMove = (ev: PointerEvent) => {
        if (ev.buttons === 0) return;
        slotData.focalX = Math.max(0, Math.min(1, slotData.focalX - ev.movementX * 0.002));
        slotData.focalY = Math.max(0, Math.min(1, slotData.focalY - ev.movementY * 0.002));
        updateBrandTileCSS(slotData);
      };
      const onCropKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') { cancelCrop(); ev.preventDefault(); }
        if (ev.key === 'Enter') { confirmCrop(); ev.preventDefault(); }
      };
      document.addEventListener('pointermove', onCropMove);
      window.addEventListener('keydown', onCropKey);

      const cleanup = () => {
        document.removeEventListener('pointermove', onCropMove);
        window.removeEventListener('keydown', onCropKey);
        if (tileEl) tileEl.classList.remove('is-cropping');
        if (cropBar) { cropBar.remove(); cropBar = null; }
        overlay.classList.remove('is-crop-active');
        slideEl.classList.remove('is-crop-active');
        cropSlot = null; cropOrig = null; cropCleanup = null;
      };
      cropCleanup = cleanup;
    }
    function confirmCrop() {
      cropCleanup?.();
      commit();
    }
    function cancelCrop() {
      const brand = deck.slides[cur]?.brand;
      if (brand && cropOrig && cropSlot) {
        const sd = brand.slots.find(s => s.name === cropSlot);
        if (sd) { sd.focalX = cropOrig.focalX; sd.focalY = cropOrig.focalY; sd.cropZoom = cropOrig.cropZoom; }
      }
      cropCleanup?.();
      render();
    }

    overlay.addEventListener('dblclick', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.bt__tile');
      if (!el || !deck.slides[cur]?.brand) return;
      if (cropSlot === el.dataset.id) return;
      enterCrop(el.dataset.id!);
    });
    overlay.addEventListener('wheel', e => {
      if (!cropSlot || !deck.slides[cur]?.brand) return;
      e.preventDefault();
      const slotData = deck.slides[cur].brand!.slots.find(s => s.name === cropSlot);
      if (!slotData) return;
      slotData.cropZoom = Math.max(0.5, Math.min(3, (slotData.cropZoom ?? 1) + (e.deltaY > 0 ? -0.1 : 0.1)));
      updateBrandTileCSS(slotData);
      if (cropBar) { const z = cropBar.querySelector<HTMLInputElement>('.bt__crop-zoom'); if (z) z.value = String(Math.round(slotData.cropZoom * 100)); }
    }, { passive: false });

    /* ---------------- exports ---------------- */
    async function run(kind: 'pptx' | 'pdf' | 'png' | 'pngzip' | 'svg' | 'figma') {
      const vs = views();
      const base = slug(deck.title);
      const curSlide = vs[cur];
      const nn = String(cur + 1).padStart(2, '0');
      status.textContent = 'Exporting…';
      try {
        if (kind === 'pptx') {
          const { default: PptxGenJS } = await import('pptxgenjs');
          const pptx = new PptxGenJS();
          pptx.defineLayout({ name: 'LATHE_16x9', width: xctx.cfg.slideW, height: xctx.cfg.slideH });
          pptx.layout = 'LATHE_16x9'; pptx.title = deck.title; pptx.company = 'Lathe';
          pptx.theme = { headFontFace: 'Helvetica Neue', bodyFontFace: 'Helvetica Neue' };
          for (const s of vs) {
            if (s.brand) await brandSlideToPptx(s.brand, pptx, assets);
            else await addGridSlidesToPptx([drawSlide(s, deck, cfg)], pptx, xctx);
          }
          await saveExport(await writePptx(pptx), `${base}.pptx`, 'deck');
        } else if (kind === 'pdf') {
          const { jsPDF } = await import('jspdf');
          const doc = new jsPDF({ orientation: 'landscape', unit: 'in', format: [xctx.cfg.slideW, xctx.cfg.slideH], compress: true });
          doc.setProperties({ title: deck.title, creator: 'Lathe Deck' });
          for (let i = 0; i < vs.length; i++) {
            if (i) doc.addPage([xctx.cfg.slideW, xctx.cfg.slideH], 'landscape');
            if (vs[i].brand) await brandSlideToPdf(vs[i].brand!, doc);
            else { const ds = drawSlide(vs[i], deck, cfg); await deckToPdf([ds], xctx, deck.title, doc); }
          }
          await saveExport(doc.output('blob'), `${base}.pdf`, 'deck');
        } else if (kind === 'png') {
          if (curSlide.brand) await saveExport(await brandSlideToPng(curSlide.brand!), `${base}-slide-${nn}.png`, 'deck');
          else await saveExport(await slideToPng(drawSlide(curSlide, deck, cfg), xctx), `${base}-slide-${nn}.png`, 'deck');
        } else if (kind === 'pngzip') {
          const zip = (await import('jszip')).default;
          const z = new zip();
          for (let i = 0; i < vs.length; i++) {
            const fn = `${base}-${String(i + 1).padStart(2, '0')}.png`;
            if (vs[i].brand) z.file(fn, await brandSlideToPng(vs[i].brand!));
            else z.file(fn, await slideToPng(drawSlide(vs[i], deck, cfg), xctx));
          }
          await saveExport(await z.generateAsync({ type: 'blob' }), `${base}-slides.zip`, 'deck');
        } else if (kind === 'svg') {
          if (curSlide.brand) {
            const svg = await brandSlideToSvg(curSlide.brand!, assets);
            await saveExport(new Blob([svg], { type: 'image/svg+xml' }), `${base}-slide-${nn}.svg`, 'deck');
          } else {
            await saveExport(new Blob([await slideToSvg(drawSlide(curSlide, deck, cfg), xctx)], { type: 'image/svg+xml' }), `${base}-slide-${nn}.svg`, 'deck');
          }
        } else {
          if (curSlide.brand) {
            const svg = await brandSlideToSvg(curSlide.brand!, assets);
            await navigator.clipboard.writeText(svg);
            emit('toast', 'Brand slide copied as SVG. Paste into Figma for editable layers.');
          } else { await copyForFigma(drawSlide(curSlide, deck, cfg), xctx); emit('toast', 'Slide copied as SVG. Paste into Figma for editable layers.'); }
        }
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
          undoStack.length = 0; redoStack.length = 0;
          applyCommit();
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
      if (a.type.startsWith('image/')) {
        // Brand slide: replace selected tile's image
        const slide = deck.slides[cur];
        if (slide?.brand && sel) {
          const slotData = slide.brand.slots.find(s => s.name === sel);
          if (slotData) {
            slotData.assetUrl = `asset:${a.id}`;
            slotData.assetThumbUrl = assetUrl(a);
            commit();
            return;
          }
        }
        addImageAsset(a);
        return;
      }
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
      unmount() { off(); ro.disconnect(); if (cropCleanup) cropCleanup(); if (bResize) { document.removeEventListener('pointermove', onBrandResize); document.removeEventListener('pointerup', onBrandResizeUp); bResize = null; } document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); document.removeEventListener('keydown', onKey); if (drag) drag = null; },
      export: () => void run('pptx'),
    };
  },
};
