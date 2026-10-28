import { describe, expect, it } from 'vitest';
import { parseDiagramJson } from '../model';
import type { Diagram } from '../types';
import { canConnect, validateDiagram } from '../validation';
import example01 from '../../../examples/01-obrabotka-obrashcheniya.eepc.json?raw';
import example02 from '../../../examples/02-obrabotka-zakaza.eepc.json?raw';

function parse(text: string): Diagram {
  const parsed = parseDiagramJson(text);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.diagram;
}

const errorsOf = (d: Diagram) => validateDiagram(d).filter(i => i.level === 'error');
const codesOf = (d: Diagram) => validateDiagram(d).map(i => i.code);

describe('validation: bundled examples', () => {
  it('example 01 has no notation errors', () => {
    expect(errorsOf(parse(example01))).toEqual([]);
  });

  it('example 02 has no notation errors', () => {
    expect(errorsOf(parse(example02))).toEqual([]);
  });
});

describe('validation: rule checks', () => {
  it('flags process not starting with an event', () => {
    const d = parse(example01);
    d.flows = d.flows.filter(f => f.id !== 'fl1'); // detach the start event
    const codes = codesOf(d);
    expect(codes).toContain('start-not-event');
    expect(codes).toContain('unconnected');
  });

  it('flags process not ending with an event', () => {
    const d = parse(example01);
    d.flows = d.flows.filter(f => f.id !== 'fl12'); // detach the final event
    expect(codesOf(d)).toContain('end-not-event');
  });

  it('flags two consecutive events', () => {
    const d = parse(example01);
    d.flows.push({ id: 'flX', from: 'e6', to: 'e2' });
    expect(codesOf(d)).toContain('event-event');
  });

  it('flags multiple outputs of a function', () => {
    const d = parse(example01);
    d.flows.push({ id: 'flX', from: 'f4', to: 'e2' });
    expect(codesOf(d)).toContain('multi-out');
  });

  it('flags multiple inputs of a function', () => {
    const d = parse(example01);
    d.flows.push({ id: 'flX', from: 'e2', to: 'f1' });
    expect(codesOf(d)).toContain('multi-in');
  });

  it('flags event connected to event through a gateway chain', () => {
    const d = parse(example02);
    // Rewire the AND split straight to events, removing function neighbours.
    d.flows = d.flows.filter(f => !['fl2', 'fl4', 'fl6'].includes(f.id));
    d.flows.push({ id: 'flX', from: 'gA', to: 'eA1' });
    expect(codesOf(d)).toContain('event-event-via-gw');
    expect(codesOf(d)).toContain('gateway-no-func');
  });
});

describe('canConnect', () => {
  it('refuses a second output of an event', () => {
    const d = parse(example01);
    const check = canConnect(d, 'e1', 'e2');
    expect(check.ok).toBe(false);
  });

  it('refuses event to event', () => {
    const d = parse(example01);
    const check = canConnect(d, 'e2', 'e5');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('функцию');
  });

  it('allows gateway fan-out', () => {
    const d = parse(example01);
    d.flows = d.flows.filter(f => f.id !== 'fl3'); // free e2's input
    expect(canConnect(d, 'g1', 'e2').ok).toBe(true); // g1 already has 2 other outputs
  });
});
