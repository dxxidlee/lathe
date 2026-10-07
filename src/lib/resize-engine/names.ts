/* Layer names and the rules in them: `name [rule, rule:value]`. Illustrator writes a layer's name
   into data-name, or into the id with characters escaped (`_x5B_` for "[", spaces as "_", and a
   `_2_` suffix on duplicates). */
import type { Anchor, Breakpoint, Fit, Position, Rules } from './types';

const ANCHORS = new Set<Anchor>(['tl', 'tc', 'tr', 'cl', 'c', 'cr', 'bl', 'bc', 'br']);
const FITS = new Set<Fit>(['shrink', 'wrap', 'truncate']);

/** Illustrator's escaped id back to the layer name. */
export function decodeIllustratorId(id: string): string {
  return id
    .replace(/_\d+_$/, '')
    .replace(/_x([0-9A-F]{2,4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ParsedName { base: string; rules: Rules; unknown: string[]; breakpoints: Breakpoint[] | null }

/** `headline [text:headline, fit:shrink, min:24]` → base "headline" and its rules. */
export function parseLayerName(name: string): ParsedName {
  const m = /^(.*?)\s*\[([^\]]*)\]\s*$/.exec(name);
  const base = (m ? m[1] : name).trim();
  const rules: Rules = {}, unknown: string[] = [];
  if (!m) return { base, rules, unknown, breakpoints: null };
  const parts = m[2].split(/[,;]/).map(s => s.trim()).filter(Boolean);
  // A layer named "breakpoints" defines them: `breakpoints [square:0-1.5, wide:1.5-4, ultrawide:4-]`.
  if (/^breakpoints$/i.test(base)) {
    const bps: Breakpoint[] = [];
    for (const p of parts) {
      const r = /^([\w-]+)\s*(?::\s*(\d*\.?\d*)\s*-\s*(\d*\.?\d*)|<\s*(\d*\.?\d+)|>\s*(\d*\.?\d+)|\s+(\d*\.?\d+)\s*[-–]\s*(\d*\.?\d+))$/.exec(p);
      if (!r) { unknown.push(p); continue; }
      const num = (v?: string) => (v ? Number(v) : undefined);
      bps.push(r[4] ? { id: r[1], max: num(r[4]) } : r[5] ? { id: r[1], min: num(r[5]) } : r[6] ? { id: r[1], min: num(r[6]), max: num(r[7]) } : { id: r[1], min: num(r[2]), max: num(r[3]) });
    }
    return { base, rules, unknown, breakpoints: bps };
  }
  for (const p of parts) {
    const i = p.indexOf(':');
    const key = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase(), val = i < 0 ? '' : p.slice(i + 1).trim();
    const n = Number(val);
    switch (key) {
      case 'fixed': rules.fixed = true; break;
      case 'anchor': if (ANCHORS.has(val.toLowerCase() as Anchor)) rules.anchor = val.toLowerCase() as Anchor; else unknown.push(p); break;
      case 'stretch-x': rules.stretchX = true; break;
      case 'stretch-y': rules.stretchY = true; break;
      case 'stretch': rules.stretchX = rules.stretchY = true; break;
      case 'scale': {
        if (!val) { rules.scale = {}; break; }
        const r = /^(\d*\.?\d*)\s*(?:-|\.\.|–)\s*(\d*\.?\d*)$/.exec(val);
        if (r) rules.scale = { min: r[1] ? Number(r[1]) : undefined, max: r[2] ? Number(r[2]) : undefined };
        else unknown.push(p);
        break;
      }
      case 'scale-min': if (Number.isFinite(n)) rules.scale = { ...rules.scale, min: n }; else unknown.push(p); break;
      case 'scale-max': if (Number.isFinite(n)) rules.scale = { ...rules.scale, max: n }; else unknown.push(p); break;
      case 'tile': rules.tile = true; break;
      case 'reflow': {
        // reflow:wide=cl, reflow:wide>cl, reflow:wide→cl, or a centre in percent: reflow:wide=30/50
        const r = /^([\w-]+)\s*(?:=|>|→|->)\s*(.+)$/.exec(val);
        const pos = r ? parsePosition(r[2]) : null;
        if (r && pos) rules.reflow = { ...rules.reflow, [r[1]]: pos }; else unknown.push(p);
        break;
      }
      case 'hide-below': {
        const r = /^([wh])?\s*(\d*\.?\d+)\s*(?:px)?$/i.exec(val);
        if (r) rules.hideBelow = { axis: (r[1]?.toLowerCase() as 'w' | 'h') ?? 'min', px: Number(r[2]) }; else unknown.push(p);
        break;
      }
      case 'text': if (/^[\w-]+$/.test(val)) rules.text = val; else unknown.push(p); break;
      case 'fit': if (FITS.has(val as Fit)) rules.fit = [...(rules.fit ?? []), val as Fit]; else unknown.push(p); break;
      case 'min': if (n > 0) rules.min = n; else unknown.push(p); break;
      case 'lines': case 'max-lines': if (n >= 1) rules.lines = Math.floor(n); else unknown.push(p); break;
      default: unknown.push(p);
    }
  }
  return { base, rules, unknown, breakpoints: null };
}

function parsePosition(v: string): Position | null {
  const a = v.trim().toLowerCase();
  if (ANCHORS.has(a as Anchor)) return a as Anchor;
  const r = /^(-?\d*\.?\d+)%?\s*\/\s*(-?\d*\.?\d+)%?$/.exec(a);
  return r ? { x: Number(r[1]), y: Number(r[2]) } : null;
}

/** True when a layer has rules that place it (not just a field binding). */
export const placesItself = (r: Rules) => !!(r.fixed || r.anchor || r.stretchX || r.stretchY || r.scale || r.tile || r.reflow || r.hideBelow);

export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
