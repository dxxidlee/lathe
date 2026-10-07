/* Fork: a zip of the tool's source (Vite ?raw imports), the shared contract files it builds on,
   defaults.json with the current edits, and FORK.md listing every change from the maker's defaults. */
import JSZip from 'jszip';
import type { DefaultsManifest } from '../tools/types';
import type { Edits } from './defaults';
import { effective, formatValue } from './defaults';
import { saveExport } from './download';

/* Every file under src/tools, as text, loaded only when a fork is made. */
const TOOL_SOURCES = import.meta.glob('../tools/**/*', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
/* The contract and primitives a forked tool needs to run in (or outside) Lathe. */
const SHARED_SOURCES = import.meta.glob(
  ['../tools/types.ts', '../tools/registry.ts', '../ui/primitives.ts', '../lib/*.ts', '../lib/resize-engine/*.ts', '../styles/tokens.css', '../styles/primitives.css'],
  { query: '?raw', import: 'default' },
) as Record<string, () => Promise<string>>;

export interface ForkInput {
  id: string;
  name: string;
  group: string;
  manifest: DefaultsManifest;
  edits: Edits;
}

export function forkMarkdown(f: ForkInput, date = new Date()): string {
  const changed = f.manifest.filter(d => d.key in f.edits);
  const unit = (u?: string) => (u ? ` ${u}` : '');
  const lines = changed.map(d => {
    const e = f.edits[d.key];
    const why = e.reason?.trim() ? `\n  Why: ${e.reason.trim()}` : '\n  Why: (not given)';
    return `- **${d.label}**: ~~${formatValue(d.value)}${unit(d.unit)}~~ → ${formatValue(e.value)}${unit(d.unit)}` +
      `\n  Maker's choice: ${d.inheritedFrom ? `inherited from ${d.inheritedFrom}` : `${d.chosenBy}, reason ${d.reason}`}${why}`;
  });
  return `# ${f.name} (fork)

Forked from Lathe's ${f.name} (${f.group}) on ${date.toLocaleDateString('en-CA')}.

> Every default was someone else's decision. These are the ones you changed.

## Changes from the maker's defaults

${lines.length ? lines.join('\n') : '_None. This fork starts from the maker\'s defaults._'}

## What's in here

- \`src/tools/${f.id}/\`: the tool's source, unchanged. It reads its starting values from \`defaults.ts\`.
- \`defaults.json\`: the maker's manifest, your values, and each edit with its reason.
- \`lathe/\`: the contract it runs on (\`LatheTool\` types, inspector primitives, storage and export helpers, design tokens).

## Make it yours

1. Copy \`src/tools/${f.id}/\` into a Lathe checkout as \`src/tools/<your-id>/\`.
2. Apply your values: edit \`defaults.ts\` to match \`defaults.json → current\` (set \`chosenBy\` to your name and write your reason).
3. Register it in \`src/tools/registry.ts\` with a \`load\` import, then run \`npm run dev\`.
`;
}

export function forkDefaultsJson(f: ForkInput) {
  return {
    tool: f.id,
    name: f.name,
    forkedAt: new Date().toISOString(),
    maker: Object.fromEntries(f.manifest.map(d => [d.key, d.value])),
    current: effective(f.manifest, f.edits),
    edits: Object.fromEntries(Object.entries(f.edits).map(([k, e]) => [k, {
      from: f.manifest.find(d => d.key === k)?.value, to: e.value, reason: e.reason ?? '', chosenBy: 'You',
    }])),
    manifest: f.manifest.map(d => (d.key in f.edits
      ? { ...d, value: f.edits[d.key].value, chosenBy: 'You', reason: f.edits[d.key].reason?.trim() || 'TODO(You)', inheritedFrom: null, maker: { value: d.value, chosenBy: d.chosenBy, reason: d.reason, inheritedFrom: d.inheritedFrom } }
      : d)),
  };
}

export async function buildFork(f: ForkInput): Promise<{ blob: Blob; name: string; files: string[] }> {
  const zip = new JSZip();
  const root = zip.folder(`${f.id}-fork`)!;
  const files: string[] = [];
  const prefix = `../tools/${f.id}/`;
  for (const [path, load] of Object.entries(TOOL_SOURCES)) {
    if (!path.startsWith(prefix)) continue;
    const rel = `src/tools/${f.id}/${path.slice(prefix.length)}`;
    root.file(rel, await load()); files.push(rel);
  }
  for (const [path, load] of Object.entries(SHARED_SOURCES)) {
    const rel = 'lathe/' + path.replace(/^\.\.\//, '');
    root.file(rel, await load()); files.push(rel);
  }
  root.file('defaults.json', JSON.stringify(forkDefaultsJson(f), null, 2)); files.push('defaults.json');
  root.file('FORK.md', forkMarkdown(f)); files.push('FORK.md');
  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, name: `${f.id}-fork.zip`, files };
}

export async function forkTool(f: ForkInput) {
  const r = await buildFork(f);
  await saveExport(r.blob, r.name, f.id);
  return r;
}
