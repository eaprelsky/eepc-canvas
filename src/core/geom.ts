import { GRID } from './constants';
import type { Point, Rect } from './types';

export function gridFloor(v: number): number { return Math.floor(v / GRID) * GRID; }
export function gridCeil(v: number): number { return Math.ceil(v / GRID) * GRID; }
export function gridRound(v: number): number { return Math.round(v / GRID) * GRID; }

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap &&
         a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

export function bboxOf(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function centerOf(r: Rect): Point { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

/** Ensure a rect is strictly inside the bounds by growing bounds is NOT done here;
 *  this returns the rect shifted inside bounds when it sticks out. */
export function clampRect(r: Rect, bounds: Rect): Rect {
  let { x, y } = r;
  x = Math.min(Math.max(x, bounds.x), bounds.x + bounds.w - r.w);
  y = Math.min(Math.max(y, bounds.y), bounds.y + bounds.h - r.h);
  return { x, y, w: r.w, h: r.h };
}
