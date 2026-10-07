import { describe, expect, it } from 'vitest';
import { layoutToSVG, parse, parseXml, render } from '../../src/lib/resize-engine/testing';
import { fixture, inter } from './helpers';

const SIX = [{ w: 1080, h: 1080 }, { w: 1920, h: 1080 }, { w: 1080, h: 1920 }, { w: 1200, h: 300 }, { w: 1500, h: 150 }, { w: 2000, h: 100 }];
const tiny = (rules: string, extra = '') => parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500">
  <rect data-name="box [${rules}]" x="100" y="50" width="200" height="100"/>${extra}</svg>`);
const unit = (l: ReturnType<typeof render>, id: string) => l.items.find(i => i.id === id)!;
const placed = (l: ReturnType<typeof render>, id: string) => {
  const it = unit(l, id); if (it.type !== 'unit') throw new Error('not a unit');
  const m = it.matrix; const n = it.node.bbox!;
  return { x: m[0] * n.x + m[4], y: m[3] * n.y + m[5], w: m[0] * n.w, h: m[3] * n.h };
};

describe('rules', () => {
  it('fixed + anchor keeps its size; margins scale with the artboard', () => {
    const l = render(tiny('fixed, anchor:br'), { w: 2000, h: 1000 }); // s0 = 2
    expect(placed(l, 'box')).toEqual({ x: 2000 - 700 * 2 - 200, y: 1000 - 350 * 2 - 100, w: 200, h: 100 });
  });
  it('a layer kept large by scale:min still takes its position from the artboard scale', () => {
    const p = placed(render(tiny('scale:0.5-1, anchor:br'), { w: 2000, h: 100 }), 'box'); // s0 = 0.2, s = 0.5
    expect(p).toEqual({ x: 2000 - 700 * 0.2 - 100, y: 100 - 350 * 0.2 - 50, w: 100, h: 50 });
  });
  it('anchor:tl scales margins and size by min(sx, sy)', () => {
    const p = placed(render(tiny('anchor:tl'), { w: 500, h: 500 }), 'box'); // s = 0.5
    expect(p).toEqual({ x: 50, y: 25, w: 100, h: 50 });
  });
  it('no rules: same relative position, contained scale', () => {
    const p = placed(render(tiny(''), { w: 2000, h: 500 }), 'box'); // s = 1, centre 200/1000 → 400/2000
    expect(p).toEqual({ x: 300, y: 50, w: 200, h: 100 });
  });
  it('stretch-x keeps both margins; stretch-y likewise', () => {
    expect(placed(render(tiny('stretch-x'), { w: 3000, h: 500 }), 'box')).toMatchObject({ x: 100, w: 3000 - 100 - 700 });
    expect(placed(render(tiny('stretch-y, anchor:tl'), { w: 1000, h: 900 }), 'box')).toMatchObject({ y: 50, h: 900 - 50 - 350 });
  });
  it('scale clamps between min and max', () => {
    expect(placed(render(tiny('scale:0.5-2, anchor:tl'), { w: 100, h: 50 }), 'box').w).toBe(100); // s 0.1 → 0.5
    expect(placed(render(tiny('scale:0.5-2, anchor:tl'), { w: 4000, h: 2000 }), 'box').w).toBe(400); // s 4 → 2
  });
  it('reflow moves the layer per breakpoint', () => {
    const m = tiny('anchor:tl, reflow:ultrawide=cr, reflow:wide=50/50');
    expect(render(m, { w: 1000, h: 1000 }).breakpoint).toBe('square');
    expect(placed(render(m, { w: 1000, h: 1000 }), 'box')).toMatchObject({ x: 100, y: 50 });
    expect(placed(render(m, { w: 2000, h: 1000 }), 'box')).toMatchObject({ x: 1000 - 200, y: 500 - 100 });
    const uw = render(m, { w: 5000, h: 500 });
    expect(uw.breakpoint).toBe('ultrawide');
    expect(placed(uw, 'box')).toMatchObject({ x: 5000 - 700 - 200, y: 250 + (100 - 250) - 50 }); // cr keeps its offset from the centre
  });
  it('hide-below drops the layer on small artboards', () => {
    expect(render(tiny('hide-below:300'), { w: 2000, h: 250 }).hidden).toEqual(['box']);
    expect(render(tiny('hide-below:w300'), { w: 2000, h: 250 }).hidden).toEqual([]);
    expect(render(tiny('hide-below:h300'), { w: 2000, h: 250 }).items).toHaveLength(0);
  });
  it('tile fills its region with a pattern of the cell', () => {
    const l = render(parse(fixture('tiled-pattern.svg')), { w: 2000, h: 100 });
    const dots = unit(l, 'dots'), stripes = unit(l, 'stripes');
    expect(dots).toMatchObject({ type: 'tile', region: { x: 0, y: 0, w: 2000, h: 100 }, cell: { x: 0, y: 0, w: 90, h: 90 }, scale: 1 });
    expect(stripes.type === 'tile' && stripes.region.w).toBe(2000);
    const svg = layoutToSVG(l, { idPrefix: 'v1' });
    expect(svg).toContain('<pattern id="v1-dots-tile" patternUnits="userSpaceOnUse" x="0" y="0" width="90" height="90">');
    expect(svg).not.toMatch(/<pattern[^>]*>(?:(?!<\/pattern>).)*clip-path/); // tile content is drawn unclipped
  });
});

describe('text', () => {
  const m = parse(fixture('headline-cta.svg'));
  it('measures with HarfBuzz on the real font', () => {
    const l = render(m, { w: 1080, h: 1080 }, {}, { shaper: inter });
    const h = unit(l, 'headline');
    expect(h.type).toBe('text');
    if (h.type !== 'text') return;
    expect(h.font).toMatchObject({ css: 'lr-inter', weight: 700, exact: true });
    expect(h.fontSize).toBe(120);
    expect(h.lines).toEqual(['Summer sale']);
    expect(l.fields.headline.status).toBe('fit');
    expect(l.warnings).toEqual([]);
  });
  it('shrinks to fit, down to min, then flags overflow', () => {
    const long = 'Summer sale on absolutely everything';
    const a = render(m, { w: 1080, h: 1080 }, { headline: long }, { shaper: inter });
    expect(a.fields.headline.status).toBe('shrunk');
    expect(a.fields.headline.fontSize).toBeLessThan(120);
    expect(a.fields.headline.fontSize).toBeGreaterThanOrEqual(20);
    const b = render(m, { w: 1500, h: 150 }, { headline: long }, { shaper: inter });
    expect(b.fields.headline).toMatchObject({ status: 'overflow', overflow: true, fontSize: 20 });
    expect(b.overflow).toBe(true);
  });
  it('wraps up to the line limit, then overflows', () => {
    const two = render(m, { w: 1080, h: 1080 }, { subline: 'Everything 30% off, this week only. Online and in stores.' }, { shaper: inter });
    expect(two.fields.subline).toMatchObject({ status: 'wrapped', lines: 2, overflow: false });
    const three = render(m, { w: 1080, h: 1080 }, { subline: 'Everything 30% off, this week only. Online and in stores near you, while stock lasts.' }, { shaper: inter });
    expect(three.fields.subline).toMatchObject({ status: 'overflow', overflow: true });
  });
  it('truncates with an ellipsis', () => {
    const l = render(m, { w: 1080, h: 1080 }, { cta: 'Shop the whole collection' }, { shaper: inter });
    const t = unit(l, 'label');
    expect(l.fields.cta).toMatchObject({ status: 'truncated', truncated: true, overflow: false });
    if (t.type === 'text') { expect(t.lines[0].endsWith('…')).toBe(true); expect(inter.measure(t.font, t.lines[0], t.fontSize, t.letterSpacing)).toBeLessThanOrEqual(t.box.w + 0.01); }
  });
  it('the six sizes from 1:1 to 20:1 render with the default copy, and every variant is valid SVG', () => {
    for (const s of SIX) {
      const l = render(m, s, {}, { shaper: inter });
      expect(l.overflow, `${s.w}×${s.h}`).toBe(false);
      const svg = layoutToSVG(l, { idPrefix: `v${s.w}x${s.h}` });
      expect(() => parseXml(svg)).not.toThrow();
      expect(svg).toContain(`viewBox="0 0 ${s.w} ${s.h}"`);
    }
    expect(render(m, { w: 1200, h: 300 }).hidden).toEqual(['subline']);
  });
  it('a missing font is measured and drawn with the stand-in, with a warning', () => {
    const odd = parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><text data-name="t [text:t]" x="10" y="60" font-family="Nope-Bold, Nope" font-size="40">Hi</text></svg>`);
    const l = render(odd, { w: 400, h: 100 }, {}, { shaper: inter });
    expect(l.warnings.map(w => w.code)).toEqual(['missing-font']);
    expect(layoutToSVG(l)).toContain(`font-family="'lr-inter', sans-serif" font-size="40" font-weight="700"`);
  });
  it('is deterministic', () => {
    const a = layoutToSVG(render(m, { w: 1200, h: 300 }, { headline: 'Same in, same out' }, { shaper: inter }));
    const b = layoutToSVG(render(parse(fixture('headline-cta.svg')), { w: 1200, h: 300 }, { headline: 'Same in, same out' }, { shaper: inter }));
    expect(a).toBe(b);
  });
});
