export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl(tag: string, attrs: Record<string, string | number | undefined> = {}): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) e.setAttribute(k, String(v));
  }
  return e;
}

/** Orthogonal polyline with rounded corners as an SVG path. */
export function roundedPath(points: Array<{ x: number; y: number }>, r = 8): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    const [a, b] = points;
    return `M${a.x},${a.y} L${b.x},${b.y}`;
  }
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    const len1 = Math.hypot(p.x - prev.x, p.y - prev.y);
    const len2 = Math.hypot(next.x - p.x, next.y - p.y);
    const rr = Math.min(r, len1 / 2, len2 / 2);
    const dir1 = { x: (p.x - prev.x) / len1, y: (p.y - prev.y) / len1 };
    const dir2 = { x: (next.x - p.x) / len2, y: (next.y - p.y) / len2 };
    const a = { x: p.x - dir1.x * rr, y: p.y - dir1.y * rr };
    const b = { x: p.x + dir2.x * rr, y: p.y + dir2.y * rr };
    d += ` L${a.x},${a.y} Q${p.x},${p.y} ${b.x},${b.y}`;
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}
