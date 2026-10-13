// @ts-check
/* GET /api/expand?q= → expand a search query into better terms for archive searches. */
import Anthropic from '@anthropic-ai/sdk';
import { json } from './_lib/http.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You help expand search queries for cultural archive searches (museums, libraries, art collections).
Given a query, return: main (best expanded phrase), alternates (2-3 alternate phrasings), exclude (false positive terms), interpreted (human-readable interpretation).
Rules: never produce 1-2 letter stopwords. Expand place abbreviations (LA → Los Angeles). Alternates should be distinct phrasings.`;

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
