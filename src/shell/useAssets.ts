import { useEffect, useState } from 'react';
import { assets, loadAssets } from '../lib/assets';
import type { Asset } from '../tools/types';

/** Live list of tray assets, newest first. */
export function useAssets(): Asset[] {
  const [list, setList] = useState<Asset[]>(() => assets.list());
  useEffect(() => {
    let alive = true;
    loadAssets().then(() => { if (alive) setList(assets.list()); });
    const off = assets.onChange(e => { if (e.type !== 'load') setList(assets.list()); });
    return () => { alive = false; off(); };
  }, []);
  return list;
}
