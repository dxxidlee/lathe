import { useShell } from './state';
import { Modal } from './Modal';
import { modKey } from '../lib/format';

export function ShortcutSheet() {
  const shell = useShell();
  const mod = modKey();
  const rows: [string, string][] = [
    ['1 – 9', 'Switch tool (rail order)'],
    [`${mod} K`, 'Command palette'],
    [`${mod} E`, 'Export'],
    ['?', 'This sheet'],
    ['\u2325W', 'Close tab'],
    ['\u2325\u21e7[', 'Previous tab'],
    ['\u2325\u21e7]', 'Next tab'],
    [`${mod}\\`, 'Toggle rail'],
    ['Esc', 'Close any panel'],
    ['Drop a file', 'Load it into the active tool'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={() => shell.setSheetOpen(false)}>
      <div className="l-modal__body">
        <div className="l-stats">
          {rows.map(([k, v]) => (
            <div className="l-stat" key={k}>
              <span className="l-stat__label">{v}</span>
              <span className="l-stat__value">{k}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
