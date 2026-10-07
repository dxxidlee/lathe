import { describe, expect, it } from 'vitest';
import { decodeIllustratorId, parse, parseLayerName } from '../../src/lib/resize-engine';
import { fixture } from './helpers';

const find = (n: any, id: string): any => n.id === id ? n : n.children.map((c: any) => find(c, id)).find(Boolean);

describe('layer names', () => {
  it('decodes Illustrator ids', () => {
    expect(decodeIllustratorId('logo__x5B_fixed_x2C__anchor_x3A_tl_x5D_')).toBe('logo [fixed, anchor:tl]');
    expect(decodeIllustratorId('logo_x5B_fixed_x5D_')).toBe('logo[fixed]');
    expect(decodeIllustratorId('bar__x5B_stretch-x_x5D__2_')).toBe('bar [stretch-x]');
  });
  it('reads every rule', () => {
    const r = parseLayerName('headline [text:headline, fit:shrink, fit:wrap, min:24, lines:2, scale:0.5-2, anchor:tl, stretch-x, stretch-y, tile, hide-below:h120, reflow:wide=cr, reflow:ultrawide→30/50, fixed]');
    expect(r.base).toBe('headline');
    expect(r.unknown).toEqual([]);
    expect(r.rules).toEqual({
      text: 'headline', fit: ['shrink', 'wrap'], min: 24, lines: 2, scale: { min: 0.5, max: 2 }, anchor: 'tl', stretchX: true, stretchY: true, tile: true,
      hideBelow: { axis: 'h', px: 120 }, reflow: { wide: 'cr', ultrawide: { x: 30, y: 50 } }, fixed: true,
    });
  });
  it('keeps unknown rules aside', () => {
    expect(parseLayerName('x [anchor:middle, wobble]').unknown).toEqual(['anchor:middle', 'wobble']);
  });
  it('reads breakpoints in both spellings', () => {
    expect(parseLayerName('breakpoints [square<1.5, wide 1.5-4, ultrawide>4]').breakpoints).toEqual([{ id: 'square', max: 1.5 }, { id: 'wide', min: 1.5, max: 4 }, { id: 'ultrawide', min: 4 }]);
    expect(parseLayerName('breakpoints [square:0-1.5, ultrawide:4-]').breakpoints).toEqual([{ id: 'square', min: 0, max: 1.5 }, { id: 'ultrawide', min: 4, max: undefined }]);
  });
});

describe('parse', () => {
  it('reads an old-style Illustrator export (DOCTYPE entities, escaped ids, switch, nested transforms)', () => {
    const m = parse(fixture('logo-lockup.svg'));
    expect([m.width, m.height]).toEqual([1080, 1080]);
    expect(m.units).toEqual(['background', 'mark', 'wordmark']);
    expect(m.breakpoints.map(b => b.id)).toEqual(['square', 'wide', 'ultrawide']);
    // translate(390 230) · rotate(45 150 150) on a 212 square: a diamond 300 wide around (540, 380)
    const mark = find(m.root, 'mark');
    expect(mark.bbox.x).toBeCloseTo(390, 0); expect(mark.bbox.w).toBeCloseTo(300, 0);
    expect(mark.bbox.y).toBeCloseTo(230, 0); expect(mark.bbox.h).toBeCloseTo(300, 0);
    const rect = find(mark, 'rect-0.1.2.0.0.0') ?? mark.children[0].children[0];
    expect(rect.matrix[4]).not.toBe(0); // flattened: the leaf carries the absolute matrix
    const word = find(m.root, 'wordmark');
    expect(word.kind).toBe('text');
    expect(word.text).toMatchObject({ content: 'Lathe', fontSize: 150, x: 540, y: 820, align: 'middle', fill: '#000000' });
    expect(word.text.font).toEqual({ family: 'Inter', postscript: 'Inter-Medium', weight: 500, style: 'normal' });
    expect(word.text.letterSpacing).toBeCloseTo(-3);
    expect(m.fields).toEqual([{ id: 'brand', label: 'Brand', value: 'Lathe', layers: ['wordmark'], fit: ['shrink'], min: 14, lines: undefined }]);
    expect(m.warnings).toEqual([]);
  });

  it('inlines class styles and gives stable ids', () => {
    const svg = fixture('headline-cta.svg');
    const a = parse(svg), b = parse(svg);
    expect(a.units).toEqual(['bg', 'bar', 'logo', 'headline', 'subline', 'cta']);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(find(a.root, 'bar').attrs.fill).toBe('#e8ff1a');
    expect(find(a.root, 'headline').text.font).toEqual({ family: 'Inter', postscript: 'Inter-Bold', weight: 700, style: 'normal' });
    expect(a.fields.map(f => [f.id, f.value])).toEqual([['headline', 'Summer sale'], ['subline', 'Everything 30% off, this week only.'], ['cta', 'Shop now']]);
    expect(find(a.root, 'label').rules).toEqual({ text: 'cta', fit: ['truncate'] });
  });

  it('resolves clip groups to absolute clip shapes', () => {
    const m = parse(fixture('tiled-pattern.svg'));
    const stripes = find(m.root, 'stripes');
    const inner = stripes.children[0];
    expect(inner.clip.shapes).toHaveLength(1);
    expect(inner.clip.bbox).toEqual({ x: 0, y: 380, w: 1080, h: 320 });
    expect(inner.bbox).toEqual({ x: 0, y: 380, w: 60, h: 320 });
  });

  it('flattens transforms, including clips under a transformed group', () => {
    const m = parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">
      <defs><clipPath id="c"><rect width="50" height="50"/></clipPath></defs>
      <g data-name="a [anchor:tl]" transform="translate(100 20) scale(2)"><g transform="translate(10 10)"><rect width="40" height="10" clip-path="url(#c)"/></g></g></svg>`);
    const r = find(m.root, 'a').children[0].children[0];
    expect(r.matrix).toEqual([2, 0, 0, 2, 120, 40]);
    expect(r.bbox).toEqual({ x: 120, y: 40, w: 80, h: 20 });
    expect(r.clip.bbox).toEqual({ x: 120, y: 40, w: 100, h: 100 });
  });

  it('warns when a field layer has outlined text, and keeps live text as text', () => {
    const m = parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <g data-name="headline [text:headline]"><path d="M0 0h10v10z"/></g>
      <text data-name="tag [text:tag]" x="10" y="50" font-family="Inter" font-size="12">Hello <tspan>world</tspan></text></svg>`);
    expect(m.warnings.map(w => w.code)).toEqual(['outlined-text']);
    expect(m.fields.map(f => f.id)).toEqual(['tag']);
    expect(find(m.root, 'tag').text.content).toBe('Hello world');
  });

  it('groups kerned runs on one baseline into one line, and keeps multi-line leading', () => {
    const m = parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">
      <text data-name="t [text:t]" transform="translate(10 100)" font-size="40"><tspan x="0" y="0">H</tspan><tspan x="28" y="0">ello</tspan><tspan x="0" y="56">there</tspan></text></svg>`);
    expect(find(m.root, 't').text).toMatchObject({ content: 'Hello\nthere', lineHeight: 1.4 });
  });

  it('refuses what is not an SVG', () => {
    expect(() => parse('<html></html>')).toThrow(/Not an SVG/);
  });
});
