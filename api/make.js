// @ts-check
/* POST /api/make → generate a Lathe tool from a natural-language prompt (ANTHROPIC_API_KEY). */
import Anthropic from '@anthropic-ai/sdk';
import { json } from './_lib/http.js';

const MODEL = 'claude-3-5-sonnet-20241022';

const GROUPS = ['Color', 'Image', 'Type', 'Layout', 'Motion', 'Export', 'Reference'];

const SYSTEM = `You generate self-contained browser tools for Lathe, a design-tool suite.

The code you write will be wrapped as: new Function('ctx', code)
ctx has these properties:
- stage: HTMLElement — the center canvas area where the tool renders its output.
- inspector: HTMLElement — the right panel for controls.
- statusbar: { set(info: { name?, width?, height?, bytes?, state? }): void, clear(): void } — bottom status bar. Example: ctx.statusbar.set({ name: 'My Tool', state: 'Ready' }).
- emit: function — call ctx.emit('toast', 'message') to show a transient message.
- defaults: Record<string, any> — the tool's default values.

Your function body MUST return an unmount function () => void that cleans up all DOM, listeners, and timers.

Rules:
- Create DOM elements directly with document.createElement. No frameworks, no imports.
- Use canvas for image/pixel manipulation, SVG for vector output.
- Everything must be self-contained — no external scripts, imports, or CDN links.
- Production quality: error handling, cleanup, responsive layout.
- Tools typically: create controls in ctx.inspector, render output in ctx.stage, update ctx.statusbar.

Available CSS classes for inspector controls:
- l-section, l-section__title, l-section__body — collapsible sections
- l-label, l-note — labels and helper text
- l-input, l-textarea — text inputs
- l-btn, l-btn--primary — buttons
- l-slider — range inputs
- l-chip-row, l-chip — chip/tag rows
- l-field — form field wrapper
- l-stats, l-stat, l-stat__label, l-stat__value — stat readouts

Keep the tool focused on one task. Make it genuinely useful.`;

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
      description: { type: 'string', description: 'One-line description of what the tool does' },
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
        description: 'Default settings for the tool',
      },
      code: { type: 'string', description: 'The JavaScript function body string. Will be called as new Function("ctx", code). Must return an unmount function.' },
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
      messages: [{ role: 'user', content: `Create a Lathe tool for this request: ${prompt}` }],
    });

    const block = msg.content.find(b => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return json({ error: 'Model did not return a tool definition' }, { status: 502 });

    const tool = /** @type {any} */ (block.input);
    // Validate group
    if (!GROUPS.includes(tool.group)) tool.group = 'Image';

    return json({
      id: tool.id,
      name: tool.name,
      group: tool.group,
      description: tool.description,
      defaults: tool.defaults,
      code: tool.code,
    }, { cache: 'no-store' });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY was rejected' }, { status: 401 });
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Claude rate limit reached; try again shortly' }, { status: 429 });
    if (e instanceof Anthropic.BadRequestError) return json({ error: `Claude rejected the request: ${e.message}` }, { status: 400 });
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status ?? ''}: ${e.message}` }, { status: 502 });
    return json({ error: `Could not reach Claude: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
