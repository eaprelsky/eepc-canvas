import { CLEARANCE, GRID, MIN_SEGMENT, SOFT_CLEARANCE } from '../constants';
import { bboxOf, gridFloor, gridRound, rectsOverlap } from '../geom';
import type {
  AttachedNode, Diagram, Dir, NodeView, Point, Rect, RoutedAttachment, RoutedFlow,
} from '../types';
import { isMainNode } from '../types';

const DIRS: ReadonlyArray<Readonly<[number, number]>> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const DIR_INDEX: Record<Dir, number> = { up: 0, down: 1, left: 2, right: 3 };

const STEP_COST = 10;
const TURN_COST = 30;
const SOFT_COST = 6;
const OCC_COST = 24;

interface RouterCtx {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
  soft: Uint8Array;
  occupied: Map<number, number>;
}

function viewRect(v: NodeView): Rect {
  return { x: v.x, y: v.y, w: v.w, h: v.h };
}

function ctxFor(views: NodeView[]): RouterCtx {
  const bb = bboxOf(views.map(viewRect));
  const margin = 80;
  const x0 = gridFloor(bb.x - margin);
  const y0 = gridFloor(bb.y - margin);
  const x1 = Math.ceil((bb.x + bb.w + margin - x0) / GRID);
  const y1 = Math.ceil((bb.y + bb.h + margin - y0) / GRID);
  const cols = x1 + 1;
  const rows = y1 + 1;
  const blocked = new Uint8Array(cols * rows);
  const soft = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const px = x0 + i * GRID;
      const py = y0 + j * GRID;
      const idx = j * cols + i;
      for (const v of views) {
        if (px > v.x - CLEARANCE && px < v.x + v.w + CLEARANCE &&
            py > v.y - CLEARANCE && py < v.y + v.h + CLEARANCE) {
          blocked[idx] = 1;
        } else if (px > v.x - SOFT_CLEARANCE && px < v.x + v.w + SOFT_CLEARANCE &&
                   py > v.y - SOFT_CLEARANCE && py < v.y + v.h + SOFT_CLEARANCE) {
          soft[idx] = 1;
        }
      }
    }
  }
  return { x0, y0, cols, rows, blocked, soft, occupied: new Map() };
}

/** Is the corridor along an axis-aligned segment free of shapes?
 *  The segment is inflated by CLEARANCE; ignored nodes are skipped. */
function segmentClear(
  views: NodeView[],
  a: Point,
  b: Point,
  ignore: Set<string>,
): boolean {
  const x1 = Math.min(a.x, b.x) - CLEARANCE;
  const x2 = Math.max(a.x, b.x) + CLEARANCE;
  const y1 = Math.min(a.y, b.y) - CLEARANCE;
  const y2 = Math.max(a.y, b.y) + CLEARANCE;
  const corridor: Rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  return !views.some(v =>
    !ignore.has(v.node.id) && rectsOverlap(corridor, viewRect(v), -0.01));
}

// ── Binary heap keyed by f ────────────────────────────────────────────────────

class Heap {
  private items: number[] = [];
  private fs: number[] = [];
  get size(): number { return this.items.length; }
  push(state: number, f: number): void {
    this.items.push(state); this.fs.push(f);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fs[p] <= this.fs[i]) break;
      this.swap(p, i); i = p;
    }
  }
  pop(): number {
    const top = this.items[0];
    const li = this.items.length - 1;
    this.swap(0, li);
    this.items.pop(); this.fs.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.items.length && this.fs[l] < this.fs[m]) m = l;
      if (r < this.items.length && this.fs[r] < this.fs[m]) m = r;
      if (m === i) break;
      this.swap(m, i); i = m;
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.fs[a], this.fs[b]] = [this.fs[b], this.fs[a]];
  }
}

