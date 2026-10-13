import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useShell } from '../shell/state';
import {
  saveCustomTool, loadCustomTools, deleteCustomTool,
  addVersion, restoreVersion, currentVersion, exportLibrary, importLibrary,
  type CustomTool, type ChatMessage, type ToolVersion,
} from '../lib/custom-tools';
import { addCustomEntry, removeCustomEntry, TOOLS, isReady } from '../tools/registry';
import { createSandbox, type Sandbox } from '../lib/tool-sandbox';
import { assets } from '../lib/assets';
import { getSession } from '../lib/auth';
import tokensCss from '../styles/tokens.css?raw';
import primitiveCss from '../styles/primitives.css?raw';

const BASE_TOOLS = TOOLS.filter(t => isReady(t) && t.id !== 'subject-audit' && t.id !== 'brand-audit' && !t.dev);
const TOOL_SOURCES = import.meta.glob('../tools/**/*', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const SOURCE_CAP = 15000;

async function loadToolSource(toolId: string): Promise<string | null> {
  const prefix = `../tools/${toolId}/`;
  const parts: string[] = [];
  let total = 0;
  for (const [path, load] of Object.entries(TOOL_SOURCES)) {
    if (!path.startsWith(prefix)) continue;
    const content = await load();
    total += content.length;
    if (total > SOURCE_CAP) return null;
    parts.push(`// ${path.slice(prefix.length)}\n${content}`);
  }
  return parts.length ? parts.join('\n\n') : null;
}

const EXAMPLES = [
  'A color palette generator from any image',
  'Pixel-sort an image for a glitch poster',
  'A type scale calculator with modular ratios',
  'Noise texture generator with grain controls',
];

export function Make() {
  const shell = useShell();
  const navigate = useNavigate();
  const [tool, setTool] = useState<CustomTool | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [baseTool, setBaseTool] = useState('');
  const [library, setLibrary] = useState<CustomTool[]>([]);

  const sandboxRef = useRef<Sandbox | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number>(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { document.title = 'Make a tool \u00b7 Lathe'; }, []);
  useEffect(() => { void loadCustomTools().then(setLibrary); }, []);
  useEffect(() => () => { sandboxRef.current?.destroy(); }, []);

  useEffect(() => {
    const state = sending ? `Building\u2026 ${elapsed}s` : tool ? tool.name : 'What do you keep doing by hand?';
    shell.setStatus({ name: 'Make a tool', state });
  }, [sending, elapsed, tool]);
  useEffect(() => () => shell.setStatus({}), []);

  useEffect(() => {
    if (!sending) { setElapsed(0); return; }
    const t0 = Date.now();
    timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(timerRef.current);
  }, [sending]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chat]);

  const mountInSandbox = useCallback((code: string, defaults: Record<string, unknown>) => {
    setSandboxError(null);
    if (!previewRef.current) return;
    if (!sandboxRef.current) {
      const sb = createSandbox(previewRef.current, tokensCss + '\n' + primitiveCss);
      sb.onMessage(msg => {
        if (msg.type === 'error') setSandboxError(msg.message || 'Unknown error');
        if (msg.type === 'toast' && msg.message) shell.toast(msg.message);
      });
      sandboxRef.current = sb;
    }
    setTimeout(() => sandboxRef.current?.mount(code, defaults), 300);
  }, [shell]);

  async function callAPI(userPrompt: string, currentCode?: string, baseSource?: string) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const body: Record<string, string> = { prompt: userPrompt };
    if (currentCode) body.currentCode = currentCode;
    if (baseSource) body.baseSource = baseSource;
    const session = await getSession();
    const token = session?.access_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/make', { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    if (!data.code) throw new Error('No code in response');
    return data as { id: string; name: string; group: string; description: string; defaults: ToolVersion['defaults']; code: string };
  }

  async function start(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    setPrompt('');
    setSending(true);
    const newChat: ChatMessage[] = [{ role: 'user', content: t, versionId: null }];
    setChat(newChat);
    try {
      let baseSource: string | undefined;
      if (baseTool) {
        const entry = TOOLS.find(x => x.id === baseTool);
        if (entry) {
          const src = await loadToolSource(entry.id);
          baseSource = src || `Tool: ${entry.name} (${entry.group})\nDescription: ${entry.blurb}`;
        }
      }
      const data = await callAPI(t, undefined, baseSource);
      const now = Date.now();
      const vid = `v_${now.toString(36)}`;
      const v: ToolVersion = { id: vid, code: data.code, name: data.name, group: data.group, description: data.description, defaults: data.defaults || [], createdAt: now };
      const newTool: CustomTool = {
        id: `custom-${data.id || now.toString(36)}`, name: v.name, group: v.group, description: v.description,
        defaults: v.defaults, code: v.code, createdAt: now, prompt: t,
        versions: [v], currentVersionIndex: 0,
        chat: [...newChat, { role: 'assistant', content: v.description, versionId: vid }],
      };
      setTool(newTool);
      setChat(newTool.chat);
      mountInSandbox(v.code, Object.fromEntries(v.defaults.map(d => [d.key, d.value])));
      if (shell.isMobile) setMobilePanel('preview');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : String(e);
      setChat(c => [...c, { role: 'assistant', content: msg, versionId: null, error: msg }]);
    } finally { setSending(false); }
  }

  async function refine(text: string) {
    if (!tool || sending) return;
    const t = text.trim();
    if (!t) return;
    setPrompt('');
    setSending(true);
    const updated: ChatMessage[] = [...chat, { role: 'user', content: t, versionId: null }];
    setChat(updated);
    try {
      const cv = currentVersion(tool);
      const data = await callAPI(t, cv.code);
      const now = Date.now();
      const vid = `v_${now.toString(36)}`;
      const v: ToolVersion = { id: vid, code: data.code, name: data.name || cv.name, group: data.group || cv.group, description: data.description || cv.description, defaults: data.defaults || cv.defaults, createdAt: now };
      const next = addVersion(tool, v);
      next.chat = [...updated, { role: 'assistant', content: data.description || 'Updated', versionId: vid }];
      setTool(next);
      setChat(next.chat);
      mountInSandbox(v.code, Object.fromEntries(v.defaults.map(d => [d.key, d.value])));
      if (shell.isMobile) setMobilePanel('preview');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      const msg = e instanceof Error ? e.message : String(e);
      setChat(c => [...c, { role: 'assistant', content: msg, versionId: null, error: msg }]);
    } finally { setSending(false); }
  }

  function fix() { if (sandboxError) void refine(`Fix this error: ${sandboxError}`); }

  function doRestore(index: number) {
    if (!tool) return;
    const next = restoreVersion(tool, index);
    setTool(next);
    const v = next.versions[index];
    mountInSandbox(v.code, Object.fromEntries(v.defaults.map(d => [d.key, d.value])));
  }

  function testWithFile() {
    const list = assets.list();
    if (!list.length) { shell.toast('Drop a file anywhere to add it to the tray first'); return; }
    const a = list[0];
    const reader = new FileReader();
    reader.onload = () => {
      sandboxRef.current?.sendAsset({ id: a.id, name: a.name, type: a.type, dataUrl: reader.result as string });
      shell.toast(`Sent ${a.name} to the tool`);
    };
    reader.readAsDataURL(a.blob);
  }

  async function save() {
    if (!tool) return;
    await saveCustomTool(tool);
    addCustomEntry(tool);
    setLibrary(await loadCustomTools());
    shell.toast(`${tool.name} added to your library`);
    navigate(`/t/${tool.id}`);
  }

  function editTool(t: CustomTool) {
    setTool(t);
    setChat(t.chat);
    const v = currentVersion(t);
    mountInSandbox(v.code, Object.fromEntries(v.defaults.map(d => [d.key, d.value])));
  }

  async function removeTool(id: string) {
    await deleteCustomTool(id);
    removeCustomEntry(id);
    setLibrary(await loadCustomTools());
    if (tool?.id === id) { setTool(null); setChat([]); sandboxRef.current?.destroy(); sandboxRef.current = null; }
    shell.toast('Tool removed');
  }

  async function doExport() {
    const data = await exportLibrary();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: 'lathe-custom-tools.json' }).click();
    URL.revokeObjectURL(url);
  }

  async function doImport(file: File) {
    try {
      const { imported, skipped } = await importLibrary(await file.text());
      setLibrary(await loadCustomTools());
      shell.toast(`Imported ${imported} tool${imported !== 1 ? 's' : ''}${skipped ? `, ${skipped} skipped` : ''}`);
    } catch (e) { shell.toast(`Import failed: ${e instanceof Error ? e.message : String(e)}`); }
  }

  const [mobilePanel, setMobilePanel] = useState<'chat' | 'preview'>('chat');
  const hasSession = tool || chat.length > 0;

  if (!shell.user) {
    return (
      <>
        <section className="stage" aria-label="Make a tool">
          <div className="mk">
            <div className="mk__ask">
              <h2 className="mk__label">Make a tool</h2>
              <p className="l-note">Sign in to create custom tools. Your tools are saved to your library and persist across devices.</p>
            </div>
          </div>
        </section>
        <aside className="inspector" aria-label="Inspector">
          <LibraryPanel library={library} onOpen={t => navigate(`/t/${t.id}`)} onEdit={editTool} onRemove={removeTool} onExport={doExport} onImport={doImport} fileRef={fileRef} />
        </aside>
      </>
    );
  }

  if (!hasSession) {
    return (
      <>
        <section className="stage" aria-label="Make a tool">
          <div className="mk">
            <form className="mk__ask" onSubmit={e => { e.preventDefault(); void start(prompt); }}>
              <label htmlFor="make-prompt" className="mk__label">What do you keep doing by hand?</label>
              <div className="mk__row">
                <input id="make-prompt" className="mk__input" value={prompt} onChange={e => setPrompt(e.target.value)}
                  placeholder="I keep manually extracting colors from screenshots" autoComplete="off" disabled={sending} />
                <button type="submit" className="l-btn l-btn--primary mk__go" disabled={sending || !prompt.trim()}>Make it</button>
              </div>
              <div className="mk__base-row">
                <select className="l-select mk__base-select" value={baseTool} onChange={e => setBaseTool(e.target.value)}>
                  <option value="">Start from scratch</option>
                  {BASE_TOOLS.map(t => <option key={t.id} value={t.id}>Start from {t.name}</option>)}
                </select>
              </div>
              <div className="l-chip-row mk__examples">
                {EXAMPLES.map(ex => <button key={ex} type="button" className="l-chip" onClick={() => setPrompt(ex)} disabled={sending}>{ex}</button>)}
              </div>
            </form>
          </div>
        </section>
        <aside className="inspector" aria-label="Inspector">
          <LibraryPanel library={library} onOpen={t => navigate(`/t/${t.id}`)} onEdit={editTool} onRemove={removeTool} onExport={doExport} onImport={doImport} fileRef={fileRef} />
        </aside>
      </>
    );
  }

  return (
    <>
      <section className="stage" aria-label="Make a tool">
        <div className="mk mk--split">
          {shell.isMobile && (
            <div className="mk__mobile-toggle">
              <button type="button" className={mobilePanel === 'chat' ? 'is-active' : ''} onClick={() => setMobilePanel('chat')}>Chat</button>
              <button type="button" className={mobilePanel === 'preview' ? 'is-active' : ''} onClick={() => setMobilePanel('preview')}>Preview</button>
            </div>
          )}
          <div className={`mk__chat${shell.isMobile && mobilePanel === 'chat' ? ' is-active-panel' : ''}`}>
            <div className="mk__thread">
              {chat.map((msg, i) => (
                <div key={i} className={`mk__msg mk__msg--${msg.role}`}>
                  <span className="mk__msg-who">{msg.role === 'user' ? 'You' : 'Lathe'}</span>
                  <span className="mk__msg-text">{msg.content}</span>
                  {msg.error && <button type="button" className="l-btn mk__fix" onClick={() => void refine(`Fix this error: ${msg.error}`)}>Fix it</button>}
                </div>
              ))}
              {sending && (
                <div className="mk__msg mk__msg--assistant">
                  <span className="mk__msg-who">Lathe</span>
                  <span className="mk__msg-text mk__building"><span className="mk__spinner" /> Building{elapsed > 0 ? `\u2026 ${elapsed}s` : '\u2026'}</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <form className="mk__chat-form" onSubmit={e => { e.preventDefault(); void (tool ? refine(prompt) : start(prompt)); }}>
              <input className="mk__input mk__chat-input" value={prompt} onChange={e => setPrompt(e.target.value)}
                placeholder="Describe a change\u2026" autoComplete="off" disabled={sending} />
              <button type="submit" className="l-btn l-btn--primary" disabled={sending || !prompt.trim()}>Send</button>
            </form>
          </div>
          <div className={`mk__preview${shell.isMobile && mobilePanel === 'preview' ? ' is-active-panel' : ''}`}>
            {tool && (
              <div className="mk__preview-head">
                <span className="mk__preview-name">{tool.name}</span>
                <span className="mk__preview-group">{tool.group}</span>
              </div>
            )}
            <div className="mk__sandbox" ref={previewRef} />
            {sandboxError && (
              <div className="mk__sandbox-error">
                <p>{sandboxError}</p>
                <button type="button" className="l-btn" onClick={fix}>Fix it</button>
              </div>
            )}
            <div className="mk__preview-actions">
              <button type="button" className="l-btn" onClick={testWithFile} disabled={!tool}>Test with a file</button>
              <button type="button" className="l-btn l-btn--primary" onClick={() => void save()} disabled={!tool || sending}>Add to library</button>
            </div>
          </div>
        </div>
      </section>
      <aside className="inspector" aria-label="Inspector">
        {tool && tool.versions.length > 1 && (
          <section className="l-section">
            <h3 className="l-section__title">Versions</h3>
            <div className="l-section__body">
              {tool.versions.map((v, i) => (
                <div key={v.id} className={`mk__ver${i === tool.currentVersionIndex ? ' is-active' : ''}`}>
                  <button type="button" className="mk__ver-btn" onClick={() => doRestore(i)}>v{i + 1}</button>
                  <span className="mk__ver-desc">{v.description}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        <LibraryPanel library={library} onOpen={t => navigate(`/t/${t.id}`)} onEdit={editTool} onRemove={removeTool} onExport={doExport} onImport={doImport} fileRef={fileRef} />
      </aside>
    </>
  );
}

function LibraryPanel({ library, onOpen, onEdit, onRemove, onExport, onImport, fileRef }: {
  library: CustomTool[]; onOpen: (t: CustomTool) => void; onEdit: (t: CustomTool) => void;
  onRemove: (id: string) => void; onExport: () => void; onImport: (f: File) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <section className="l-section">
      <h3 className="l-section__title">Your library</h3>
      <div className="l-section__body">
        {library.length === 0 && <p className="l-note">Tools you make appear here and persist across sessions.</p>}
        {library.map(t => (
          <div key={t.id} className="mk__lib-item">
            <button type="button" className="mk__lib-name" onClick={() => onOpen(t)}>{t.name}</button>
            <button type="button" className="mk__lib-edit" onClick={() => onEdit(t)}>Edit</button>
            <span className="mk__lib-group">{t.group}</span>
            <button type="button" className="mk__lib-del" onClick={() => onRemove(t.id)} title="Remove">&times;</button>
          </div>
        ))}
        <div className="mk__lib-actions">
          <button type="button" className="l-btn" onClick={onExport} disabled={!library.length}>Export</button>
          <button type="button" className="l-btn" onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        </div>
      </div>
    </section>
  );
}
