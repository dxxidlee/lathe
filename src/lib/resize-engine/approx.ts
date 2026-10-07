/* Measurement without font files, for previews before fonts load and for tests of layout alone. */
import type { Shaper } from './types';

/** Measurement without font files (an average advance per character), for previews before fonts load. */
export function approxShaper(advance = 0.55): Shaper {
  return {
    resolve: req => ({ css: req.family, weight: req.weight, style: req.style, ascent: 0.8, descent: 0.2, exact: true, key: 'approx' }),
    measure: (_f, text, size, ls = 0) => [...text].length * advance * size + ls * Math.max(0, [...text].length - 1),
  };
}
