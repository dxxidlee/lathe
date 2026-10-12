import { useEffect, useMemo, useRef, useState } from 'react';
import { ShellLayout } from '../shell/ShellLayout';
import { DefaultsPanel } from '../shell/DefaultsPanel';
import { useShell } from '../shell/state';
import type { Edits } from '../lib/defaults';
import { same } from '../lib/defaults';
import { EXAMPLES, scriptFor, type ControlSpec, type Script } from './make-scripts';
import { FallingPreview, GridPreview, HalftonePreview, SketchPreview } from './make-previews';

/* Make a tool (v1 dummy). A prompt plays a scripted generation: the request is read into an intent,
   then inputs, outputs and defaults (chosen by "You") appear, the inspector assembles control by
   control, and the stage shows a working preview. Three prompts have scripted tools; anything else
   ends on "Tool generation arrives in v2." No API calls. */

type Item = { kind: 'intent' } | { kind: 'input'; text: string } | { kind: 'output'; text: string } | { kind: 'default'; i: number } | { kind: 'control'; i: number } | { kind: 'preview' } | { kind: 'done' };
const PACE: Record<Item['kind'], number> = { intent: 750, input: 350, output: 350, default: 300, control: 260, preview: 500, done: 0 };
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Make() {
  const shell = useShell();
  const [prompt, setPrompt] = useState('');
  const [script, setScript] = useState<Script | null>(null);
  const [shown, setShown] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const timer = useRef(0);
  useEffect(() => { document.title = 'Make a tool · Lathe'; }, []);

  const items = useMemo<Item[]>(() => !script ? [] : [
    { kind: 'intent' },
    ...script.inputs.map(text => ({ kind: 'input' as const, text })),
    ...script.outputs.map(text => ({ kind: 'output' as const, text })),
    ...script.defaults.map((_, i) => ({ kind: 'default' as const, i })),
    ...script.controls.map((_, i) => ({ kind: 'control' as const, i })),
    { kind: 'preview' }, { kind: 'done' },
  ], [script]);
  const done = !!script && shown >= items.length;
  const seen = (k: Item['kind']) => items.slice(0, shown).filter(x => x.kind === k).length;

  // Play the script one item at a time.
  useEffect(() => {
    if (!script || shown >= items.length) return;
    if (reduced()) { setShown(items.length); return; }
    timer.current = window.setTimeout(() => setShown(n => n + 1), PACE[items[shown].kind] || 200);
    return () => clearTimeout(timer.current);
  }, [script, shown, items]);

  useEffect(() => {
    if (!script) { shell.setStatus({ name: 'Make a tool', state: 'Describe a tool you wish existed' }); return; }
    shell.setStatus({ name: script.name, state: done ? (script.id === 'generic' ? 'Sketch only · tool generation arrives in v2' : 'Prototype · scripted for v1, generated in v2') : 'Generating…' });
  }, [script, done]);
  useEffect(() => () => shell.setStatus({}), []);

  function generate(text: string) {
    const t = text.trim();
    if (!t) return;
    const s = scriptFor(t);
    clearTimeout(timer.current);
    setPrompt(t); setScript(s); setShown(0);
    setValues(Object.fromEntries(s.defaults.map(d => [d.key, d.value])));
  }
  const edits: Edits = useMemo(() => {
    if (!script) return {};
    return Object.fromEntries(script.defaults.filter(d => !same(values[d.key], d.value)).map(d => [d.key, { value: values[d.key], at: 0 }]));
  }, [script, values]);
  const set = (k: string, v: unknown) => setValues(x => ({ ...x, [k]: v }));

  return (
    <ShellLayout title="Make a tool">
      <section className="stage" aria-label="Make a tool">
        <div className="mk">
          <form className="mk__ask" onSubmit={e => { e.preventDefault(); generate(prompt); }}>
            <label htmlFor="make-prompt" className="mk__label">Describe a tool you wish existed</label>
            <div className="mk__row">
              <input id="make-prompt" className="mk__input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Turn my photo into a halftone poster" autoComplete="off" />
              <button type="submit" className="l-btn l-btn--primary mk__go">Make it</button>
            </div>
            <div className="l-chip-row mk__examples">
              {EXAMPLES.map(ex => <button key={ex} type="button" className="l-chip" onClick={() => generate(ex)}>{ex}</button>)}
            </div>
          </form>

          {script && (
            <div className="mk__run" data-script={script.id} data-done={done}>
              <ol className="mk__log" aria-live="polite">
                <Step on={seen('intent') > 0} title="Reading your request">
                  <span className="mk-intent"><b>{script.intent.verb}</b> {script.intent.object} <span className="mk-intent__arrow">→</span> {script.intent.result}</span>
                </Step>
                <Step on={seen('input') > 0} title="Inputs">{script.inputs.slice(0, seen('input')).map(t => <span key={t} className="mk-tag">{t}</span>)}</Step>
                <Step on={seen('output') > 0} title="Outputs">{script.outputs.slice(0, seen('output')).map(t => <span key={t} className="mk-tag">{t}</span>)}</Step>
                <Step on={seen('default') > 0} title={`Defaults, chosen by you (${seen('default')} of ${script.defaults.length})`}>{null}</Step>
                {script.controls.length > 0 && <Step on={seen('control') > 0} title={`Inspector (${seen('control')} of ${script.controls.length} controls)`}>{null}</Step>}
                <Step on={seen('preview') > 0} title={script.id === 'generic' ? 'Sketch' : 'Preview'}>{null}</Step>
              </ol>
              <div className={`mk__preview${seen('preview') ? ' is-on' : ''}`}>
                {seen('preview') > 0 && (
                  script.preview === 'halftone' ? <HalftonePreview v={values} />
                    : script.preview === 'grid' ? <GridPreview v={values} />
                      : script.preview === 'falling' ? <FallingPreview v={values} />
                        : <SketchPreview script={script} prompt={prompt} />
                )}
              </div>
              {done && (
                <p className="mk__note">
                  {script.id === 'generic'
                    ? <>Tool generation arrives in v2.</>
                    : <>{script.name} is a scripted prototype: its controls work on this preview, but Lathe does not write tools yet. Tool generation arrives in v2.</>}
                </p>
              )}
              {!done && <button type="button" className="l-btn mk__skip" onClick={() => setShown(items.length)}>Skip to the end</button>}
            </div>
          )}
        </div>
      </section>

      <aside className="inspector" aria-label="Inspector">
        <div className="inspector__tool">
          {!script && (
            <section className="l-section">
              <h3 className="l-section__title">Inspector</h3>
              <p className="l-note">Inputs, outputs and defaults assemble here as the tool is generated. Defaults you set are chosen by you.</p>
            </section>
          )}
          {script && (
            <section className="l-section">
              <h3 className="l-section__title">{script.name}</h3>
              <div className="l-section__body mk-controls">
                {script.controls.slice(0, seen('control')).map(c => <Control key={c.key} c={c} value={values[c.key]} onChange={v => set(c.key, v)} />)}
                {script.controls.length === 0 && seen('preview') > 0 && <p className="l-note">No controls yet: tool generation arrives in v2.</p>}
              </div>
            </section>
          )}
        </div>
        {script && (
          <DefaultsPanel
            manifest={script.defaults.slice(0, seen('default'))}
            edits={edits}
            onEdit={(k, v) => set(k, v)}
            onResetRow={k => set(k, script.defaults.find(d => d.key === k)!.value)}
            onResetAll={() => setValues(Object.fromEntries(script.defaults.map(d => [d.key, d.value])))}
            onResetTool={() => { setScript(null); setPrompt(''); setShown(0); }}
          />
        )}
      </aside>
    </ShellLayout>
  );
}

