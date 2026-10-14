/* Gap-preserving resize for Deck tiles. Boundaries are contiguous segments:
   two edges at the same coordinate only share a boundary if they overlap
   along the perpendicular axis. */

export interface TileRect { name: string; x: number; y: number; w: number; h: number }

export interface Boundary {
  axis: 'x' | 'y';
  pos: number;
  before: string[];
  after: string[];
}

const TOL = 0.0005;

function overlaps(a: TileRect, b: TileRect, axis: 'x' | 'y'): boolean {
  if (axis === 'x') {
    return a.y < b.y + b.h - TOL && b.y < a.y + a.h - TOL;
  }
  return a.x < b.x + b.w - TOL && b.x < a.x + a.w - TOL;
}

export function buildBoundaries(tiles: TileRect[], gutterX: number, gutterY: number): Boundary[] {
  const raw: { axis: 'x' | 'y'; pos: number; before: string; after: string }[] = [];

  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j];
      const rightA = a.x + a.w, rightB = b.x + b.w;
      const botA = a.y + a.h, botB = b.y + b.h;

      if (Math.abs(rightA + gutterX - b.x) < TOL && overlaps(a, b, 'x')) {
        raw.push({ axis: 'x', pos: rightA + gutterX / 2, before: a.name, after: b.name });
      } else if (Math.abs(rightB + gutterX - a.x) < TOL && overlaps(a, b, 'x')) {
        raw.push({ axis: 'x', pos: rightB + gutterX / 2, before: b.name, after: a.name });
      }

      if (Math.abs(botA + gutterY - b.y) < TOL && overlaps(a, b, 'y')) {
        raw.push({ axis: 'y', pos: botA + gutterY / 2, before: a.name, after: b.name });
      } else if (Math.abs(botB + gutterY - a.y) < TOL && overlaps(a, b, 'y')) {
        raw.push({ axis: 'y', pos: botB + gutterY / 2, before: b.name, after: a.name });
      }
    }
  }

  // Group by axis+pos, then split into contiguous segments
  const grouped = new Map<string, typeof raw>();
  for (const r of raw) {
    const key = `${r.axis}:${r.pos.toFixed(6)}`;
    let g = grouped.get(key);
    if (!g) { g = []; grouped.set(key, g); }
    g.push(r);
  }

  const boundaries: Boundary[] = [];
  for (const [, group] of grouped) {
    // Each group has the same axis and pos. Build connected components
    // along the perpendicular axis using the overlap graph.
    const names = new Set<string>();
    group.forEach(r => { names.add(r.before); names.add(r.after); });
    const byName = new Map<string, TileRect>();
    for (const t of tiles) if (names.has(t.name)) byName.set(t.name, t);

    const visited = new Set<string>();
    for (const seed of group) {
      if (visited.has(seed.before) && visited.has(seed.after)) continue;
      // BFS to find connected component
      const before = new Set<string>(), after = new Set<string>();
      const queue = [seed];
      while (queue.length) {
        const cur = queue.pop()!;
        if (before.has(cur.before) && after.has(cur.after)) continue;
        before.add(cur.before); after.add(cur.after);
        visited.add(cur.before); visited.add(cur.after);
        for (const other of group) {
          if (before.has(other.before) && after.has(other.after)) continue;
          const touching =
            (before.has(other.before) || after.has(other.after) ||
             [...before].some(n => { const t = byName.get(n)!, o = byName.get(other.before); return o ? overlaps(t, o, seed.axis) : false; }) ||
             [...after].some(n => { const t = byName.get(n)!, o = byName.get(other.after); return o ? overlaps(t, o, seed.axis) : false; }));
          if (touching) queue.push(other);
        }
      }
      boundaries.push({ axis: group[0].axis, pos: group[0].pos, before: [...before], after: [...after] });
    }
  }

  return boundaries;
}

export type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export function boundariesForHandle(
  tileName: string,
  handle: HandleDir,
  boundaries: Boundary[],
): { bx: Boundary | null; by: Boundary | null } {
  let bx: Boundary | null = null, by: Boundary | null = null;

  const wantLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const wantRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const wantTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const wantBottom = handle === 'sw' || handle === 's' || handle === 'se';

  for (const b of boundaries) {
    if (b.axis === 'x') {
      if (wantLeft && b.after.includes(tileName)) bx = b;
      if (wantRight && b.before.includes(tileName)) bx = b;
    } else {
      if (wantTop && b.after.includes(tileName)) by = b;
      if (wantBottom && b.before.includes(tileName)) by = b;
    }
  }

  return { bx, by };
}

