import { describe, expect, it } from 'vitest';
import { autoArrange, layoutDiagram } from '../layout';
import { emptyDiagram, makeNode } from '../model';
import type { Diagram, LayoutedDiagram, NodeView } from '../types';
import { isAttachedNode, isMainNode } from '../types';
import example01 from '../../../examples/01-obrabotka-obrashcheniya.eepc.json?raw';
import example02 from '../../../examples/02-obrabotka-zakaza.eepc.json?raw';
import { parseDiagramJson } from '../model';

function parse(text: string): Diagram {
  const parsed = parseDiagramJson(text);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.diagram;
}

function expectGridAligned(l: LayoutedDiagram): void {
  for (const v of l.views) {
    expect(v.x % 10, `${v.node.id}.x=${v.x}`).toBe(0);
    expect(v.y % 10, `${v.node.id}.y=${v.y}`).toBe(0);
    expect(v.w % 10, `${v.node.id}.w=${v.w}`).toBe(0);
    expect(v.h % 10, `${v.node.id}.h=${v.h}`).toBe(0);
  }
}

function expectNoOverlaps(l: LayoutedDiagram): void {
  for (let i = 0; i < l.views.length; i++) {
    for (let j = i + 1; j < l.views.length; j++) {
      const a = l.views[i], b = l.views[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w &&
                      a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.node.id} overlaps ${b.node.id}`).toBe(false);
    }
  }
}

function expectFlowsGoDown(l: LayoutedDiagram): void {
  const viewOf = new Map(l.views.map(v => [v.node.id, v]));
  for (const f of l.flows) {
    const from = viewOf.get(f.edge.from)!;
    const to = viewOf.get(f.edge.to)!;
    expect(from.y + from.h <= to.y + 1,
      `${f.edge.from}->${f.edge.to} should go down`).toBe(true);
  }
}

const EXAMPLES: Array<[string, string]> = [
  ['01-obrabotka-obrashcheniya', example01],
  ['02-obrabotka-zakaza', example02],
];

describe('auto layout: bundled examples', () => {
  for (const [name, raw] of EXAMPLES) {
    it(`lays out ${name} on a clean grid without overlaps`, () => {
      const d = parse(raw);
      const l = autoArrange(d);
      expect(l.views.length).toBe(d.nodes.length);
      expectGridAligned(l);
      expectNoOverlaps(l);
      expectFlowsGoDown(l);
      expect(l.width).toBeGreaterThan(0);
      expect(l.height).toBeGreaterThan(0);
      for (const n of d.nodes.filter(isMainNode)) {
        expect(n.x).toBeDefined();
        expect(n.y).toBeDefined();
      }
    });
  }

  it('keeps attachments beside their functions', () => {
    const d = parse(example01);
    const l = autoArrange(d);
    const viewOf = new Map(l.views.map(v => [v.node.id, v]));
    for (const v of l.views) {
      if (!isAttachedNode(v.node)) continue;
      const f = viewOf.get(v.node.attachTo)!;
      const sameRowBand = Math.abs((v.y + v.h / 2) - (f.y + f.h / 2)) <= 150;
      expect(sameRowBand, `${v.node.id} should sit near its function`).toBe(true);
      if (v.node.side === 'left') {
        expect(v.x + v.w <= f.x).toBe(true);
      } else {
        expect(v.x >= f.x + f.w).toBe(true);
      }
    }
  });

  it('routes straight vertical arrows for aligned single chains', () => {
    const d = emptyDiagram('Цепочка');
    const e1 = makeNode(d, 'event', 'Старт');
    d.nodes.push(e1);
    const f1 = makeNode(d, 'function', 'Сделать дело');
    d.nodes.push(f1);
    const e2 = makeNode(d, 'event', 'Дело сделано');
    d.nodes.push(e2);
    d.flows.push(
      { id: 'fl1', from: e1.id, to: f1.id },
      { id: 'fl2', from: f1.id, to: e2.id },
    );
    const l = autoArrange(d);
    for (const f of l.flows) {
      expect(f.points).toHaveLength(2);
      expect(f.points[0].x).toBe(f.points[1].x);
      expect(f.degraded).toBe(false);
    }
  });
});

describe('auto layout: cycles', () => {
  it('handles a loop without overlaps and still routes every edge', () => {
    const d = emptyDiagram('Цикл');
    const e1 = makeNode(d, 'event', 'Старт');
    d.nodes.push(e1);
    const f1 = makeNode(d, 'function', 'Первый шаг');
    d.nodes.push(f1);
    const e2 = makeNode(d, 'event', 'Первый шаг выполнен');
    d.nodes.push(e2);
    const f2 = makeNode(d, 'function', 'Второй шаг');
    d.nodes.push(f2);
    const e3 = makeNode(d, 'event', 'Возврат требуется');
    d.nodes.push(e3);
    d.flows.push(
      { id: 'fl1', from: e1.id, to: f1.id },
      { id: 'fl2', from: f1.id, to: e2.id },
      { id: 'fl3', from: e2.id, to: f2.id },
      { id: 'fl4', from: f2.id, to: e3.id },
      { id: 'fl5', from: e3.id, to: f1.id }, // back edge creating a cycle
    );
    const l = autoArrange(d);
    expectGridAligned(l);
    expectNoOverlaps(l);
    expect(l.flows).toHaveLength(5);
    for (const f of l.flows) {
      expect(f.points.length).toBeGreaterThanOrEqual(2);
      expect(f.degraded).toBe(false);
    }
    const back = l.flows.find(f => f.edge.id === 'fl5')!;
    expect(back.points.length).toBeGreaterThan(2); // it must detour around
  });
});

describe('manual positions', () => {
  it('keeps stored positions and resolves collisions', () => {
    const d = emptyDiagram('Вручную');
    const e1 = makeNode(d, 'event', 'Событие А', { x: 100, y: 100 });
    d.nodes.push(e1);
    const e2 = makeNode(d, 'event', 'Событие Б', { x: 100, y: 100 }); // exact overlap!
    d.nodes.push(e2);
    const l = layoutDiagram(d);
    expectNoOverlaps(l);
  });

  it('falls back to auto layout when positions are missing', () => {
    const d = parse(example01);
    for (const n of d.nodes) { delete n.x; delete n.y; }
    const l = layoutDiagram(d);
    expectGridAligned(l);
    expectNoOverlaps(l);
  });
});

describe('node view basics', () => {
  it('gives all non-gateway elements the same height', () => {
    const l = autoArrange(parse(example01));
    const heights = new Set(l.views.filter(v => v.node.type !== 'gateway').map(v => v.h));
    expect(heights.size).toBe(1);
  });

  it('wraps long labels to at most 4 lines', () => {
    const d = emptyDiagram('Длинный текст');
    const e1 = makeNode(d, 'event',
      'Поступил очень-очень длинный запрос на согласование бюджета на следующий отчётный период от филиала');
    d.nodes.push(e1);
    const l = autoArrange(d);
    const v = l.views.find(x => x.node.id === e1.id) as NodeView;
    expect(v.lines.length).toBeLessThanOrEqual(4);
  });
});