function Step({ on, title, children }: { on: boolean; title: string; children: React.ReactNode }) {
  return (
    <li className={`mk-step${on ? ' is-on' : ''}`}>
      <span className="mk-step__title">{title}</span>
      {on && children && <span className="mk-step__body">{children}</span>}
    </li>
  );
}

/** Inspector controls, in the shared primitives' markup. */
function Control({ c, value, onChange }: { c: ControlSpec; value: unknown; onChange: (v: unknown) => void }) {
  if (c.kind === 'slider') {
    const k = c.scale ?? 1, pos = Math.round(Number(value) / k);
    return (
      <div className="l-slider mk-in">
        <label className="l-slider__label" htmlFor={`mk-${c.key}`}>{c.label}</label>
        <output className="l-slider__value">{`${+(pos * k).toFixed(2)}${c.unit ?? ''}`}</output>
        <input id={`mk-${c.key}`} className="l-slider__input" type="range" min={c.min} max={c.max} step={c.step ?? 1} value={pos}
          style={{ ['--p' as string]: `${((pos - c.min) / (c.max - c.min || 1)) * 100}%` }}
          onChange={e => onChange(+(Number(e.target.value) * k).toFixed(4))} />
      </div>
    );
  }
  if (c.kind === 'chips') {
    return (
      <div className="l-group mk-in">
        <div className="l-label">{c.label}</div>
        <div className="l-chip-row" role="radiogroup" aria-label={c.label}>
          {c.options.map(o => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`l-chip${value === o.value ? ' is-active' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>)}
        </div>
      </div>
    );
  }
  if (c.kind === 'color') {
    return (
      <label className="mk-color mk-in">
        <input type="color" className="l-swatch-input" value={String(value).toLowerCase()} onChange={e => onChange(e.target.value.toUpperCase())} aria-label={c.label} />
        {c.label} <span className="tabular">{String(value)}</span>
      </label>
    );
  }
  return (
    <div className="l-field mk-in">
      <label className="l-label" htmlFor={`mk-${c.key}`}>{c.label}</label>
      <input id={`mk-${c.key}`} className="l-input" value={String(value)} onChange={e => onChange(e.target.value || ' ')} />
    </div>
  );
}
