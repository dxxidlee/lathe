import type { Asset, AssetsAPI, EmitFn, SettingsAPI, StatusbarAPI } from '../types';

export declare class UIController {
  constructor(ctx: {
    stage: HTMLElement; inspector: HTMLElement; defaults: Record<string, unknown>;
    palette: unknown[]; presets: Record<string, Record<string, number>>;
    settings: SettingsAPI; statusbar: StatusbarAPI; assets: AssetsAPI; emit: EmitFn;
  });
  renderer: { ok: boolean };
  loadAsset(a: Asset): Promise<void>;
  openExport(): void;
  destroy(): void;
}
