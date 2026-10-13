// @ts-check
/* POST /api/make → generate a Lathe tool. GET /api/make?expand=query → expand a search query. */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { json } from './_lib/http.js';

/* ---- Query expansion (GET) ---- */
const EXPAND_SYSTEM = `You help expand search queries for cultural archive searches (museums, libraries, art collections).
Given a query, return: main (best expanded phrase), alternates (2-3 alternate phrasings), exclude (false positive terms), interpreted (human-readable interpretation).
Rules: never produce 1-2 letter stopwords. Expand place abbreviations (LA → Los Angeles). Alternates should be distinct phrasings.`;

const EXPAND_TOOL = {
  name: 'expanded_query', description: 'An expanded search query',
  input_schema: { type: 'object', additionalProperties: false, required: ['main', 'alternates', 'exclude', 'interpreted'],
    properties: { main: { type: 'string' }, alternates: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } }, interpreted: { type: 'string' } } },
};

/** @param {Request} request */
export async function GET(request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('expand') || '').trim();
  if (!query) return json({ error: 'Pass ?expand=query' }, { status: 400 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ main: query, alternates: [], exclude: [], interpreted: query });
  const client = new Anthropic({ apiKey, defaultHeaders: { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID || '' } });
  try {
    const msg = await client.messages.create({ model: MODEL, max_tokens: 512, system: EXPAND_SYSTEM,
      tools: /** @type {any[]} */ ([EXPAND_TOOL]), tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: `Expand this archive search query: "${query}"` }] });
    const block = msg.content.find(b => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return json({ main: query, alternates: [], exclude: [], interpreted: query });
    const r = /** @type {any} */ (block.input);
    return json({ main: String(r.main || query), alternates: Array.isArray(r.alternates) ? r.alternates.map(String) : [],
      exclude: Array.isArray(r.exclude) ? r.exclude.map(String) : [], interpreted: String(r.interpreted || query) }, { cache: 'no-store' });
  } catch (e) { console.warn('[expand] fallback:', e instanceof Error ? e.message : e); return json({ main: query, alternates: [], exclude: [], interpreted: query }); }
}

/* ---- Tool generation (POST) ---- */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const GROUPS = ['Color', 'Image', 'Type', 'Layout', 'Motion', 'Export', 'Reference'];

const SYSTEM = `You generate tools for Lathe, a browser design-tool suite. You output ONLY a JavaScript function body (no HTML, no markdown, no wrapping).

The code field must be a plain JavaScript function body. It will run as:
  const fn = new Function('ctx', code);
  const unmount = fn(ctx);

ctx is an object with:
  ctx.stage      - HTMLElement, the center canvas. Append your output here.
  ctx.inspector  - HTMLElement, the right sidebar. Append controls here.
  ctx.statusbar  - { set({ name, state }), clear() }
  ctx.emit       - call ctx.emit('toast', 'msg') for notifications
  ctx.defaults   - Record<string, any> of default values from the defaults array

RULES:
1. The code field is PURE JAVASCRIPT. Not HTML. Not a full page. Just the function body.
2. You MUST return a cleanup function: return () => { /* remove listeners, timers */ };
3. Create elements with document.createElement(). No frameworks, no imports, no CDN.
4. Use canvas for raster work, inline SVG strings for vector.
5. Keep it focused, useful, and under 3000 characters.

EXAMPLE of a valid code field:
  const el = document.createElement('div');
  el.textContent = 'Hello';
  ctx.stage.appendChild(el);
  ctx.statusbar.set({ name: 'My Tool', state: 'Ready' });
  return () => el.remove();

CSS classes for controls: l-section, l-section__title, l-section__body, l-label, l-note, l-input, l-btn, l-btn--primary, l-slider, l-chip-row, l-chip, l-field, l-stats, l-stat, l-stat__label, l-stat__value.

REFINEMENT: When given existing code to modify, change only what the user asks. Keep the rest intact. Return the complete updated code.`;

