// @ts-check
/* Source registry. A source whose key is missing is reported unavailable and hidden in the UI. */
import * as met from './met.js';
import * as aic from './aic.js';
import * as archive from './archive.js';
import * as wikimedia from './wikimedia.js';
import * as loc from './loc.js';
import * as openverse from './openverse.js';
import * as arena from './arena.js';
import * as cooperhewitt from './cooperhewitt.js';
import * as smithsonian from './smithsonian.js';
import * as harvard from './harvard.js';
import * as europeana from './europeana.js';
import * as rijks from './rijks.js';
import * as unsplash from './unsplash.js';

/**
 * @typedef {Object} Source
 * @property {string} id
 * @property {string} name
 * @property {string | null} key           env var that unlocks it
 * @property {string} homepage
 * @property {string[]} imageHosts         hosts /api/img may fetch for this source (suffix match)
 * @property {((q: string, o: { page: number, limit: number, env: Record<string, string | undefined> }) => Promise<{ total: number, results: import('../normalize.js').AuditResult[] }>) | null} search
 */

/** @type {Source[]} */
export const SOURCES = [
  { id: 'met', name: 'The Met Collection', key: null, homepage: 'https://www.metmuseum.org/art/collection', imageHosts: ['images.metmuseum.org'], search: met.search },
  { id: 'aic', name: 'Art Institute of Chicago', key: null, homepage: 'https://www.artic.edu/collection', imageHosts: ['www.artic.edu', 'lakeimagesweb.artic.edu'], search: aic.search },
  { id: 'archive', name: 'Internet Archive', key: null, homepage: 'https://archive.org', imageHosts: ['archive.org'], search: archive.search },
  { id: 'wikimedia', name: 'Wikimedia Commons', key: null, homepage: 'https://commons.wikimedia.org', imageHosts: ['upload.wikimedia.org', 'thumb.wikimedia.org'], search: wikimedia.search },
  { id: 'loc', name: 'Library of Congress', key: null, homepage: 'https://www.loc.gov/photos/', imageHosts: ['tile.loc.gov', 'loc.gov'], search: loc.search },
  { id: 'openverse', name: 'Openverse', key: null, homepage: 'https://openverse.org', imageHosts: ['api.openverse.org'], search: openverse.search },
  { id: 'arena', name: 'Are.na', key: 'ARENA_TOKEN', homepage: 'https://www.are.na', imageHosts: ['d2w9rnfcy7mm78.cloudfront.net', 'images.are.na', 'are.na'], search: arena.search },
  // Cooper Hewitt and the Rijksmuseum replaced their keyed APIs with keyless ones (see VERIFY.md).
  { id: 'cooperhewitt', name: 'Cooper Hewitt', key: null, homepage: 'https://collection.cooperhewitt.org', imageHosts: ['ciim-static-media.s3.us-east-1.amazonaws.com'], search: cooperhewitt.search },
  { id: 'rijks', name: 'Rijksmuseum', key: null, homepage: 'https://www.rijksmuseum.nl', imageHosts: ['iiif.micr.io'], search: rijks.search },
  { id: 'smithsonian', name: 'Smithsonian Open Access', key: 'SMITHSONIAN_KEY', homepage: 'https://www.si.edu/openaccess', imageHosts: ['ids.si.edu'], search: smithsonian.search },
  { id: 'harvard', name: 'Harvard Art Museums', key: 'HARVARD_KEY', homepage: 'https://harvardartmuseums.org', imageHosts: ['ids.lib.harvard.edu', 'nrs.harvard.edu'], search: harvard.search },
  { id: 'europeana', name: 'Europeana', key: 'EUROPEANA_KEY', homepage: 'https://www.europeana.eu', imageHosts: ['api.europeana.eu'], search: europeana.search },
  { id: 'unsplash', name: 'Unsplash', key: 'UNSPLASH_KEY', homepage: 'https://unsplash.com', imageHosts: ['images.unsplash.com'], search: unsplash.search },
];

/** @param {Source} s @param {Record<string, string | undefined>} env */
export const isAvailable = (s, env) => !!s.search && (!s.key || !!env[s.key]);
export const findSource = (/** @type {string} */ id) => SOURCES.find(s => s.id === id);
