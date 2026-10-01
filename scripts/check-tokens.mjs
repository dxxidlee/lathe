// Enforces CLAUDE.md: no hardcoded colors, sizes or weights outside src/styles/tokens.css.
// Flags hex colors, rgb()/hsl(), numeric font-weights and px values (except in @media queries
// and the generated mark path). Run: npm run check:tokens
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname;
const SKIP = new Set(['styles/tokens.css', 'brand/mark-path.ts']);
const RULES = [
  [/#[0-9a-fA-F]{3,8}\b/, 'hex color'],
  [/\b(rgba?|hsla?|oklch|lab)\(/, 'color function'],
  [/font-weight:\s*\d/, 'numeric font-weight'],
  [/fontWeight:\s*['"]?\d/, 'numeric font-weight'],
  [/(?<![\w-])\d*\.?\d+px\b/, 'px value'],
];

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|ts|tsx)$/.test(f)) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  const rel = relative(ROOT, f);
  if (SKIP.has(rel)) continue;
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*@media/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
    // px inside template strings that build runtime layout (e.g. `${n}px`) is computed, not a token
    const scan = line.replace(/\$\{[^}]*\}px/g, '');
    for (const [re, what] of RULES) {
      if (re.test(scan)) { console.log(`${rel}:${i + 1}  ${what}: ${line.trim()}`); bad++; break; }
    }
  });
}
if (bad) { console.log(`\n${bad} hardcoded value(s). Move them to src/styles/tokens.css.`); process.exit(1); }
console.log(`check:tokens ok (${files.length} files)`);
