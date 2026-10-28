import { describe, expect, it } from 'vitest';
import { autoArrange } from '../layout';
import { parseDiagramJson } from '../model';
import type { AttachedNode, LayoutedDiagram, Point } from '../types';
import { isAttachedNode } from '../types';
import example01 from '../../../examples/01-obrabotka-obrashcheniya.eepc.json?raw';
import example02 from '../../../examples/02-obrabotka-zakaza.eepc.json?raw';

function load(raw: string): { l: LayoutedDiagram; attachedCount: number } {
  const parsed = parseDiagramJson(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return {
    l: autoArrange(parsed.diagram),
    attachedCount: parsed.diagram.nodes.filter(isAttachedNode).length,
  };
}

function isOrthogonal(points: Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false;
  }
  return true;
}

/** Points strictly inside the polyline (away from both endpoints). */
function interiorSamples(points: Point[], margin = 8, step = 5): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    const n = Math.max(1, Math.floor(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const distStart = i === 0 ? Math.hypot(p.x - points[0].x, p.y - points[0].y) : margin + 1;
      const last = points[points.length - 1];
      const isLastSeg = i === points.length - 2;
      const distEnd = isLastSeg ? Math.hypot(p.x - last.x, p.y - last.y) : margin + 1;
      if (distStart > margin && distEnd > margin) out.push(p);
    }
  }
  return out;
}

const EXAMPLES: Array<[string, string]> = [
  ['01-obrabotka-obrashcheniya', example01],
  ['02-obrabotka-zakaza', example02],
];

describe('router: bundled examples', () => {
  for (const [name, raw] of EXAMPLES) {
    it(`routes ${name} with exact border endpoints and no cut-through`, () => {
      const { l } = load(raw);
      const viewOf = new Map(l.views.map(v => [v.node.id, v]));

      for (const f of l.flows) {
        expect(f.degraded, `${f.edge.id} degraded`).toBe(false);
        expect(isOrthogonal(f.points), `${f.edge.id} orthogonal`).toBe(true);

        const src = viewOf.get(f.edge.from)!;
        const dst = viewOf.get(f.edge.to)!;
        const first = f.points[0];
        const last = f.points[f.points.length - 1];

        // Starts exactly on the source bottom border.
        expect(first.y).toBe(src.y + src.h);
        expect(first.x).toBeGreaterThanOrEqual(src.x);
        expect(first.x).toBeLessThanOrEqual(src.x + src.w);

        // Ends exactly on the target top border.
        expect(last.y).toBe(dst.y);
        expect(last.x).toBeGreaterThanOrEqual(dst.x);
        expect(last.x).toBeLessThanOrEqual(dst.x + dst.w);

        // Interior of the line never crosses a figure.
        for (const p of interiorSamples(f.points)) {
          for (const v of l.views) {
            const inRect = p.x > v.x - 3 && p.x < v.x + v.w + 3 &&
                           p.y > v.y - 3 && p.y < v.y + v.h + 3;
            expect(inRect, `${f.edge.id} passes through ${v.node.id} at ${p.x},${p.y}`).toBe(false);
          }
        }
      }

      for (const at of l.attachments) {
        expect(isOrthogonal(at.points)).toBe(true);
        const sideView = viewOf.get(at.nodeId)!;
        const sideNode = sideView.node as AttachedNode;
        const funcView = viewOf.get(at.functionId)!;
        const first = at.points[0];
        const last = at.points[at.points.length - 1];
        if (sideNode.side === 'left') {
          expect(first.x).toBe(funcView.x);             // on the function left border
          expect(last.x).toBe(sideView.x + sideView.w); // on the side node right border
        } else {
          expect(first.x).toBe(funcView.x + funcView.w);
          expect(last.x).toBe(sideView.x);
        }
        for (const p of interiorSamples(at.points)) {
          for (const v of l.views) {
            const inRect = p.x > v.x - 3 && p.x < v.x + v.w + 3 &&
                           p.y > v.y - 3 && p.y < v.y + v.h + 3;
            expect(inRect, `attachment ${at.nodeId} passes through ${v.node.id}`).toBe(false);
          }
        }
      }
    });
  }

  it('spreads multiple outgoing ports of a gateway apart', () => {
    const { l } = load(example01);
    const fromG1 = l.flows.filter(f => f.edge.from === 'g1');
    expect(fromG1.length).toBeGreaterThanOrEqual(2);
    const xs = fromG1.map(f => f.points[0].x);
    const uniq = new Set(xs);
    expect(uniq.size).toBe(xs.length);
  });

  it('routes attachments for every attached element', () => {
    const { l, attachedCount } = load(example01);
    expect(attachedCount).toBeGreaterThanOrEqual(6);
    expect(l.attachments).toHaveLength(attachedCount);
  });
});
