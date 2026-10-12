// @ts-check
/* POST /api/brand/observe → a short, generated visual audit of the captured brand (ANTHROPIC_API_KEY).
   Body: { name, domain, captures: [{ id, label, dataUrl }], facts: { colors, pixelColors, typefaces,
   title, description, years } }. Claude sees the captures and the extracted data and must cite the
   captures each observation rests on; observations citing no submitted capture are dropped. With
   facts.instagram (the brand's latest posts: types, dates, engagement, captions), its most engaged posts
   arrive as captures ig1–ig3, and observations about the feed as a whole may cite "instagram". */
import Anthropic from '@anthropic-ai/sdk';
import { json } from '../_lib/http.js';

export const MODEL = 'claude-opus-5-5';
const MAX_CAPTURES = 13; // homepage ×2, up to 8 timeline years, 3 Instagram posts
const AREAS = ['consistency', 'hierarchy', 'type', 'color', 'tone'];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'observations'],
  properties: {
    summary: { type: 'string', description: 'Two sentences at most: the overall read of the brand as captured.' },
    observations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['area', 'text', 'evidence'],
        properties: {
          area: { type: 'string', enum: AREAS },
          text: { type: 'string', description: 'One or two sentences. Specific and checkable.' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'IDs of the captures this observation is based on, e.g. ["desktop", "y2016", "ig1"], or "instagram" for the Instagram data.' },
        },
      },
    },
  },
};

const SYSTEM = `You are a design critic writing a brief visual audit of a company's web presence for a design research deck.
You receive labelled screenshot captures and data extracted from the site's HTML and CSS.
Write 5 to 8 observations across these areas: consistency, hierarchy, type, color, tone.
Every observation must describe something visible in the captures (or directly present in the supplied data) and list the IDs of the captures it is based on. Do not speculate about anything you cannot see: no claims about strategy, audience, business results, or pages that were not captured.
Refer to colors by the hex values supplied where they match what is visible. Name typefaces only as they appear in the supplied data.
When Instagram data is supplied, cover the feed alongside the site: what the posts show, the mix of post types, how often the brand posts (from the dates), which posts draw the most engagement, and how the captions and imagery line up with the site. Cite the post captures (ig1, ig2, ig3) or "instagram" for observations drawn from the data. Report engagement as the numbers given; do not judge it against other brands.
Plain, specific language; no praise or marketing adjectives.`;

/** @param {string} s */
const parseDataUrl = s => {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(s || '');
  return m ? { media_type: /** @type {'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'} */ (m[1]), data: m[2] } : null;
};

/** @param {Request} request */
export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_WORKSPACE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'Observations need ANTHROPIC_WORKSPACE_KEY or ANTHROPIC_API_KEY in .env.local' }, { status: 404 });
  /** @type {any} */ let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON' }, { status: 400 }); }
  const captures = (Array.isArray(body?.captures) ? body.captures : []).slice(0, MAX_CAPTURES)
    .map((/** @type {any} */ c) => ({ id: String(c?.id || '').slice(0, 24), label: String(c?.label || '').slice(0, 120), image: parseDataUrl(c?.dataUrl) }))
    .filter((/** @type {any} */ c) => c.id && c.image);
  if (!captures.length) return json({ error: 'No captures to observe' }, { status: 400 });
  const ids = new Set(captures.map((/** @type {any} */ c) => c.id));
  if (body?.facts?.instagram) ids.add('instagram');

  /** @type {import('@anthropic-ai/sdk/resources/beta/messages/messages').BetaContentBlockParam[]} */
  const content = [];
  for (const c of captures) {
    content.push({ type: 'text', text: `Capture ${c.id}: ${c.label}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: c.image.media_type, data: c.image.data } });
  }
  const facts = body?.facts && typeof body.facts === 'object' ? body.facts : {};
  content.push({ type: 'text', text: `Company: ${String(body?.name || body?.domain || '').slice(0, 120)} (${String(body?.domain || '').slice(0, 120)})\nExtracted data:\n${JSON.stringify(facts).slice(0, 24000)}\n\nWrite the audit.` });

  const client = new Anthropic({ apiKey });
  try {
    const msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
    if (msg.stop_reason === 'refusal') return json({ error: 'The model declined to write observations for these captures' }, { status: 422 });
    const text = msg.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    /** @type {any} */ let out;
    try { out = JSON.parse(text); } catch { return json({ error: 'The model returned an unreadable answer' }, { status: 502 }); }
    const observations = (Array.isArray(out.observations) ? out.observations : [])
      .map((/** @type {any} */ o) => ({ area: AREAS.includes(o.area) ? o.area : 'consistency', text: String(o.text || '').trim(), evidence: (Array.isArray(o.evidence) ? o.evidence : []).map(String).filter((/** @type {string} */ e) => ids.has(e)) }))
      .filter((/** @type {any} */ o) => o.text && o.evidence.length);
    return json({
      generated: true, model: msg.model, generatedAt: new Date().toISOString(),
      summary: String(out.summary || '').trim(), observations,
      dropped: (out.observations?.length ?? 0) - observations.length,
    }, { cache: 'no-store' });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY was rejected' }, { status: 401 });
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Claude rate limit reached; try again shortly' }, { status: 429 });
    if (e instanceof Anthropic.BadRequestError) return json({ error: `Claude rejected the request: ${e.message}` }, { status: 400 });
    if (e instanceof Anthropic.APIError) return json({ error: `Claude API error ${e.status ?? ''}`.trim() }, { status: 502 });
    return json({ error: 'Could not reach Claude' }, { status: 502 });
  }
}