export interface ResizeResult {
  dx: number;
  dy: number;
  snapX: number | null;
  snapY: number | null;
}

export function computeResize(
  tiles: Map<string, TileRect>,
  bx: Boundary | null,
  by: Boundary | null,
  rawDx: number,
  rawDy: number,
  minW: number,
  minH: number,
  snapTargets: number[],
  snapThresholdX: number,
  shiftLock: boolean,
  startAspect: number,
  snapTargetsY?: number[],
  snapThresholdY?: number,
): ResizeResult {
  const stY = snapTargetsY ?? snapTargets;
  const stTY = snapThresholdY ?? snapThresholdX;
  let dx = rawDx, dy = rawDy;

  // Clamp dx
  if (bx) {
    for (const n of bx.before) { const t = tiles.get(n)!; dx = Math.min(dx, t.w - minW); }
    for (const n of bx.after)  { const t = tiles.get(n)!; dx = Math.max(dx, minW - t.w); }
  } else {
    dx = 0;
  }

  // Clamp dy
  if (by) {
    for (const n of by.before) { const t = tiles.get(n)!; dy = Math.min(dy, t.h - minH); }
    for (const n of by.after)  { const t = tiles.get(n)!; dy = Math.max(dy, minH - t.h); }
  } else {
    dy = 0;
  }

  // Shift-constrain: maintain aspect ratio
  if (shiftLock && bx && by && startAspect > 0) {
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx > ady) dy = dx / startAspect;
    else dx = dy * startAspect;
    // Re-clamp
    if (bx) {
      for (const n of bx.before) { const t = tiles.get(n)!; dx = Math.min(dx, t.w - minW); }
      for (const n of bx.after)  { const t = tiles.get(n)!; dx = Math.max(dx, minW - t.w); }
    }
    if (by) {
      for (const n of by.before) { const t = tiles.get(n)!; dy = Math.min(dy, t.h - minH); }
      for (const n of by.after)  { const t = tiles.get(n)!; dy = Math.max(dy, minH - t.h); }
    }
  }

  // Snap
  let snapX: number | null = null, snapY: number | null = null;
  if (bx) {
    const newPos = bx.pos + dx;
    for (const s of snapTargets) {
      if (Math.abs(newPos - s) < snapThresholdX) {
        const snapDx = s - bx.pos;
        let ok = true;
        for (const n of bx.before) { if (tiles.get(n)!.w + snapDx - dx < minW) ok = false; }
        for (const n of bx.after)  { if (tiles.get(n)!.w - snapDx + dx < minW) ok = false; }
        if (ok) { dx = snapDx; snapX = s; break; }
      }
    }
  }
  if (by) {
    const newPos = by.pos + dy;
    for (const s of stY) {
      if (Math.abs(newPos - s) < stTY) {
        const snapDy = s - by.pos;
        let ok = true;
        for (const n of by.before) { if (tiles.get(n)!.h + snapDy - dy < minH) ok = false; }
        for (const n of by.after)  { if (tiles.get(n)!.h - snapDy + dy < minH) ok = false; }
        if (ok) { dy = snapDy; snapY = s; break; }
      }
    }
  }

  return { dx, dy, snapX, snapY };
}

/** Apply a boundary move: before-tiles grow, after-tiles shrink (or vice versa for negative delta). */
export function applyResize(
  tiles: Map<string, TileRect>,
  bx: Boundary | null,
  by: Boundary | null,
  dx: number,
  dy: number,
): void {
  if (bx && dx !== 0) {
    for (const n of bx.before) { const t = tiles.get(n)!; t.w += dx; }
    for (const n of bx.after)  { const t = tiles.get(n)!; t.x += dx; t.w -= dx; }
  }
  if (by && dy !== 0) {
    for (const n of by.before) { const t = tiles.get(n)!; t.h += dy; }
    for (const n of by.after)  { const t = tiles.get(n)!; t.y += dy; t.h -= dy; }
  }
}

