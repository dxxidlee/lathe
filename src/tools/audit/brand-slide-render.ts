/* Render a BrandSlide to DOM or canvas. Single source of truth for layout. */
import { getTemplate, SLIDE_W, SLIDE_H, RADIUS, type BrandSlide, type SlotRect } from './brand-slide';
import { proxied } from './api';

/** Render the slide as a DOM element for the editing stage. */
export function renderSlideDOM(slide: BrandSlide): HTMLElement {
  const template = getTemplate(slide.variant);
  const el = document.createElement('div');
  el.className = 'brand-slide';
  el.style.cssText = `position:relative;width:${SLIDE_W}px;height:${SLIDE_H}px;background:${slide.theme === 'dark' ? '#000' : '#fff'};overflow:hidden;border-radius:${RADIUS}px;`;

  for (const slot of template) {
    const tile = document.createElement('div');
    tile.className = 'brand-slide__tile';
    tile.dataset.slot = slot.name;
    tile.style.cssText = `position:absolute;left:${slot.x}px;top:${slot.y}px;width:${slot.w}px;height:${slot.h}px;border-radius:${RADIUS}px;overflow:hidden;`;

    if (slot.role === 'logo') {
      tile.style.background = slide.logo.bgColor;
      if (slide.logo.assetUrl) {
        const img = document.createElement('img');
        img.src = slide.logo.assetUrl;
        img.style.cssText = 'position:absolute;inset:20%;width:60%;height:60%;object-fit:contain;';
        img.onerror = () => { img.src = proxied(slide.logo.assetUrl); };
        tile.appendChild(img);
      }
    } else if (slot.role === 'palette') {
      tile.style.display = 'flex';
      for (const hex of slide.palette) {
        const stripe = document.createElement('div');
        stripe.style.cssText = `flex:1;background:${hex};`;
        tile.appendChild(stripe);
      }
    } else if (slot.role === 'cutout') {
      tile.style.background = 'transparent';
      const slotData = slide.slots.find(s => s.name === slot.name);
      if (slotData?.assetUrl) {
        const img = document.createElement('img');
        img.src = slotData.assetThumbUrl || slotData.assetUrl;
        img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
        img.onerror = () => { img.src = proxied(slotData.assetUrl!); };
        tile.appendChild(img);
      }
    } else {
      const slotData = slide.slots.find(s => s.name === slot.name);
      if (slotData?.assetUrl) {
        if (!slot.hasTileBg) tile.style.background = 'transparent';
        else tile.style.background = slide.theme === 'dark' ? '#141414' : '#f0f0f0';
        const img = document.createElement('img');
        img.src = slotData.assetThumbUrl || slotData.assetUrl;
        img.style.cssText = `width:100%;height:100%;object-fit:${slotData.fit};object-position:${slotData.focalX * 100}% ${slotData.focalY * 100}%;`;
        img.onerror = () => { img.src = proxied(slotData.assetUrl!); };
        tile.appendChild(img);
      } else {
        tile.style.background = slot.hasTileBg ? (slide.theme === 'dark' ? '#141414' : '#f0f0f0') : 'transparent';
      }
    }

    el.appendChild(tile);
  }

  return el;
}

/** Render the slide to a canvas for PNG export. */
export async function renderSlideCanvas(slide: BrandSlide, scale = 2): Promise<HTMLCanvasElement> {
  const template = getTemplate(slide.variant);
  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_W * scale;
  canvas.height = SLIDE_H * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = slide.theme === 'dark' ? '#000000' : '#FFFFFF';
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

  // Helper: load image
  const loadImg = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Try proxy
      const img2 = new Image();
      img2.crossOrigin = 'anonymous';
      img2.onload = () => resolve(img2);
      img2.onerror = reject;
      img2.src = proxied(src);
    };
    img.src = src;
  });

  for (const slot of template) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(slot.x, slot.y, slot.w, slot.h, RADIUS);
    ctx.clip();

    if (slot.role === 'logo') {
      ctx.fillStyle = slide.logo.bgColor;
      ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      if (slide.logo.assetUrl) {
        try {
          const img = await loadImg(slide.logo.assetUrl);
          const iw = slot.w * 0.6, ih = slot.h * 0.6;
          const ix = slot.x + (slot.w - iw) / 2, iy = slot.y + (slot.h - ih) / 2;
          ctx.drawImage(img, ix, iy, iw, ih);
        } catch { /* skip */ }
      }
    } else if (slot.role === 'palette') {
      const pw = slot.w / Math.max(1, slide.palette.length);
      slide.palette.forEach((hex, i) => {
        ctx.fillStyle = hex;
        ctx.fillRect(slot.x + i * pw, slot.y, pw, slot.h);
      });
    } else {
      const slotData = slide.slots.find(s => s.name === slot.name);
      if (slotData?.assetUrl) {
        ctx.fillStyle = slot.hasTileBg ? (slide.theme === 'dark' ? '#141414' : '#f0f0f0') : 'transparent';
        if (slot.hasTileBg) ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
        try {
          const img = await loadImg(slotData.assetUrl);
          if (slotData.fit === 'contain') {
            const s = Math.min(slot.w / img.width, slot.h / img.height);
            const sw = img.width * s, sh = img.height * s;
            ctx.drawImage(img, slot.x + (slot.w - sw) / 2, slot.y + (slot.h - sh) / 2, sw, sh);
          } else {
            // Cover with focal point
            const imgAr = img.width / img.height;
            const slotAr = slot.w / slot.h;
            let srcW: number, srcH: number, sx: number, sy: number;
            if (imgAr > slotAr) {
              srcH = img.height; srcW = srcH * slotAr;
              sx = (img.width - srcW) * slotData.focalX; sy = 0;
            } else {
              srcW = img.width; srcH = srcW / slotAr;
              sx = 0; sy = (img.height - srcH) * slotData.focalY;
            }
            ctx.drawImage(img, sx, sy, srcW, srcH, slot.x, slot.y, slot.w, slot.h);
          }
        } catch { /* empty tile */ }
      } else {
        ctx.fillStyle = slot.hasTileBg ? (slide.theme === 'dark' ? '#141414' : '#f0f0f0') : 'transparent';
        if (slot.hasTileBg) ctx.fillRect(slot.x, slot.y, slot.w, slot.h);
      }
    }
    ctx.restore();
  }

  return canvas;
}
