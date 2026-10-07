/* tokens-exempt: reads and writes SVG file content, not Lathe's interface.
   A small XML parser and serializer for SVG, so the engine needs no DOM. It handles what
   Illustrator writes: the XML declaration, a DOCTYPE with an internal entity subset (older exports
   put namespace URLs in entities), comments, CDATA (style blocks), processing instructions, and
   character and named entities in text and attributes. */

export interface XEl { tag: string; attrs: Record<string, string>; children: XNode[] }
export type XNode = XEl | string;

const ATTR = /\s*([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
const TAG = /<([^\s/>!?]+)/y;
const CLOSE = /\s*(\/?)>/y;

export function parseXml(src: string): XEl {
  const ents: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const decode = (s: string) => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|[\w.-]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ents[e] ?? m);
  const doc: XEl = { tag: '#document', attrs: {}, children: [] };
  const stack: XEl[] = [doc];
  const top = () => stack[stack.length - 1];
  const text = (s: string) => { if (s) top().children.push(decode(s)); };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? src.length : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) {
      const e = src.indexOf(']]>', lt + 9); top().children.push(src.slice(lt + 9, e < 0 ? src.length : e)); i = e < 0 ? src.length : e + 3; continue;
    }
    if (src.startsWith('<!', lt)) { // DOCTYPE, possibly with an internal subset of entities
      let j = lt + 2, depth = 0;
      for (; j < src.length; j++) { const c = src[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break; }
      for (const m of src.slice(lt, j).matchAll(/<!ENTITY\s+([\w.-]+)\s+(["'])([\s\S]*?)\2\s*>/g)) ents[m[1]] = m[3];
      i = j + 1; continue;
    }
    if (src.startsWith('<?', lt)) { const e = src.indexOf('?>', lt + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (src[lt + 1] === '/') {
      const e = src.indexOf('>', lt); const name = src.slice(lt + 2, e < 0 ? src.length : e).trim();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break; }
      i = e < 0 ? src.length : e + 1; continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(src);
    if (!m) { text('<'); i = lt + 1; continue; }
    const el: XEl = { tag: m[1], attrs: {}, children: [] };
    let p = TAG.lastIndex;
    for (;;) {
      CLOSE.lastIndex = p;
      const c = CLOSE.exec(src);
      if (c) { p = CLOSE.lastIndex; top().children.push(el); if (!c[1]) stack.push(el); break; }
      ATTR.lastIndex = p;
      const a = ATTR.exec(src);
      if (!a || ATTR.lastIndex === p) { p = src.indexOf('>', p); p = p < 0 ? src.length : p + 1; top().children.push(el); break; }
      el.attrs[a[1]] = decode(a[2] ?? a[3] ?? a[4] ?? '');
      p = ATTR.lastIndex;
    }
    i = p;
  }
  const root = doc.children.find((c): c is XEl => typeof c !== 'string');
  if (!root) throw new Error('Not an XML document');
  return root;
}

export const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const attrString = (attrs: Record<string, string>) => Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');

export function serialize(n: XNode): string {
  if (typeof n === 'string') return escText(n);
  const inner = n.children.map(serialize).join('');
  return inner ? `<${n.tag}${attrString(n.attrs)}>${inner}</${n.tag}>` : `<${n.tag}${attrString(n.attrs)}/>`;
}

/** Concatenated text content. */
export const textOf = (n: XNode): string => typeof n === 'string' ? n : n.children.map(textOf).join('');
export const elements = (n: XEl) => n.children.filter((c): c is XEl => typeof c !== 'string');
/** The tag without a namespace prefix ("svg:g" → "g"). */
export const local = (tag: string) => tag.slice(tag.indexOf(':') + 1);