/** Build snap targets: all boundary positions + slide center lines. */
export function snapTargetsFor(boundaries: Boundary[], slideW: number, slideH: number): number[] {
  const targets = new Set<number>();
  targets.add(slideW / 2);
  targets.add(slideH / 2);
  for (const b of boundaries) targets.add(b.pos);
  return [...targets];
}

/** Find the boundary under a point (for gutter dragging). */
export function boundaryAtPoint(
  boundaries: Boundary[],
  tiles: Map<string, TileRect>,
  px: number,
  py: number,
  gutterX: number,
  gutterY: number,
): Boundary | null {
  for (const b of boundaries) {
    const halfG = b.axis === 'x' ? gutterX / 2 : gutterY / 2;
    if (Math.abs((b.axis === 'x' ? px : py) - b.pos) > halfG) continue;
    // Check perpendicular span
    const spans = [...b.before, ...b.after];
    for (const n of spans) {
      const t = tiles.get(n)!;
      if (b.axis === 'x') { if (py >= t.y && py <= t.y + t.h) return b; }
      else { if (px >= t.x && px <= t.x + t.w) return b; }
    }
  }
  return null;
}

/**
 * Find the best neighbor to fill the space left by removing a tile.
 * A neighbor qualifies if its shared edge fully spans the removed area's edge.
 * Priority: same-row left, same-row right, above, below.
 * Returns the neighbor name or null if no single neighbor matches the full edge.
 */
export function fillNeighbor(
  removed: TileRect,
  tiles: TileRect[],
  gutterX: number,
  gutterY: number,
): string | null {
  const others = tiles.filter(t => t.name !== removed.name);
  type Dir = 'left' | 'right' | 'above' | 'below';
  const candidates: { name: string; dir: Dir }[] = [];

  for (const t of others) {
    // Left neighbor: t's right edge + gutter = removed's left edge, same vertical span
    if (Math.abs(t.x + t.w + gutterX - removed.x) < TOL &&
        Math.abs(t.y - removed.y) < TOL && Math.abs(t.h - removed.h) < TOL) {
      candidates.push({ name: t.name, dir: 'left' });
    }
    // Right neighbor
    if (Math.abs(removed.x + removed.w + gutterX - t.x) < TOL &&
        Math.abs(t.y - removed.y) < TOL && Math.abs(t.h - removed.h) < TOL) {
      candidates.push({ name: t.name, dir: 'right' });
    }
    // Above
    if (Math.abs(t.y + t.h + gutterY - removed.y) < TOL &&
        Math.abs(t.x - removed.x) < TOL && Math.abs(t.w - removed.w) < TOL) {
      candidates.push({ name: t.name, dir: 'above' });
    }
    // Below
    if (Math.abs(removed.y + removed.h + gutterY - t.y) < TOL &&
        Math.abs(t.x - removed.x) < TOL && Math.abs(t.w - removed.w) < TOL) {
      candidates.push({ name: t.name, dir: 'below' });
    }
  }

  const priority: Dir[] = ['left', 'right', 'above', 'below'];
  for (const dir of priority) {
    const c = candidates.find(x => x.dir === dir);
    if (c) return c.name;
  }
  return null;
}

/** Apply a tile removal: extend the filling neighbor into the removed tile's space including gutter. */
export function applyRemoval(
  tiles: Map<string, TileRect>,
  removedName: string,
  fillerName: string,
  gutterX: number,
  gutterY: number,
): void {
  const removed = tiles.get(removedName)!;
  const filler = tiles.get(fillerName)!;
  if (Math.abs(filler.y - removed.y) < TOL && Math.abs(filler.h - removed.h) < TOL) {
    // Same row: extend horizontally
    if (filler.x + filler.w + gutterX - removed.x < TOL) {
      // Filler is on the left
      filler.w += gutterX + removed.w;
    } else {
      // Filler is on the right
      filler.x = removed.x;
      filler.w += gutterX + removed.w;
    }
  } else {
    // Same column: extend vertically
    if (filler.y + filler.h + gutterY - removed.y < TOL) {
      filler.h += gutterY + removed.h;
    } else {
      filler.y = removed.y;
      filler.h += gutterY + removed.h;
    }
  }
  tiles.delete(removedName);
}
