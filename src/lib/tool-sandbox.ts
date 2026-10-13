/* Runs custom tool code in a sandboxed iframe. The iframe gets its own DOM;
   errors can't crash Lathe. Communication is postMessage only. */

export interface SandboxMessage {
  type: 'ready' | 'status' | 'toast' | 'error' | 'export';
  info?: { name?: string; state?: string };
  message?: string;
  stack?: string;
  name?: string;
  dataUrl?: string;
}

export interface Sandbox {
  iframe: HTMLIFrameElement;
  mount(code: string, defaults: Record<string, unknown>): void;
  sendAsset(asset: { id: string; name: string; type: string; dataUrl: string }): void;
  onMessage(cb: (msg: SandboxMessage) => void): () => void;
  destroy(): void;
}

const HARNESS_HTML = (tokens: string, primitives: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; background: #000; color: #fff; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
body { display: grid; grid-template-columns: 1fr; grid-template-rows: 1fr; overflow: hidden; }
#stage { position: relative; overflow: auto; min-height: 0; }
#inspector { display: none; }
${tokens}
${primitives}
</style>
</head><body>
<div id="stage"></div>
<div id="inspector"></div>
<script>
const stage = document.getElementById('stage');
const inspector = document.getElementById('inspector');
let unmount = null;

const ctx = {
  stage,
  inspector,
  defaults: {},
  statusbar: {
    set(info) { parent.postMessage({ type: 'status', info }, '*'); },
    clear() { parent.postMessage({ type: 'status', info: {} }, '*'); },
  },
  emit(event, msg) {
    if (event === 'toast') parent.postMessage({ type: 'toast', message: msg }, '*');
  },
  assets: {
    _items: new Map(),
    get(id) { return this._items.get(id); },
    list() { return [...this._items.values()]; },
    add() { return Promise.reject(new Error('Cannot add assets in sandbox')); },
    remove() { return Promise.reject(new Error('Cannot remove assets in sandbox')); },
    onChange() { return () => {}; },
  },
  settings: {
    get(key, fallback) { return fallback; },
    set() {},
    remove() {},
    all() { return {}; },
  },
};

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || !d.type) return;
  if (d.type === 'mount') {
    try {
      if (unmount) { try { unmount(); } catch {} }
      stage.textContent = '';
      inspector.textContent = '';
      ctx.defaults = d.defaults || {};
      const result = new Function('ctx', d.code)(ctx);
      if (typeof result === 'function') unmount = result;
      else if (result && typeof result.unmount === 'function') unmount = result.unmount;
    } catch (err) {
      parent.postMessage({ type: 'error', message: err.message, stack: err.stack }, '*');
    }
  }
  if (d.type === 'asset') {
    ctx.assets._items.set(d.id, { id: d.id, name: d.name, type: d.type, dataUrl: d.dataUrl });
  }
});

window.addEventListener('error', (e) => {
  parent.postMessage({ type: 'error', message: e.message, stack: e.error?.stack }, '*');
});
window.addEventListener('unhandledrejection', (e) => {
  parent.postMessage({ type: 'error', message: String(e.reason) }, '*');
});

parent.postMessage({ type: 'ready' }, '*');
<\/script>
</body></html>`;

export function createSandbox(container: HTMLElement, css = ''): Sandbox {
  const tokens = css, primitives = '';
  const html = HARNESS_HTML(tokens, primitives);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.sandbox = 'allow-scripts';
  iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;background:#000;border-radius:var(--radius, 4px)';
  container.appendChild(iframe);

  const listeners = new Set<(msg: SandboxMessage) => void>();

  const onMsg = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    const msg = e.data as SandboxMessage;
    if (msg && msg.type) listeners.forEach(cb => cb(msg));
  };
  window.addEventListener('message', onMsg);

  return {
    iframe,
    mount(code: string, defaults: Record<string, unknown>) {
      iframe.contentWindow?.postMessage({ type: 'mount', code, defaults }, '*');
    },
    sendAsset(asset) {
      iframe.contentWindow?.postMessage({ type: 'asset', ...asset }, '*');
    },
    onMessage(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    destroy() {
      window.removeEventListener('message', onMsg);
      listeners.clear();
      iframe.remove();
      URL.revokeObjectURL(url);
    },
  };
}
