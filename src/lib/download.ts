/* Exports: download the file and drop a copy into the asset tray, so every output is
   usable by every other tool. */
import { assets } from './assets';

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function saveExport(blob: Blob, filename: string, toolId: string) {
  downloadBlob(blob, filename);
  try { await assets.add(blob, { name: filename, source: 'export', origin: toolId }); }
  catch (e) { console.warn('[lathe] could not add export to tray', e); }
}
