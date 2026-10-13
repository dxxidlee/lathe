/* Shared inspector primitives, framework-agnostic so vanilla tool modules can build their
   controls from them. Structure follows the reference suite: sections, chips, rails, stat rows.
   Styling lives in styles/primitives.css. */

type Opt<V> = { value: V; label: string; title?: string };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

/** A titled block in the inspector. */
export function section(title: string): { el: HTMLElement; body: HTMLElement } {
  const el = h('section', 'l-section');
  el.appendChild(h('h3', 'l-section__title', title));
  const body = h('div', 'l-section__body');
  el.appendChild(body);
  return { el, body };
}

/** A titled block that starts collapsed; clicking the title toggles it. */
export function advancedSection(title = 'Advanced'): { el: HTMLElement; body: HTMLElement } {
  const s = section(title);
  s.el.classList.add('l-section--advanced');
  s.el.querySelector('.l-section__title')!.addEventListener('click', () => s.el.classList.toggle('is-open'));
  return s;
}

export function label(text: string): HTMLElement {
  return h('div', 'l-label', text);
}

export function note(text: string): HTMLElement {
  return h('p', 'l-note', text);
}

/** Single- or multi-select chip row. */
export function chips<V extends string>(o: {
  label?: string; options: Opt<V>[]; value: V | V[]; multi?: boolean; onChange: (v: V | V[]) => void;
}) {
  const el = h('div', 'l-group');
  if (o.label) el.appendChild(label(o.label));
  const row = h('div', 'l-chip-row');
  row.setAttribute('role', o.multi ? 'group' : 'radiogroup');
  if (o.label) row.setAttribute('aria-label', o.label);
  el.appendChild(row);
  let value = o.value;
  const btns = o.options.map(opt => {
    const b = h('button', 'l-chip', opt.label);
    b.type = 'button';
    if (opt.title) b.title = opt.title;
    b.addEventListener('click', () => {
      if (o.multi) {
        const cur = new Set(value as V[]);
        cur.has(opt.value) ? cur.delete(opt.value) : cur.add(opt.value);
        value = o.options.map(x => x.value).filter(x => cur.has(x));
      } else value = opt.value;
      sync(); o.onChange(value);
    });
    row.appendChild(b);
    return b;
  });
  const sync = () => btns.forEach((b, i) => {
    const on = o.multi ? (value as V[]).includes(o.options[i].value) : value === o.options[i].value;
    b.classList.toggle('is-active', on);
    b.setAttribute(o.multi ? 'aria-pressed' : 'aria-checked', String(on));
    if (!o.multi) b.setAttribute('role', 'radio');
  });
  sync();
  return { el, set(v: V | V[]) { value = v; sync(); } };
}

/** Vertical rail selector: 7.5px track with a sliding thumb beside the options. */
export function rail<V extends string>(o: { label?: string; options: Opt<V>[]; value: V; onChange: (v: V) => void }) {
  const el = h('div', 'l-group');
  if (o.label) el.appendChild(label(o.label));
  const body = h('div', 'l-rail');
  const track = h('div', 'l-rail__track');
  const thumb = h('div', 'l-rail__thumb');
  track.appendChild(thumb);
  const opts = h('div', 'l-rail__opts');
  opts.setAttribute('role', 'radiogroup');
  if (o.label) opts.setAttribute('aria-label', o.label);
  body.append(track, opts);
  el.appendChild(body);
  let value = o.value;
  const btns = o.options.map(opt => {
    const b = h('button', 'l-rail__opt', opt.label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => { value = opt.value; sync(); o.onChange(value); });
    opts.appendChild(b);
    return b;
  });
  const sync = () => {
    btns.forEach((b, i) => {
      const on = o.options[i].value === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
      if (on) requestAnimationFrame(() => {
        thumb.style.transform = `translateY(${b.offsetTop - (btns[0]?.offsetTop ?? 0)}px)`;
        thumb.style.height = `${b.offsetHeight}px`;
      });
    });
  };
  sync();
  return { el, set(v: V) { value = v; sync(); } };
}