/** Orthogonal route between two ports. Returns polyline points including ports. */
export function routeSegment(
  ctx: RouterCtx,
  from: Point,
  fromDir: Dir,
  to: Point,
  toDir: Dir,
): { points: Point[]; degraded: boolean } {
  const { x0, y0, cols, rows, blocked, soft, occupied } = ctx;
  const cellOf = (p: Point): number => {
    const i = Math.round((p.x - x0) / GRID);
    const j = Math.round((p.y - y0) / GRID);
    return j * cols + i;
  };
  const startCell = cellOf(from);
  const goalCell = cellOf(to);
  if (startCell === goalCell) return { points: [from, to], degraded: false };

  const n = cols * rows;
  const g = new Float64Array(n * 4).fill(Infinity);
  const parent = new Int32Array(n * 4).fill(-1);
  const closed = new Uint8Array(n * 4);
  const goalDirIdx = DIR_INDEX[toDir];
  const startDirIdx = DIR_INDEX[fromDir];
  const startState = startCell * 4 + startDirIdx;
  g[startState] = 0;

  const hOf = (cell: number): number => {
    const ci = cell % cols, cj = (cell - ci) / cols;
    const gi = goalCell % cols, gj = (goalCell - gi) / cols;
    return (Math.abs(ci - gi) + Math.abs(cj - gj)) * STEP_COST;
  };

  const heap = new Heap();
  heap.push(startState, hOf(startCell));

  let found = -1;
  let guard = 0;
  const maxIter = n * 4 + 1000;
  while (heap.size > 0 && guard++ < maxIter) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    const cell = s >> 2;
    const dir = s & 3;
    if (cell === goalCell && dir === goalDirIdx) { found = s; break; }
    const ci = cell % cols;
    const cj = (cell - ci) / cols;
    const gs = g[s];
    for (let nd = 0; nd < 4; nd++) {
      const [dx, dy] = DIRS[nd];
      const ni = ci + dx, nj = cj + dy;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const ncell = nj * cols + ni;
      const isGoal = ncell === goalCell;
      const isStart = ncell === startCell;
      if (blocked[ncell] && !isGoal && !isStart) continue;
      // The goal must be entered along toDir; the start must be left (no re-entry).
      if (isGoal && nd !== goalDirIdx) continue;
      if (isStart) continue;
      const ns = ncell * 4 + nd;
      if (closed[ns]) continue;
      let cost = gs + STEP_COST;
      if (nd !== dir) cost += TURN_COST;
      if (soft[ncell]) cost += SOFT_COST;
      const occ = occupied.get(ncell) ?? 0;
      if (occ > 0) cost += OCC_COST * occ;
      if (cost < g[ns]) {
        g[ns] = cost;
        parent[ns] = s;
        heap.push(ns, cost + hOf(ncell));
      }
    }
  }

  if (found === -1) {
    // Fallback: simple S-bend, flagged as degraded.
    const midY = gridRound((from.y + to.y) / 2);
    return { points: [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to], degraded: true };
  }

  const cells: number[] = [];
  for (let s = found; s !== -1; s = parent[s]) cells.push(s >> 2);
  cells.reverse();
  const points = cells.map(c => {
    const i = c % cols, j = (c - i) / cols;
    return { x: x0 + i * GRID, y: y0 + j * GRID };
  });
  points[0] = { ...from };
  points[points.length - 1] = { ...to };
  markOccupied(ctx, cells);
  return { points: simplify(points), degraded: false };
}

function markOccupied(ctx: RouterCtx, cells: number[]): void {
  for (let k = 1; k < cells.length - 1; k++) {
    ctx.occupied.set(cells[k], (ctx.occupied.get(cells[k]) ?? 0) + 1);
  }
}

export function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const straight = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!straight) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Remove "step" jigs: a sub-MIN_SEGMENT jog segment between two parallel
 *  segments is merged by snapping the corner to the neighbour line when the
 *  shifted corridors stay clear. Endpoints (ports) never move.
 *  Pattern: A→B (long) → B→C (jog) → C→D (long), B→C perpendicular to both. */
