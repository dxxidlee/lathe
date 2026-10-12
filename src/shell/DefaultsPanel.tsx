import { useEffect, useState } from ‘react’;
import type { DefaultEntry, DefaultsManifest } from ‘../tools/types’;
import type { Edits } from ‘../lib/defaults’;
import { formatValue, isEditable, same } from ‘../lib/defaults’;

const HEX = /^#[0-9a-f]{6}$/i;

interface Props {
  manifest: DefaultsManifest;
  edits: Edits;
  onEdit: (key: string, value: unknown) => void;
  onResetRow: (key: string) => void;
  onResetAll: () => void;
  /** Clears the tool’s saved image and settings as well as these edits. */
  onResetTool: () => void;
}

export function DefaultsPanel({ manifest, edits, onEdit, onResetRow, onResetAll, onResetTool }: Props) {
  if (!manifest.length) return null;
  const n = Object.keys(edits).length;
  return (
    <section className="l-section defaults" aria-label="Defaults">
      <div className="defaults__head">
        <h3 className="l-section__title">Defaults</h3>
        <span className="defaults__count tabular" data-testid="defaults-edited">{n ? `${n} edited` : "Maker\u2019s"}</span>
      </div>
      <div className="defaults__list">
        {manifest.map(d => (
          <Row key={d.key} d={d} edit={edits[d.key]} onEdit={onEdit} onReset={onResetRow} />
        ))}
      </div>
      <div className="defaults__actions">
        <button type="button" className="l-btn" disabled={!n} onClick={onResetAll}>Reset to defaults</button>
        <button type="button" className="l-btn" onClick={onResetTool} title="Forget this tool’s image, settings and edits">Reset tool</button>
      </div>
    </section>
  );
}

function Row({ d, edit, onEdit, onReset }: {
  d: DefaultEntry; edit?: Edits[string];
  onEdit: Props[‘onEdit’]; onReset: Props[‘onResetRow’];
}) {
  const edited = !!edit;
  const value = edited ? edit!.value : d.value;
  const unit = d.unit ? <span className="defaults__unit">{d.unit}</span> : null;
  const commit = (v: unknown) => { if (!same(v, value)) onEdit(d.key, v); };
  const id = `def-${d.key}`;
  return (
    <div className={`defaults__row${edited ? ‘ is-edited’ : ‘’}`} data-key={d.key}>
      <label className="defaults__label" htmlFor={id}>{d.label}</label>
      <div className="defaults__editor">
        {isEditable(d) ? <Editor id={id} d={d} value={value} commit={commit} /> : <span className="defaults__static tabular" id={id}>{formatValue(value)}</span>}
        {unit}
      </div>
      {edited && (
        <div className="defaults__was">
          Maker: <s className="tabular">{formatValue(d.value)}{d.unit ? ` ${d.unit}` : ‘’}</s>
          <button type="button" className="defaults__reset" onClick={() => onReset(d.key)} aria-label={`Reset ${d.label}`}>Reset</button>
        </div>
      )}
    </div>
  );
}