/** Range slider with a tabular readout. */
export function slider(o: {
  label: string; min: number; max: number; step?: number; value: number; unit?: string;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  const id = nextId('sl');
  const el = h('div', 'l-slider');
  const lab = h('label', 'l-slider__label', o.label);
  lab.htmlFor = id;
  const input = h('input', 'l-slider__input');
  Object.assign(input, { type: 'range', id, min: String(o.min), max: String(o.max), step: String(o.step ?? 1), value: String(o.value) });
  const out = h('output', 'l-slider__value');
  const fmt = (v: number) => (o.format ? o.format(v) : `${v}${o.unit ?? ''}`);
  const sync = () => {
    out.textContent = fmt(Number(input.value));
    input.style.setProperty('--p', `${((Number(input.value) - o.min) / (o.max - o.min || 1)) * 100}%`);
  };
  input.addEventListener('input', () => { sync(); o.onChange(Number(input.value)); });
  el.append(lab, out, input);
  sync();
  return { el, set(v: number) { input.value = String(v); sync(); } };
}

/** Label/value rows, values in tabular figures. */
export function statList(rows: [string, string][] = []) {
  const el = h('div', 'l-stats');
  const set = (next: [string, string][]) => {
    el.replaceChildren(...next.map(([k, v]) => {
      const r = h('div', 'l-stat');
      r.append(h('span', 'l-stat__label', k), h('span', 'l-stat__value', v));
      return r;
    }));
  };
  set(rows);
  return { el, set };
}

export function button(o: { label: string; primary?: boolean; title?: string; onClick: () => void }) {
  const b = h('button', `l-btn${o.primary ? ' l-btn--primary' : ''}`, o.label);
  b.type = 'button';
  if (o.title) b.title = o.title;
  b.addEventListener('click', o.onClick);
  return b;
}

export function field(o: { label: string; value: string; type?: 'text' | 'number'; placeholder?: string; onChange: (v: string) => void }) {
  const id = nextId('f');
  const el = h('div', 'l-field');
  const lab = h('label', 'l-label', o.label);
  lab.htmlFor = id;
  const input = h('input', 'l-input');
  Object.assign(input, { id, type: o.type ?? 'text', value: o.value, placeholder: o.placeholder ?? '', spellcheck: false });
  input.addEventListener('change', () => o.onChange(input.value));
  el.append(lab, input);
  return { el, input };
}

export function textarea(o: { label: string; value: string; placeholder?: string; rows?: number; onInput: (v: string) => void }) {
  const id = nextId('ta');
  const el = h('div', 'l-field');
  const lab = h('label', 'l-label', o.label);
  lab.htmlFor = id;
  const input = h('textarea', 'l-textarea');
  Object.assign(input, { id, value: o.value, placeholder: o.placeholder ?? '', rows: o.rows ?? 4, spellcheck: false });
  input.addEventListener('input', () => o.onInput(input.value));
  el.append(lab, input);
  return { el, input };
}

/** Modal dialog that closes on Escape, backdrop click and its Close button; restores focus. */
export function modal(o: { title: string; body: HTMLElement | HTMLElement[]; onClose?: () => void }): () => void {
  const prev = document.activeElement as HTMLElement | null;
  const scrim = h('div', 'l-scrim');
  const box = h('div', 'l-modal');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', o.title);
  const head = h('div', 'l-modal__head');
  const closeBtn = button({ label: 'Close', onClick: () => close() });
  head.append(h('h2', 'l-modal__title', o.title), closeBtn);
  const body = h('div', 'l-modal__body');
  body.append(...(Array.isArray(o.body) ? o.body : [o.body]));
  box.append(head, body);
  scrim.appendChild(box);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  scrim.addEventListener('mousedown', e => { if (e.target === scrim) close(); });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(scrim);
  closeBtn.focus();
  let open = true;
  function close() {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', onKey, true);
    scrim.remove();
    prev?.focus?.();
    o.onClose?.();
  }
  return close;
}

export function select<V extends string>(o: { label: string; options: Opt<V>[]; value: V; onChange: (v: V) => void }) {
  const id = nextId('sel');
  const el = h('div', 'l-field');
  const lab = h('label', 'l-label', o.label);
  lab.htmlFor = id;
  const sel = h('select', 'l-select');
  sel.id = id;
  const fill = (opts: Opt<V>[], value: V) => {
    sel.replaceChildren(...opts.map(op => { const x = h('option', undefined, op.label); x.value = op.value; return x; }));
    sel.value = value;
  };
  fill(o.options, o.value);
  sel.addEventListener('change', () => o.onChange(sel.value as V));
  el.append(lab, sel);
  return { el, input: sel, set(v: V) { sel.value = v; }, setOptions: fill };
}
