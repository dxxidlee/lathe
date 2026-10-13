// @ts-check
/* POST /api/expand → expand a search query into better terms for archive searches. */
import Anthropic from '@anthropic-ai/sdk';
import { json } from './_lib/http.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `You help expand search queries for cultural archive searches (museums, libraries, art collections).

Given a query, return:
- main: the best expanded search phrase (expand abbreviations, place names, common initialisms)
- alternates: 2-3 alternate phrasings that would find relevant results
- exclude: terms that are likely false positives (e.g. stopwords that match unrelated results, common words in other languages that collide)
- interpreted: a short human-readable description of what you understood the query to mean

Rules:
- Never produce search terms that are just 1-2 letter stopwords (a, an, la, le, de, etc.)
- Expand place name abbreviations (LA → Los Angeles, NYC → New York City, SF → San Francisco)
- Expand common abbreviations (SW → Star Wars or Southwest depending on context)
- If the query is already specific, keep it close to the original
- alternates should be distinct phrasings, not just word order variations`;

const TOOL_DEF = {
  name: 'expanded_query',
  description: 'An expanded search query',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['main', 'alternates', 'exclude', 'interpreted'],
    properties: {
      main: { type: 'string', description: 'The best expanded search phrase' },
      alternates: { type: 'array', items: { type: 'string' }, description: '2-3 alternate phrasings' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Terms likely to produce false positives' },
      interpreted: { type: 'string', description: 'Short human-readable interpretation of the query' },
    },
  },
};

/** @param {Request} request */
export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'Query expansion needs ANTHROPIC_API_KEY' }, { status: 501 });

  /** @type {any} */ let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON' }, { status: 400 }); }

  const query = String(body?.query || '').trim();
  if (!query) return json({ error: 'query is required' }, { status: 400 });
  if (query.length > 200) return json({ error: 'query too long' }, { status: 400 });

  const client = new Anthropic({ apiKey, defaultHeaders: { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID || '' } });
  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      tools: /** @type {any[]} */ ([TOOL_DEF]),
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: `Expand this archive search query: "${query}"` }],
    });

    const block = msg.content.find(b => b.type === 'tool_use');
    if (!block || block.type !== 'tool_use') {
      // Fallback: return the original query
      return json({ main: query, alternates: [], exclude: [], interpreted: query }, { cache: 'no-store' });
    }

    const r = /** @type {any} */ (block.input);
    return json({
      main: String(r.main || query),
      alternates: Array.isArray(r.alternates) ? r.alternates.map(String) : [],
      exclude: Array.isArray(r.exclude) ? r.exclude.map(String) : [],
      interpreted: String(r.interpreted || query),
    }, { cache: 'no-store' });
  } catch (e) {
    // On any error, return the original query so search still works
    console.warn('[expand] fallback to original query:', e instanceof Error ? e.message : e);
    return json({ main: query, alternates: [], exclude: [], interpreted: query }, { cache: 'no-store' });
  }
}
