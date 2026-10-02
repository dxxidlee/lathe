// @ts-check
/* GET /api/sources → every source with whether it is available (keyless, or its key is set).
   Never returns key values. */
import { SOURCES, isAvailable } from '../_lib/sources/index.js';
import { json } from '../_lib/http.js';

export function GET() {
  return json({
    sources: SOURCES.map(s => ({ id: s.id, name: s.name, homepage: s.homepage, needsKey: !!s.key, available: isAvailable(s, process.env) })),
  }, { cache: 'no-store' });
}