function removeJogs(points: Point[], views: NodeView[]): Point[] {
  let current = points;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 1; i < current.length - 2 && !changed; i++) {
      const A = current[i - 1];
      const B = current[i];
      const C = current[i + 1];
      const D = current[i + 2];
      const jogVertical = A.y === B.y && B.x === C.x && C.y === D.y && Math.abs(B.y - C.y) > 0;
      const jogHorizontal = A.x === B.x && B.y === C.y && C.x === D.x && Math.abs(B.x - C.x) > 0;
      const jogLen = jogVertical ? Math.abs(B.y - C.y) : jogHorizontal ? Math.abs(B.x - C.x) : 0;
      if (jogLen === 0 || jogLen >= MIN_SEGMENT) continue;
      const isFirstSegment = i - 1 === 0;
      const isLastSegment = i + 2 === current.length - 1;

      if (jogVertical) {
        // Variant 1: lift the C–D corner onto B's line, drop the jog point C.
        if (!isLastSegment) {
          const D2 = { x: D.x, y: B.y };
          const cornerShift = { x: D.x, y: C.y };
          if (segmentClear(views, B, D2, new Set()) &&
              segmentClear(views, cornerShift, D2, new Set())) {
            current = [...current.slice(0, i + 1), D2, ...current.slice(i + 3)];
            changed = true;
            break;
          }
        }
        // Variant 2: lower the prev–A corner onto C's line, drop the jog point B.
        if (!isFirstSegment) {
          const A2 = { x: A.x, y: C.y };
          if (segmentClear(views, A2, C, new Set()) &&
              segmentClear(views, A, A2, new Set())) {
            current = [...current.slice(0, i - 1), A2, ...current.slice(i + 1)];
            changed = true;
            break;
          }
        }
      } else if (jogHorizontal) {
        // Variant 1: shift the C–D corner onto B's line.
        if (!isLastSegment) {
          const D2 = { x: B.x, y: D.y };
          const cornerShift = { x: C.x, y: D.y };
          if (segmentClear(views, B, D2, new Set()) &&
              segmentClear(views, cornerShift, D2, new Set())) {
            current = [...current.slice(0, i + 1), D2, ...current.slice(i + 3)];
            changed = true;
            break;
          }
        }
        // Variant 2: shift the prev–A corner onto C's line.
        if (!isFirstSegment) {
          const A2 = { x: C.x, y: A.y };
          if (segmentClear(views, A2, C, new Set()) &&
              segmentClear(views, A, A2, new Set())) {
            current = [...current.slice(0, i - 1), A2, ...current.slice(i + 1)];
            changed = true;
            break;
          }
        }
      }
    }
    current = simplify(current);
    if (!changed) break;
  }
  return current;
}

// ── Canonical (template) routes ───────────────────────────────────────────────

/** Straight or single-S route for a clean downward edge; null if blocked. */
function canonicalFlow(s: NodeView, t: NodeView, views: NodeView[]): Point[] | null {
  const p1 = { x: s.x + s.w / 2, y: s.y + s.h };
  const p2 = { x: t.x + t.w / 2, y: t.y };
  if (p2.y <= p1.y + MIN_SEGMENT * 2) return null; // only clean downward edges
  const ignore = new Set([s.node.id, t.node.id]);
  if (p1.x === p2.x) {
    if (segmentClear(views, p1, p2, ignore)) return [p1, p2];
    return null;
  }
  if (Math.abs(p1.x - p2.x) < MIN_SEGMENT) return null;
  const midY = gridRound((p1.y + p2.y) / 2);
  if (midY - p1.y < MIN_SEGMENT || p2.y - midY < MIN_SEGMENT) return null;
  const m1 = { x: p1.x, y: midY };
  const m2 = { x: p2.x, y: midY };
  if (!segmentClear(views, p1, m1, ignore)) return null;
  if (!segmentClear(views, m1, m2, ignore)) return null;
  if (!segmentClear(views, m2, p2, ignore)) return null;
  return [p1, m1, m2, p2];
}

