import { CLEARANCE, GRID, SOFT_CLEARANCE } from '../constants';
import { bboxOf, gridFloor, gridRound } from '../geom';
import type {
  AttachedNode, Diagram, Dir, FlowEdge, NodeView, Point, RoutedAttachment, RoutedFlow,
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

function ctxFor(views: NodeView[]): RouterCtx {
  const bb = bboxOf(views.map(v => ({ x: v.x, y: v.y, w: v.w, h: v.h })));
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

// ── Diagram-level routing ─────────────────────────────────────────────────────

function bottomPort(v: NodeView, offset: number): Point {
  return { x: gridRound(v.x + v.w / 2 + offset), y: v.y + v.h };
}
function topPort(v: NodeView, offset: number): Point {
  return { x: gridRound(v.x + v.w / 2 + offset), y: v.y };
}

export function routeDiagram(
  d: Diagram,
  views: NodeView[],
): { flows: RoutedFlow[]; attachments: RoutedAttachment[] } {
  const mainViews = views.filter(v => isMainNode(v.node));
  if (mainViews.length === 0) return { flows: [], attachments: [] };
  const viewOf = new Map(views.map(v => [v.node.id, v]));
  const ctx = ctxFor(views);

  // Group flows per endpoint and spread ports along the borders.
  const outGroups = new Map<string, FlowEdge[]>();
  const inGroups = new Map<string, FlowEdge[]>();
  for (const f of d.flows) {
    const fv = viewOf.get(f.from);
    const tv = viewOf.get(f.to);
    if (!fv || !tv) continue;
    if (!isMainNode(fv.node) || !isMainNode(tv.node)) continue;
    if (!outGroups.has(f.from)) outGroups.set(f.from, []);
    outGroups.get(f.from)!.push(f);
    if (!inGroups.has(f.to)) inGroups.set(f.to, []);
    inGroups.get(f.to)!.push(f);
  }
  const cx = (v: NodeView) => v.x + v.w / 2;
  for (const list of outGroups.values()) {
    list.sort((a, b) => cx(viewOf.get(a.to)!) - cx(viewOf.get(b.to)!));
  }
  for (const list of inGroups.values()) {
    list.sort((a, b) => cx(viewOf.get(a.from)!) - cx(viewOf.get(b.from)!));
  }
  const outPort = new Map<string, Point>();
  const inPort = new Map<string, Point>();
  for (const [id, list] of outGroups) {
    const v = viewOf.get(id)!;
    list.forEach((f, i) => outPort.set(f.id, bottomPort(v, (i - (list.length - 1) / 2) * 20)));
  }
  for (const [id, list] of inGroups) {
    const v = viewOf.get(id)!;
    list.forEach((f, i) => inPort.set(f.id, topPort(v, (i - (list.length - 1) / 2) * 20)));
  }

  // Attachments first: short horizontal lines, deterministic order.
  const attachments: RoutedAttachment[] = [];
  for (const v of views) {
    const t = v.node.type;
    if (t !== 'role' && t !== 'document' && t !== 'system') continue;
    const a = v.node as AttachedNode;
    const fv = viewOf.get(a.attachTo);
    if (!fv) continue;
    const dir = a.type === 'role' ? null : (a.dir ?? 'in');
    if (a.side === 'right') {
      const from: Point = { x: fv.x + fv.w, y: fv.y + fv.h / 2 };
      const to: Point = { x: v.x, y: v.y + v.h / 2 };
      const r = routeSegment(ctx, from, 'right', to, 'right');
      attachments.push({ nodeId: a.id, functionId: a.attachTo, dir, points: r.points });
    } else {
      const from: Point = { x: fv.x, y: fv.y + fv.h / 2 };
      const to: Point = { x: v.x + v.w, y: v.y + v.h / 2 };
      const r = routeSegment(ctx, from, 'left', to, 'left');
      attachments.push({ nodeId: a.id, functionId: a.attachTo, dir, points: r.points });
    }
  }

  const flows: RoutedFlow[] = [];
  for (const f of d.flows) {
    const from = outPort.get(f.id);
    const to = inPort.get(f.id);
    if (!from || !to) continue;
    const r = routeSegment(ctx, from, 'down', to, 'down');
    flows.push({ edge: f, points: r.points, degraded: r.degraded });
  }

  return { flows, attachments };
}
