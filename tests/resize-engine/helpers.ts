import { readFileSync } from 'node:fs';
import { createShaper, loadFonts } from '../../src/lib/resize-engine/shaper';

const ROOT = new URL('../../', import.meta.url);
export const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, ROOT), 'utf8');
/** HarfBuzz over Inter (the fixtures' font), loaded once. */
export const inter = createShaper(loadFonts(readFileSync(new URL('fixtures/fonts/inter-latin.ttf', ROOT))));
