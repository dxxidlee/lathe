/* Resets. A tool's reset forgets its working settings (last image, sliders, picks) and its
   Defaults-panel edits, so it opens as the maker shipped it. A full reset also empties the tray
   and the response cache. Nothing outside this browser is touched. */
import { STORES, idbClear, idbDelete } from './idb';

export async function resetTool(toolId: string) {
  await Promise.all([idbDelete('settings', toolId), idbDelete('settings', `__defaults:${toolId}`), idbDelete('settings', `__applied:${toolId}`)]);
}

export async function resetEverything() {
  await Promise.all(STORES.map(s => idbClear(s)));
  location.assign('/');
}
