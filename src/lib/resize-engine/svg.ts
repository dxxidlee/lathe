/* tokens-exempt: writes SVG file content.
   layoutToSVG(layout) → an SVG string for one variant. Units are drawn in master coordinates inside
   a group carrying their placement matrix; text is drawn in output pixels with the face that was
   measured; tiles become a userSpaceOnUse pattern over their region. Ids the layout creates (clips,
   patterns) take `idPrefix`, so many variants can sit inline on one page. */
import { matrixAttr, num } from './matrix';
import type { Item, LayerNode, Layout } from './types';
import { attrString, escAttr, escText } from './xml';

export interface SvgOptions { idPrefix?: string }

export function layoutToSVG(layout: Layout, opts: SvgOptions = {}): string {
  const pfx = opts.idPrefix ?? 'lr';
  const defs: string[] = layout.defs ? [layout.defs] : [];
  const clipped = new Set<string>();

  const emit = (n: LayerNode, skip: Set<string>, noClip = false): string => {
    if (skip.has(n.id)) return '';
    let clip = '';
    if (n.clip && !noClip) {
      const id = `${pfx}-${n.id}-clip`;
      if (!clipped.has(id)) {
        clipped.add(id);
        defs.push(`<clipPath id="${escAttr(id)}" clipPathUnits="userSpaceOnUse">${n.clip.shapes.map(s => `<${s.tag}${attrString(s.attrs)} transform="${matrixAttr(s.matrix)}"/>`).join('')}</clipPath>`);
      }
      clip = ` clip-path="url(#${escAttr(id)})"`;
    }
    const a = `${attrString(n.attrs)}${clip} data-layer="${escAttr(n.id)}"`;
    if (n.kind === 'group') return `<g${a}>${n.children.map(c => emit(c, skip, noClip)).join('')}</g>`;
    if (n.kind === 'text') return `<text${a} transform="${matrixAttr(n.matrix)}">${n.text!.inner}</text>`;
    return `<${n.tag}${a} transform="${matrixAttr(n.matrix)}"/>`;
  };

  const body = layout.items.map((it: Item) => {
    if (it.type === 'unit') return `<g data-unit="${escAttr(it.id)}" transform="${matrixAttr(it.matrix)}"${attrString(it.inherit)}>${emit(it.node, new Set(it.skip))}</g>`;
    if (it.type === 'tile') {
      const id = `${pfx}-${it.id}-tile`, k = it.scale;
      // Tile content is drawn without its clips: the region does the clipping.
      const inner = it.node.kind === 'group' ? it.node.children.map(c => emit(c, new Set(), true)).join('') : emit(it.node, new Set(), true);
      defs.push(`<pattern id="${escAttr(id)}" patternUnits="userSpaceOnUse" x="${num(it.region.x)}" y="${num(it.region.y)}" width="${num(it.cell.w * k)}" height="${num(it.cell.h * k)}">`
        + `<g transform="${matrixAttr([k, 0, 0, k, -it.cell.x * k, -it.cell.y * k])}"${attrString(it.inherit)}${attrString(it.node.kind === 'group' ? it.node.attrs : {})}>${inner}</g></pattern>`);
      return `<rect data-unit="${escAttr(it.id)}" x="${num(it.region.x)}" y="${num(it.region.y)}" width="${num(it.region.w)}" height="${num(it.region.h)}" fill="url(#${escAttr(id)})"/>`;
    }
    const f = it.font;
    const anchor = it.align === 'start' ? '' : ` text-anchor="${it.align}"`;
    const ls = it.letterSpacing ? ` letter-spacing="${num(it.letterSpacing)}"` : '';
    const spans = it.lines.map((l, i) => `<tspan x="${num(it.x)}" y="${num(it.y + i * it.lineHeight)}">${escText(l)}</tspan>`).join('');
    return `<text data-layer="${escAttr(it.id)}"${it.field ? ` data-field="${escAttr(it.field)}"` : ''} font-family="${escAttr(`'${f.css}', sans-serif`)}" font-size="${num(it.fontSize)}" font-weight="${f.weight}"${f.style === 'italic' ? ' font-style="italic"' : ''} fill="${escAttr(it.fill)}"${ls}${anchor} xml:space="preserve">${spans}</text>`;
  }).join('');

  const W = num(layout.width), H = num(layout.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" overflow="hidden">`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body + '</svg>';
}
