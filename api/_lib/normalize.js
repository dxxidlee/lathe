// @ts-check
/* The one schema every source adapter returns (CLAUDE.md, Audit "Normalized result"), plus `type`,
   an optional object or media type used by the type filter. */

/**
 * @typedef {Object} AuditResult
 * @property {string} id            source-prefixed, unique across sources
 * @property {string} source        source id
 * @property {string} title
 * @property {string | null} creator
 * @property {string | null} date   as the source gives it
 * @property {number | null} year   first plausible year in date
 * @property {string} imageUrl      largest web image
 * @property {string} thumbUrl      ~400–640px image
 * @property {number | null} width
 * @property {number | null} height
 * @property {string} license       human-readable
 * @property {boolean} isPublicDomain
 * @property {string} sourceUrl     the record page at the source
 * @property {string | null} type
 * @property {string[]} [palette]   filled in client-side
 */

/** First plausible year (−3000…2100) in any of the values. @param {...unknown} vals */
export function yearFrom(...vals) {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v) && v > -3000 && v < 2100) return Math.trunc(v);
    if (typeof v === 'string') {
      const m = v.match(/(?<!\d)(1\d{3}|20\d{2}|[1-9]\d{2})(?!\d)/);
      if (m) return Number(m[1]);
    }
  }
  return null;
}

/** @param {unknown} s */
export function stripHtml(s) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return t || null;
}

/** @param {unknown} v */
export const str = v => (typeof v === 'string' && v.trim() ? v.trim() : Array.isArray(v) && typeof v[0] === 'string' ? v[0].trim() : null);

export const PD = /public ?domain|\bcc0\b|\bpdm\b|no known (copyright )?restrictions|publicdomain/i;

/**
 * Fill defaults and enforce the schema.
 * @param {Partial<AuditResult> & { id: string, source: string, imageUrl: string }} r
 * @returns {AuditResult}
 */
export function result(r) {
  return {
    id: `${r.source}:${r.id}`,
    source: r.source,
    title: (r.title && String(r.title).trim()) || 'Untitled',
    creator: r.creator ?? null,
    date: r.date ?? null,
    year: r.year ?? yearFrom(r.date),
    imageUrl: r.imageUrl,
    thumbUrl: r.thumbUrl || r.imageUrl,
    width: r.width ?? null,
    height: r.height ?? null,
    license: r.license || 'Rights not stated; check the source',
    isPublicDomain: !!r.isPublicDomain,
    sourceUrl: r.sourceUrl || r.imageUrl,
    type: r.type ?? null,
  };
}
