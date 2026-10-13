import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { allTools, isReady, ID_ALIASES, HIDDEN_TOOLS } from '../tools/registry';
import { resetEverything } from '../lib/reset';
import { useShell } from './state';
import { Modal } from './Modal';
import { modKey } from '../lib/format';

interface Command { id: string; label: string; hint?: string; keys?: string; run: () => void; _extra?: string }

/** Subsequence match, scored by contiguity and start position. Lower is better; -1 = no match. */
function score(q: string, s: string): number {
  if (!q) return 0;
  q = q.toLowerCase(); s = s.toLowerCase();
  const direct = s.indexOf(q);
  if (direct >= 0) return direct;
  let si = 0, gaps = 0;
  for (const ch of q) {
    const i = s.indexOf(ch, si);
    if (i < 0) return -1;
    gaps += i - si; si = i + 1;
  }
  return 100 + gaps;
}

export function CommandPalette() {
  const shell = useShell();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const close = () => shell.setPaletteOpen(false);

  const commands = useMemo<Command[]>(() => {
    const mod = modKey();
    const open = (path: string) => () => { close(); navigate(path); };
    const openTool = (toolId: string) => () => { close(); shell.openTab(toolId); navigate(`/t/${toolId}`); };
    // Old names that alias to each current tool id, for search
    const aliasesFor = (id: string) =>
      Object.entries(ID_ALIASES).filter(([, v]) => v === id).map(([k]) => k);
    const all = [...allTools(), ...HIDDEN_TOOLS.filter(h => !allTools().some(t => t.id === h.id))];
    return [
      ...all.map((t, i) => ({
        id: `tool:${t.id}`, label: t.name,
        hint: isReady(t) ? (t.custom ? `${t.group} · Custom` : t.group) : `${t.group} · Milestone ${t.milestone}`,
        keys: i < 9 && !t.custom ? String(i + 1) : undefined,
        run: openTool(t.id),
        _extra: aliasesFor(t.id).join(' '),
      })),
      { id: 'home', label: 'Go home', run: open('/') },
      { id: 'make', label: 'Make a tool', run: openTool('make') },
      { id: 'library', label: 'Library', hint: 'Saved decks, audits, palettes', run: openTool('library') },
      { id: 'export', label: 'Export', keys: `${mod}E`, run: () => { close(); shell.runExport(); } },
      { id: 'nav', label: 'Toggle tool rail', run: () => { close(); shell.toggleNav(); } },
      { id: 'tray', label: 'Toggle asset tray', run: () => { close(); shell.toggleTray(); } },
      { id: 'keys', label: 'Keyboard shortcuts', keys: '?', run: () => { close(); shell.setSheetOpen(true); } },
      { id: 'reset-tool', label: 'Reset this tool', hint: 'Its image, settings and edits', run: () => { close(); if (shell.resetToolRef.current) shell.resetToolRef.current(); else shell.toast('Open a tool to reset it'); } },
      { id: 'reset-all', label: 'Reset everything', hint: 'Every tool, the tray and the cache', run: () => {
        close();
        if (window.confirm('Reset Lathe? This forgets every tool’s settings and edits and empties the tray. Files you downloaded stay on your computer.')) void resetEverything();
      } },
    ];
  }, [navigate, shell.runExport]);

  const results = useMemo(() => commands
    .map(c => ({ c, s: score(q, `${c.label} ${c.hint ?? ''} ${c._extra ?? ''}`) }))
    .filter(r => r.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map(r => r.c), [commands, q]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  return (
    <Modal onClose={close} title={undefined} labelledBy="palette-label">
      <div className="palette">
        <label id="palette-label" className="sr-only" htmlFor="palette-input">Search tools and actions</label>
        <input
          id="palette-input" className="palette__input" autoFocus placeholder="Search tools and actions"
          value={q} onChange={e => setQ(e.target.value)} role="combobox" aria-expanded="true" aria-controls="palette-list"
          aria-activedescendant={results[sel] ? `cmd-${results[sel].id}` : undefined}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(results.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); results[sel]?.run(); }
          }}
        />
        <ul className="palette__list" id="palette-list" role="listbox" ref={listRef}>
          {results.map((c, i) => (
            <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === sel}
              className="palette__item" onMouseMove={() => setSel(i)} onClick={() => c.run()}>
              <span className="palette__label">{c.label}</span>
              {c.hint && <span className="palette__hint">{c.hint}</span>}
              {c.keys && <span className="l-kbd">{c.keys}</span>}
            </li>
          ))}
          {!results.length && <li className="palette__empty">No match</li>}
        </ul>
      </div>
    </Modal>
  );
}
