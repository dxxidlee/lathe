/* tokens-exempt: these are the scripted tools' default values (content colors), like a tool's defaults.ts.

   Make a tool (v1 dummy): the scripted generations. No API calls. A prompt is matched to one of three
   scripted tools by its words; anything else gets a generic sketch that ends on "Tool generation
   arrives in v2." Defaults made here are chosen by "You", and each quotes the words it came from. */
import type { DefaultsManifest } from '../tools/types';

export type ControlSpec =
  /** `scale` maps the slider's integer position to the value (e.g. 0.1 for tenths of a second). */
  | { kind: 'slider'; key: string; label: string; min: number; max: number; step?: number; unit?: string; scale?: number }
  | { kind: 'chips'; key: string; label: string; options: { value: string; label: string }[] }
  | { kind: 'color'; key: string; label: string }
  | { kind: 'text'; key: string; label: string };

export interface Script {
  id: 'halftone' | 'grid' | 'falling' | 'generic';
  name: string;
  group: string;
  intent: { verb: string; object: string; result: string };
  inputs: string[];
  outputs: string[];
  defaults: DefaultsManifest;
  controls: ControlSpec[];
  preview: 'halftone' | 'grid' | 'falling' | 'sketch';
}

export const EXAMPLES = [
  'Turn my photo into a halftone poster',
  'Make a grid for a 12-column editorial spread',
  'Animate my logo letters falling into place',
];

const you = (key: string, label: string, value: unknown, _words: string, extra: Partial<DefaultsManifest[number]> = {}) =>
  ({ key, label, value, ...extra }) as DefaultsManifest[number];

export function scriptFor(prompt: string): Script {
  const p = prompt.toLowerCase();
  const words = (re: RegExp, fallback: string) => re.exec(prompt)?.[0] ?? fallback;
  if (/halftone|dots?\b|screen ?print|poster/.test(p)) {
    const w = words(/halftone poster|halftone|poster/i, 'halftone');
    return {
      id: 'halftone', name: 'Halftone poster', group: 'Offcuts',
      intent: { verb: 'turn', object: 'a photo', result: 'a halftone poster' },
      inputs: ['Photo (JPG, PNG or WebP)'], outputs: ['Poster PNG at print size', 'Halftone SVG (vector dots)'],
      defaults: [
        you('cell', 'Dot cell', 14, w, { unit: 'px', min: 4, max: 40, step: 1 }),
        you('angle', 'Screen angle', 45, w, { unit: '°', min: 0, max: 90, step: 1 }),
        you('ink', 'Ink', '#000000', 'poster'),
        you('paper', 'Paper', '#E8FF1A', 'poster'),
        you('format', 'Poster format', '18 × 24 in', 'poster', { editable: false }),
      ],
      controls: [
        { kind: 'slider', key: 'cell', label: 'Dot cell', min: 4, max: 40, unit: ' px' },
        { kind: 'slider', key: 'angle', label: 'Screen angle', min: 0, max: 90, unit: '°' },
        { kind: 'color', key: 'ink', label: 'Ink' },
        { kind: 'color', key: 'paper', label: 'Paper' },
      ],
      preview: 'halftone',
    };
  }
  if (/grid|column|editorial|spread|layout|margin/.test(p)) {
    const cols = Number(/(\d+)\s*-?\s*col/.exec(p)?.[1] ?? 12);
    return {
      id: 'grid', name: 'Spread grid', group: 'Drawer',
      intent: { verb: 'make', object: 'a grid', result: `a ${cols}-column editorial spread` },
      inputs: ['Format: editorial spread, 420 × 297 mm'], outputs: ['SVG overlay', 'CSS grid snippet', 'InDesign-ready guides (PDF)'],
      defaults: [
        you('cols', 'Columns', cols, words(/\d+\s*-?\s*column/i, 'columns'), { min: 1, max: 24, step: 1 }),
        you('gutter', 'Gutter', 5, 'editorial', { unit: 'mm', min: 0, max: 20, step: 0.5 }),
        you('margin', 'Margins', 18, 'spread', { unit: 'mm', min: 0, max: 40, step: 1 }),
        you('baseline', 'Baseline', 4.5, 'editorial', { unit: 'mm', min: 2, max: 12, step: 0.5 }),
        you('fold', 'Show the fold', true, 'spread'),
      ],
      controls: [
        { kind: 'slider', key: 'cols', label: 'Columns', min: 1, max: 24 },
        { kind: 'slider', key: 'gutter', label: 'Gutter', min: 0, max: 20, step: 0.5, unit: ' mm' },
        { kind: 'slider', key: 'margin', label: 'Margins', min: 0, max: 40, unit: ' mm' },
        { kind: 'slider', key: 'baseline', label: 'Baseline', min: 2, max: 12, step: 0.5, unit: ' mm' },
      ],
      preview: 'grid',
    };
  }
  if (/animat|fall|letters?|motion|logo|drop/.test(p)) {
    return {
      id: 'falling', name: 'Logo drop', group: 'Offcuts',
      intent: { verb: 'animate', object: 'logo letters', result: 'letters falling into place' },
      inputs: ['Wordmark text (or a logo’s letters)', 'Typeface'], outputs: ['GIF (loops)', 'WebM'],
      defaults: [
        you('text', 'Letters', 'Lathe', 'my logo'),
        you('duration', 'Fall time', 1.4, 'falling', { unit: 's', min: 0.4, max: 4, step: 0.1 }),
        you('stagger', 'Between letters', 0.12, 'letters', { unit: 's', min: 0, max: 0.5, step: 0.01 }),
        you('easing', 'Landing', 'easeOutBounce', 'falling into place', { options: ['easeOutBounce', 'easeOutBack', 'easeOutCubic'] }),
        you('loop', 'Loop', 'loop', 'animate', { options: ['loop', 'pingpong', 'once'] }),
      ],
      controls: [
        { kind: 'text', key: 'text', label: 'Letters' },
        { kind: 'slider', key: 'duration', label: 'Fall time', min: 4, max: 40, unit: ' s', scale: 0.1 },
        { kind: 'slider', key: 'stagger', label: 'Between letters', min: 0, max: 50, unit: ' s', scale: 0.01 },
        { kind: 'chips', key: 'easing', label: 'Landing', options: [{ value: 'easeOutBounce', label: 'Bounce' }, { value: 'easeOutBack', label: 'Overshoot' }, { value: 'easeOutCubic', label: 'Settle' }] },
      ],
      preview: 'falling',
    };
  }
  // Generic: a sketch from the prompt's words, ending on v2.
  // The first word is the verb; the longer words after it stand in for the nouns.
  const nouns = prompt.replace(/[^\p{L}\p{N}\s-]/gu, '').split(/\s+/).slice(1).filter(w => w.length > 3 && !/^(make|turn|into|with|from|that|this|tool|want|wish|would|could|something|some|thing|which|there|their)$/i.test(w));
  const verb = /^\s*(\p{L}+)/u.exec(prompt)?.[1]?.toLowerCase() ?? 'make';
  return {
    id: 'generic', name: nouns.slice(0, 2).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ') || 'Your tool', group: 'Yours',
    intent: { verb, object: nouns.slice(0, 2).join(' ') || 'something', result: nouns.slice(2, 5).join(' ') || 'a new output' },
    inputs: [nouns[0] ? `${nouns[0]} (a file or text)` : 'A file'], outputs: ['A result you can export'],
    defaults: nouns.slice(0, 3).map((w, i) => you(`d${i}`, `${w[0].toUpperCase()}${w.slice(1)} setting`, 'to be decided', w, { editable: false })),
    controls: [],
    preview: 'sketch',
  };
}
