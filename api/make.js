// @ts-check
/* POST /api/make -> generate a Lathe tool from a natural-language prompt. */
import Anthropic from '@anthropic-ai/sdk';
import { json } from './_lib/http.js';

const MODEL = 'claude-haiku-4-5-20251001';

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

CSS classes for controls: l-section, l-section__title, l-section__body, l-label, l-note, l-input, l-btn, l-btn--primary, l-slider, l-chip-row, l-chip, l-field, l-stats, l-stat, l-stat__label, l-stat__value.`;

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
  const apiKey = process.env.ANTHROPIC_WORKSPACE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'Tool generation needs ANTHROPIC_WORKSPACE_KEY or ANTHROPIC_API_KEY in .env.local' }, { status: 501 });

  /** @type {any} */ let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON' }, { status: 400 }); }

  const prompt = String(body?.prompt || '').trim();
  if (!prompt) return json({ error: 'prompt is required' }, { status: 400 });
  if (prompt.length > 2000) return json({ error: 'prompt too long (max 2000 chars)' }, { status: 400 });

  const client = new Anthropic({ apiKey });
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      tools: /** @type {any[]} */ ([TOOL_DEF]),
      tool_choice: { type: 'tool', name: 'lathe_tool' },
      messages: [{ role: 'user', content: `Create a Lathe tool for: ${prompt}` }],
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
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Claude rate limit reached; try again shortly' }, { status: 429 });
    if (e instanceof Anthropic.BadRequestError) return json({ error: `Claude rejected the request: ${e.message}` }, { status: 400 });
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status ?? ''}: ${e.message}` }, { status: 502 });
    return json({ error: `Could not reach Claude: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