/* ---- One editor per value shape ---- */
function Editor({ id, d, value, commit }: { id: string; d: DefaultEntry; value: unknown; commit: (v: unknown) => void }) {
  const opts = d.options;
  if (opts && Array.isArray(d.value)) {
    const cur = new Set(value as (string | number)[]);
    return (
      <span className="l-chip-row" role="group" aria-label={d.label} id={id}>
        {opts.map(o => (
          <button key={String(o)} type="button" className={`l-chip${cur.has(o) ? ' is-active' : ''}`} aria-pressed={cur.has(o)}
            onClick={() => { const next = new Set(cur); next.has(o) ? next.delete(o) : next.add(o); commit(opts.filter(x => next.has(x))); }}>
            {String(o)}
          </button>
        ))}
      </span>
    );
  }
  if (opts) {
    return (
      <select id={id} className="l-select defaults__input" value={String(value)}
        onChange={e => commit(typeof d.value === 'number' ? Number(e.target.value) : e.target.value)}>
        {opts.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    );
  }
  if (typeof d.value === 'boolean') {
    return <input id={id} type="checkbox" className="defaults__check" checked={!!value} onChange={e => commit(e.target.checked)} />;
  }
  if (typeof d.value === 'number') return <NumberEditor id={id} d={d} value={value as number} commit={commit} />;
  if (typeof d.value === 'string' && HEX.test(d.value)) return <ColorEditor id={id} value={value as string} commit={commit} />;
  if (typeof d.value === 'string') return <TextEditor id={id} value={value as string} commit={commit} />;
  return <JsonEditor id={id} d={d} value={value} commit={commit} />;
}

function decimals(n: number) { const s = String(n); return s.includes('.') ? s.split('.')[1].length : 0; }

function NumberEditor({ id, d, value, commit }: { id: string; d: DefaultEntry; value: number; commit: (v: unknown) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const step = d.step ?? 10 ** -decimals(d.value as number);
  const apply = () => {
    let n = Number(v);
    if (!Number.isFinite(n) || v.trim() === '') { setV(String(value)); return; }
    if (d.min != null) n = Math.max(d.min, n);
    if (d.max != null) n = Math.min(d.max, n);
    setV(String(n)); commit(n);
  };
  return (
    <input id={id} className="l-input defaults__input defaults__num" type="number" value={v} step={step} min={d.min} max={d.max}
      onChange={e => setV(e.target.value)} onBlur={apply} onKeyDown={e => { if (e.key === 'Enter') apply(); }} />
  );
}

function TextEditor({ id, value, commit }: { id: string; value: string; commit: (v: unknown) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const apply = () => { if (v.trim()) commit(v.trim()); else setV(value); };
  return <input id={id} className="l-input defaults__input" value={v} onChange={e => setV(e.target.value)} onBlur={apply} onKeyDown={e => { if (e.key === 'Enter') apply(); }} />;
}

function ColorEditor({ id, value, commit }: { id: string; value: string; commit: (v: unknown) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const apply = (x: string) => { const n = x.startsWith('#') ? x : '#' + x; if (HEX.test(n)) commit(n.toUpperCase()); else setV(value); };
  return (
    <span className="defaults__color">
      <input type="color" className="l-swatch-input" value={HEX.test(v) ? v : value} aria-label="Pick color" onChange={e => { setV(e.target.value.toUpperCase()); apply(e.target.value); }} />
      <input id={id} className="l-input defaults__input" value={v} onChange={e => setV(e.target.value)} onBlur={() => apply(v)} onKeyDown={e => { if (e.key === 'Enter') apply(v); }} />
    </span>
  );
}

function JsonEditor({ id, d, value, commit }: { id: string; d: DefaultEntry; value: unknown; commit: (v: unknown) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => JSON.stringify(value, null, 2));
  const [err, setErr] = useState('');
  useEffect(() => setV(JSON.stringify(value, null, 2)), [value]);
  const apply = () => {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(d.value) !== Array.isArray(parsed) || typeof parsed !== typeof d.value || parsed === null) throw new Error(`Must be ${Array.isArray(d.value) ? 'a list' : 'an object'}`);
      setErr(''); commit(parsed);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Not valid JSON'); }
  };
  return (
    <span className="defaults__json">
      <button type="button" className="l-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        {formatValue(value)} · {open ? 'Close' : 'Edit'}
      </button>
      {open && (
        <>
          <textarea id={id} className="l-textarea defaults__textarea" value={v} spellCheck={false} onChange={e => setV(e.target.value)} />
          <span className="l-row">
            <button type="button" className="l-btn l-btn--primary" onClick={apply}>Apply</button>
            {err && <span className="defaults__err" role="alert">{err}. Not applied.</span>}
          </span>
        </>
      )}
    </span>
  );
}
