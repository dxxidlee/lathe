// @ts-check
/* GET /api/sources → every source with whether it is available (keyless, or its key is set), and which
   Audit brand-mode features the keys unlock.
   Never returns key values. */
import { SOURCES, isAvailable } from '../_lib/sources/index.js';
import { json } from '../_lib/http.js';
import { brandFeatures } from '../_lib/brand.js';

export function GET() {
  return json({
    sources: SOURCES.map(s => ({ id: s.id, name: s.name, homepage: s.homepage, needsKey: !!s.key, available: isAvailable(s, process.env) })),
    brand: brandFeatures(process.env),
  }, { cache: 'no-store' });
}
