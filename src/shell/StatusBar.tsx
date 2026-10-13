import { formatBytes, formatDims } from '../lib/format';
import { useShell } from './state';
import { useAssets } from './useAssets';

export function StatusBar() {
  const shell = useShell();
  const assets = useAssets();
  const s = shell.status;
  const parts = [s.name, formatDims(s.width, s.height), formatBytes(s.bytes)].filter(Boolean);
  return (
    <footer className="statusbar" role="status" style={{ fontSize: 'var(--text-meta)', color: 'var(--text-3)', height: 'var(--statusbar-h)' }}>
      <span className="statusbar__file" data-testid="status-file">{parts.length ? parts.join('  ') : 'No file'}</span>
      <span className="statusbar__state">{s.state ?? ''}</span>
      <button type="button" className={`statusbar__tray${shell.trayOpen ? ' is-active' : ''}`}
        onClick={() => shell.toggleTray()} aria-expanded={shell.trayOpen} aria-controls="tray">
        Tray <span className="tabular" data-testid="tray-count">{assets.length}</span>
      </button>
    </footer>
  );
}
