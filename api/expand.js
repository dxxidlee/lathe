// @ts-check
/* GET /api/expand?q= → expand a search query into better terms for archive searches. */
import Anthropic from '@anthropic-ai/sdk';
import { json } from './_lib/http.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You expand search queries for cultural archive searches (museums, libraries, art collections).

Rules:
- ONLY expand abbreviations and initialisms (LA → Los Angeles, NYC → New York City). Do NOT add synonyms, related concepts, or descriptions.
- The main query should be the original query with abbreviations expanded. Nothing more.
- Alternates: 1-2 tighter rephrasing using the same core nouns. Not broader, not more abstract.
- Exclude: terms in other languages that collide with query terms (e.g. "la" in French for an English "LA" query).
- Keep it literal. "LA Sky" → "Los Angeles sky", NOT "atmospheric scenes" or "skyline photography" or "clouds".
- Never add art/media terms the user didn't use (painting, photograph, artwork, etc.).`;

const TOOL_DEF = {
  name: 'expanded_query', description: 'An expanded search query',
  input_schema: { type: 'object', additionalProperties: false, required: ['main', 'alternates', 'exclude', 'interpreted'],
    properties: { main: { type: 'string' }, alternates: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } }, interpreted: { type: 'string' } } },
};

/** @param {Request} request */
export async function GET(request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  if (!query) return json({ error: 'Pass ?q=query' }, { status: 400 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ main: query, alternates: [], exclude: [], interpreted: query });
  const client = new Anthropic({ apiKey, defaultHeaders: { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID || '' } });
  try {
    const msg = await client.messages.create({ model: MODEL, max_tokens: 512, system: SYSTEM,
      tools: /** @type {any[]} */ ([TOOL_DEF]), tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: `Expand this archive search query: "${query}"` }] });
    const block = msg.content.find(b => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') return json({ main: query, alternates: [], exclude: [], interpreted: query });
    const r = /** @type {any} */ (block.input);
    return json({ main: String(r.main || query), alternates: Array.isArray(r.alternates) ? r.alternates.map(String) : [],
      exclude: Array.isArray(r.exclude) ? r.exclude.map(String) : [], interpreted: String(r.interpreted || query) }, { cache: 'no-store' });
  } catch (e) { console.warn('[expand] fallback:', e instanceof Error ? e.message : e); return json({ main: query, alternates: [], exclude: [], interpreted: query }); }
}