/** Straight or Z-elbow route for a function ↔ attachment connector; null if blocked. */
function canonicalAttachment(fv: NodeView, av: NodeView, views: NodeView[]): Point[] | null {
  const a = av.node as AttachedNode;
  const p1 = a.side === 'right'
    ? { x: fv.x + fv.w, y: fv.y + fv.h / 2 }
    : { x: fv.x, y: fv.y + fv.h / 2 };
  const p2 = a.side === 'right'
    ? { x: av.x, y: av.y + av.h / 2 }
    : { x: av.x + av.w, y: av.y + av.h / 2 };
  const ignore = new Set([fv.node.id, av.node.id]);
  if (p1.y === p2.y) {
    if (segmentClear(views, p1, p2, ignore)) return [p1, p2];
    return null;
  }
  const midX = gridRound((p1.x + p2.x) / 2);
  if (Math.abs(midX - p1.x) < MIN_SEGMENT || Math.abs(p2.x - midX) < MIN_SEGMENT) return null;
  const m1 = { x: midX, y: p1.y };
  const m2 = { x: midX, y: p2.y };
  if (!segmentClear(views, p1, m1, ignore)) return null;
  if (!segmentClear(views, m1, m2, ignore)) return null;
  if (!segmentClear(views, m2, p2, ignore)) return null;
  return [p1, m1, m2, p2];
}

// ── Diagram-level routing ─────────────────────────────────────────────────────

export function routeDiagram(
  d: Diagram,
  views: NodeView[],
): { flows: RoutedFlow[]; attachments: RoutedAttachment[] } {
  const mainViews = views.filter(v => isMainNode(v.node));
  if (mainViews.length === 0) return { flows: [], attachments: [] };
  const viewOf = new Map(views.map(v => [v.node.id, v]));
  const ctx = ctxFor(views);

  const attachments: RoutedAttachment[] = [];
  for (const v of views) {
    const t = v.node.type;
    if (t !== 'role' && t !== 'document' && t !== 'system') continue;
    const a = v.node as AttachedNode;
    const fv = viewOf.get(a.attachTo);
    if (!fv) continue;
    const dir = a.type === 'role' ? null : (a.dir ?? 'in');
    const canonical = canonicalAttachment(fv, v, views);
    if (canonical) {
      attachments.push({ nodeId: a.id, functionId: a.attachTo, dir, points: canonical });
      continue;
    }
    const from: Point = a.side === 'right'
      ? { x: fv.x + fv.w, y: fv.y + fv.h / 2 }
      : { x: fv.x, y: fv.y + fv.h / 2 };
    const to: Point = a.side === 'right'
      ? { x: v.x, y: v.y + v.h / 2 }
      : { x: v.x + v.w, y: v.y + v.h / 2 };
    const r = routeSegment(ctx, from, a.side === 'right' ? 'right' : 'left',
      to, a.side === 'right' ? 'right' : 'left');
    attachments.push({ nodeId: a.id, functionId: a.attachTo, dir, points: r.points });
  }

  const flows: RoutedFlow[] = [];
  for (const f of d.flows) {
    const sv = viewOf.get(f.from) as NodeView | undefined;
    const tv = viewOf.get(f.to) as NodeView | undefined;
    if (!sv || !tv) continue;
    if (!isMainNode(sv.node) || !isMainNode(tv.node)) continue;
    const canonical = canonicalFlow(sv, tv, views);
    if (canonical) {
      flows.push({ edge: f, points: canonical, degraded: false });
      continue;
    }
    const from = { x: sv.x + sv.w / 2, y: sv.y + sv.h };
    const to = { x: tv.x + tv.w / 2, y: tv.y };
    const r = routeSegment(ctx, from, 'down', to, 'down');
    const cleaned = r.degraded ? r.points : removeJogs(r.points, views);
    flows.push({ edge: f, points: cleaned, degraded: r.degraded });
  }

  return { flows, attachments };
}