const TOOL_DEF = {
  name: 'lathe_tool',
  description: 'A generated Lathe tool definition',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'group', 'description', 'defaults', 'code'],
    properties: {
      id: { type: 'string', description: 'kebab-case identifier, e.g. "pixel-sort"' },
      name: { type: 'string', description: 'Human-readable name, e.g. "Pixel Sort"' },
      group: { type: 'string', enum: GROUPS, description: 'Tool group' },
      description: { type: 'string', description: 'One-line description' },
      defaults: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['key', 'label', 'value'],
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            value: {},
          },
        },
        description: 'Default settings the tool reads from ctx.defaults',
      },
      code: { type: 'string', description: 'PURE JAVASCRIPT function body. NOT HTML. Will run as new Function("ctx", code). Must return an unmount function.' },
    },
  },
};

/** @param {Request} request */
export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'Tool generation needs ANTHROPIC_API_KEY in .env.local' }, { status: 501 });

  // Verify user
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace('Bearer ', '');
  if (!token) return json({ error: 'Sign in to use Make a Tool' }, { status: 401 });

  const sbUrl = process.env.VITE_SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return json({ error: 'Auth is not configured' }, { status: 501 });

  const sb = createClient(sbUrl, sbKey);
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return json({ error: 'Invalid session. Please sign in again.' }, { status: 401 });

  // Rate limit: 20 tools per hour per user
  const hour = new Date(Date.now() - 3600000).toISOString();
  const { count } = await sb.from('custom_tools').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', hour);
  if ((count ?? 0) >= 20) return json({ error: 'Rate limit: 20 tools per hour. Try again later.' }, { status: 429 });

  /** @type {any} */ let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON' }, { status: 400 }); }

  const prompt = String(body?.prompt || '').trim();
  if (!prompt) return json({ error: 'prompt is required' }, { status: 400 });
  if (prompt.length > 2000) return json({ error: 'prompt too long (max 2000 chars)' }, { status: 400 });

  const currentCode = typeof body?.currentCode === 'string' ? body.currentCode.slice(0, 10000) : '';
  const baseSource = typeof body?.baseSource === 'string' ? body.baseSource.slice(0, 30000) : '';

  let userContent;
  if (currentCode) {
    userContent = `Here is the current tool code:\n\n${currentCode}\n\nApply this change: ${prompt}`;
  } else if (baseSource) {
    userContent = `Create a Lathe tool based on this existing tool:\n\n${baseSource}\n\nModification requested: ${prompt}`;
  } else {
    userContent = `Create a Lathe tool for: ${prompt}`;
  }

  const client = new Anthropic({ apiKey, defaultHeaders: { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID || '' } });
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: /** @type {any[]} */ ([TOOL_DEF]),
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: userContent }],
    });

    const block = msg.content.find(b => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return json({ error: 'Model did not return a tool definition' }, { status: 502 });

    const tool = /** @type {any} */ (block.input);
    if (!GROUPS.includes(tool.group)) tool.group = 'Image';

    let code = String(tool.code || '');
    if (code.includes('<!DOCTYPE') || code.includes('<html')) {
      return json({ error: 'Model returned HTML instead of JavaScript. Try a simpler prompt.' }, { status: 502 });
    }
    // If the model wrapped the code in a function, unwrap it so new Function('ctx', code) works
    const wrapped = /^\s*return\s+function\s*\(\s*ctx\s*\)\s*\{([\s\S]*)\}\s*;?\s*$/.exec(code.trim());
    if (wrapped) code = wrapped[1];

    return json({
      id: tool.id,
      name: tool.name,
      group: tool.group,
      description: tool.description,
      defaults: tool.defaults || [],
      code,
    }, { cache: 'no-store' });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY was rejected' }, { status: 401 });
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Lathe rate limit reached; try again shortly' }, { status: 429 });
    if (e instanceof Anthropic.BadRequestError) return json({ error: `Lathe could not generate the tool: ${e.message}` }, { status: 400 });
    if (e instanceof Anthropic.APIError) return json({ error: `Lathe generation error ${e.status ?? ''}: ${e.message}` }, { status: 502 });
    return json({ error: `Could not reach Lathe generation service: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
