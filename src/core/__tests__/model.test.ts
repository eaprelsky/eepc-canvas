import { describe, expect, it } from 'vitest';
import {
  addFlow, emptyDiagram, makeNode, parseDiagram, parseDiagramJson, removeNode,
  serializeDiagram,
} from '../model';

describe('model: parse', () => {
  it('parses a minimal valid diagram', () => {
    const res = parseDiagram({
      format: 'eepc-diagram',
      version: 1,
      name: 'Тест',
      nodes: [
        { id: 'e1', type: 'event', label: 'Поступила заявка' },
        { id: 'f1', type: 'function', label: 'Обработать заявку' },
        { id: 'e2', type: 'event', label: 'Заявка обработана' },
      ],
      flows: [
        { id: 'fl1', from: 'e1', to: 'f1' },
        { id: 'fl2', from: 'f1', to: 'e2' },
      ],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.diagram.nodes).toHaveLength(3);
      expect(res.diagram.flows).toHaveLength(2);
    }
  });

  it('rejects unknown element type', () => {
    const res = parseDiagram({
      nodes: [{ id: 'x1', type: 'database', label: 'БД' }],
      flows: [],
    });
    expect(res.ok).toBe(false);
  });

  it('rejects attachment to a non-function', () => {
    const res = parseDiagram({
      nodes: [
        { id: 'e1', type: 'event', label: 'A' },
        { id: 'r1', type: 'role', label: 'Роль', attachTo: 'e1' },
      ],
      flows: [],
    });
    expect(res.ok).toBe(false);
  });

  it('drops duplicate flows and keeps order', () => {
    const res = parseDiagramJson(JSON.stringify({
      nodes: [
        { id: 'e1', type: 'event', label: 'A' },
        { id: 'f1', type: 'function', label: 'B' },
      ],
      flows: [
        { from: 'e1', to: 'f1' },
        { from: 'e1', to: 'f1' },
      ],
    }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.diagram.flows).toHaveLength(1);
  });
});

describe('model: mutation helpers', () => {
  it('generates unique ids per prefix', () => {
    const d = emptyDiagram();
    const e1 = makeNode(d, 'event', 'A');
    d.nodes.push(e1);
    const e2 = makeNode(d, 'event', 'B');
    expect(e1.id).toBe('e1');
    expect(e2.id).toBe('e2');
  });

  it('addFlow refuses self and duplicate edges', () => {
    const d = emptyDiagram();
    d.nodes.push(
      makeNode(d, 'event', 'A'),
      makeNode(d, 'function', 'B'),
    );
    const a = d.nodes[0].id, b = d.nodes[1].id;
    expect(addFlow(d, a, a)).toBeNull();
    expect(addFlow(d, a, b)).not.toBeNull();
    expect(addFlow(d, a, b)).toBeNull();
  });

  it('removeNode cascades to flows and attachments', () => {
    const d = emptyDiagram();
    const e1 = makeNode(d, 'event', 'A');
    const f1 = makeNode(d, 'function', 'B');
    const r1 = makeNode(d, 'role', 'Роль', { attachTo: f1.id });
    d.nodes.push(e1, f1, r1);
    d.flows.push({ id: 'fl1', from: e1.id, to: f1.id });
    removeNode(d, f1.id);
    expect(d.nodes.map(n => n.id)).toEqual([e1.id]);
    expect(d.flows).toHaveLength(0);
  });
});

describe('model: serialization', () => {
  it('round-trips through serialize/parse', () => {
    const d = emptyDiagram('Круговая');
    const e1 = makeNode(d, 'event', 'Старт', { x: 40, y: 60 });
    const f1 = makeNode(d, 'function', 'Сделать дело');
    const g1 = makeNode(d, 'gateway', '');
    const r1 = makeNode(d, 'role', 'Роль', { attachTo: f1.id });
    d.nodes.push(e1, f1, g1, r1);
    d.flows.push({ id: 'fl1', from: e1.id, to: f1.id });
    const res = parseDiagramJson(serializeDiagram(d));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.diagram.name).toBe('Круговая');
      expect(res.diagram.nodes).toHaveLength(4);
      expect(res.diagram.flows).toHaveLength(1);
      expect(res.diagram.nodes.find(n => n.id === e1.id)?.x).toBe(40);
    }
  });
});
