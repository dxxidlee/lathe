import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShellLayout } from '../shell/ShellLayout';
import { useShell } from '../shell/state';
import { saveCustomTool, loadCustomTools, deleteCustomTool, type CustomTool } from '../lib/custom-tools';
import { addCustomEntry, removeCustomEntry } from '../tools/registry';

const EXAMPLES = [
  'A color palette generator from any image',
  'Pixel-sort an image for a glitch poster',
  'A type scale calculator with modular ratios',
  'Noise texture generator with grain controls',
];

type Phase = 'idle' | 'generating' | 'done' | 'error';

export function Make() {
  const shell = useShell();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<CustomTool | null>(null);
  const [library, setLibrary] = useState<CustomTool[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { document.title = 'Make a tool \u00b7 Lathe'; }, []);
  useEffect(() => { void loadCustomTools().then(setLibrary); }, []);
  useEffect(() => {
    shell.setStatus({ name: 'Make a tool', state: phase === 'generating' ? 'Generating\u2026' : phase === 'done' ? 'Ready to use' : 'Describe a tool you wish existed' });
    return () => shell.setStatus({});
  }, [phase]);

  async function generate(text: string) {
    const t = text.trim();
    if (!t) return;
    setPrompt(t);
    setPhase('generating');
    setError('');
    setResult(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/make', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: t }),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      if (!data.code) throw new Error('No code in response');

      const tool: CustomTool = {
        id: `custom-${data.id || Date.now().toString(36)}`,
        name: data.name || 'Custom tool',
        group: data.group || 'Image',
        description: data.description || t,
        defaults: data.defaults || [],
        code: data.code,
        createdAt: Date.now(),
        prompt: t,
      };
      setResult(tool);
      setPhase('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  async function saveAndOpen(tool: CustomTool) {
    await saveCustomTool(tool);
    addCustomEntry(tool);
    setLibrary(await loadCustomTools());
    shell.toast(`${tool.name} added to your library`);
    navigate(`/t/${tool.id}`);
  }

  async function removeTool(id: string) {
    await deleteCustomTool(id);
    removeCustomEntry(id);
    setLibrary(await loadCustomTools());
    shell.toast('Tool removed');
  }

  return (
    <ShellLayout title="Make a tool">
      <section className="stage" aria-label="Make a tool">
        <div className="mk">
          <form className="mk__ask" onSubmit={e => { e.preventDefault(); generate(prompt); }}>
            <label htmlFor="make-prompt" className="mk__label">Describe a tool you wish existed</label>
            <div className="mk__row">
              <input id="make-prompt" className="mk__input" value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder="Turn my photo into a halftone poster" autoComplete="off" disabled={phase === 'generating'} />
              <button type="submit" className="l-btn l-btn--primary mk__go" disabled={phase === 'generating' || !prompt.trim()}>
                {phase === 'generating' ? 'Generating\u2026' : 'Make it'}
              </button>
            </div>
            <div className="l-chip-row mk__examples">
              {EXAMPLES.map(ex => <button key={ex} type="button" className="l-chip" onClick={() => generate(ex)} disabled={phase === 'generating'}>{ex}</button>)}
            </div>
          </form>

          {phase === 'generating' && (
            <div className="mk__run">
              <div className="mk__spinner" />
              <p className="l-note">Claude is writing your tool. This takes 10-20 seconds.</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="mk__run">
              <p className="mk__error">{error}</p>
              <button type="button" className="l-btn" onClick={() => generate(prompt)}>Try again</button>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="mk__run mk__result">
              <div className="mk__result-head">
                <h2 className="mk__result-name">{result.name}</h2>
                <span className="mk__result-group">{result.group}</span>
              </div>
              <p className="l-note">{result.description}</p>
              {result.defaults.length > 0 && (
                <div className="l-stats">
                  {result.defaults.map(d => (
                    <div className="l-stat" key={d.key}>
                      <span className="l-stat__label">{d.label}</span>
                      <span className="l-stat__value">{String(d.value)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mk__result-actions">
                <button type="button" className="l-btn l-btn--primary" onClick={() => saveAndOpen(result)}>Add to library &amp; open</button>
                <button type="button" className="l-btn" onClick={() => generate(prompt)}>Regenerate</button>
              </div>
            </div>
          )}
        </div>
      </section>

      <aside className="inspector" aria-label="Inspector">
        <section className="l-section">
          <h3 className="l-section__title">Your library</h3>
          <div className="l-section__body">
            {library.length === 0 && <p className="l-note">Tools you make appear here. They persist across sessions.</p>}
            {library.map(t => (
              <div key={t.id} className="mk__lib-item">
                <button type="button" className="mk__lib-name" onClick={() => navigate(`/t/${t.id}`)}>{t.name}</button>
                <span className="mk__lib-group">{t.group}</span>
                <button type="button" className="mk__lib-del" onClick={() => removeTool(t.id)} title="Remove from library">&times;</button>
              </div>
            ))}
          </div>
        </section>
        {phase === 'idle' && (
          <section className="l-section">
            <h3 className="l-section__title">How it works</h3>
            <div className="l-section__body">
              <p className="l-note">Describe what you want. Claude writes a self-contained tool that runs in your browser with the same controls and stage as every built-in Lathe tool.</p>
              <p className="l-note">Generated tools are saved to your library and persist in your browser.</p>
            </div>
          </section>
        )}
      </aside>
    </ShellLayout>
  );
}
