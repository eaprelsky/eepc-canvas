import { gridRound } from './geom';
import type {
  AttachDir, AttachedNode, Diagram, DiagramNode, FlowEdge, GatewayOperator, NodeType, Side,
} from './types';
import { isAttachedNode, isMainNode } from './types';

const TYPE_PREFIX: Record<NodeType, string> = {
  event: 'e', function: 'f', gateway: 'g', role: 'r', document: 'd', system: 's',
};

const NODE_TYPES = new Set<string>(['event', 'function', 'gateway', 'role', 'document', 'system']);
const OPERATORS = new Set<string>(['XOR', 'OR', 'AND']);
const SIDES = new Set<string>(['left', 'right']);
const DIRS = new Set<string>(['in', 'out', 'both']);

export function emptyDiagram(name = 'Новый процесс'): Diagram {
  return { format: 'eepc-diagram', version: 1, name, nodes: [], flows: [] };
}

export function cloneDiagram(d: Diagram): Diagram {
  return JSON.parse(JSON.stringify(d)) as Diagram;
}

export function nodeById(d: Diagram, id: string): DiagramNode | undefined {
  return d.nodes.find(n => n.id === id);
}

export function mainNodes(d: Diagram): DiagramNode[] {
  return d.nodes.filter(isMainNode);
}

export function sideNodes(d: Diagram): AttachedNode[] {
  return d.nodes.filter(isAttachedNode);
}

export function attachmentsOf(d: Diagram, funcId: string): AttachedNode[] {
  return d.nodes.filter(n => isAttachedNode(n) && n.attachTo === funcId) as AttachedNode[];
}

export function outFlows(d: Diagram, id: string): FlowEdge[] {
  return d.flows.filter(f => f.from === id);
}

export function inFlows(d: Diagram, id: string): FlowEdge[] {
  return d.flows.filter(f => f.to === id);
}

export function nextId(d: Diagram, type: NodeType): string {
  const prefix = TYPE_PREFIX[type];
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const n of d.nodes) {
    const m = re.exec(n.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}${max + 1}`;
}

export interface MakeNodeOptions {
  operator?: GatewayOperator;
  attachTo?: string;
  side?: Side;
  dir?: AttachDir;
  x?: number;
  y?: number;
}

export function makeNode(d: Diagram, type: NodeType, label: string, opts: MakeNodeOptions = {}): DiagramNode {
  const id = nextId(d, type);
  const base = { id, type, label };
  if (type === 'gateway') {
    return { ...base, type: 'gateway', operator: opts.operator ?? 'XOR', x: opts.x, y: opts.y };
  }
  if (type === 'role' || type === 'document' || type === 'system') {
    const node: AttachedNode = {
      ...base,
      type,
      attachTo: opts.attachTo ?? '',
      side: opts.side ?? (type === 'document' ? 'left' : 'right'),
    };
    if (type !== 'role') node.dir = opts.dir ?? 'in';
    return node;
  }
  return { ...base, type: type as 'event' | 'function', x: opts.x, y: opts.y };
}

export function addNode(d: Diagram, node: DiagramNode): void {
  d.nodes.push(node);
}

/** Removes a node. Flows touching it are removed; its attachments are removed too. */
export function removeNode(d: Diagram, id: string): void {
  d.nodes = d.nodes.filter(n => n.id !== id && !(isAttachedNode(n) && n.attachTo === id));
  d.flows = d.flows.filter(f => f.from !== id && f.to !== id);
}

export function addFlow(d: Diagram, from: string, to: string): FlowEdge | null {
  if (from === to) return null;
  if (d.flows.some(f => f.from === from && f.to === to)) return null;
  let max = 0;
  for (const f of d.flows) {
    const m = /^fl(\d+)$/.exec(f.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const edge: FlowEdge = { id: `fl${max + 1}`, from, to };
  d.flows.push(edge);
  return edge;
}

export function removeFlow(d: Diagram, edgeId: string): void {
  d.flows = d.flows.filter(f => f.id !== edgeId);
}

// ── Parsing ──────────────────────────────────────────────────────────────────

export type ParseResult = { ok: true; diagram: Diagram } | { ok: false; errors: string[] };

export function parseDiagram(raw: unknown): ParseResult {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['Файл не является JSON-объектом'] };
  }
  const r = raw as Record<string, unknown>;
  if (r.format !== undefined && r.format !== 'eepc-diagram') {
    return { ok: false, errors: [`Неизвестный формат: ${String(r.format)} (ожидался eepc-diagram)`] };
  }
  if (r.version !== undefined && r.version !== 1) {
    return { ok: false, errors: [`Неподдерживаемая версия: ${String(r.version)}`] };
  }
  const name = typeof r.name === 'string' ? r.name : 'Без названия';
  if (!Array.isArray(r.nodes)) return { ok: false, errors: ['Нет массива nodes'] };
  if (r.flows !== undefined && !Array.isArray(r.flows)) return { ok: false, errors: ['flows должен быть массивом'] };

  const nodes: DiagramNode[] = [];
  const ids = new Set<string>();
  r.nodes.forEach((rawNode, i) => {
    const err = (msg: string) => errors.push(`nodes[${i}]: ${msg}`);
    if (typeof rawNode !== 'object' || rawNode === null) { err('не объект'); return; }
    const n = rawNode as Record<string, unknown>;
    const id = typeof n.id === 'string' ? n.id : '';
    if (!id) { err('нет id'); return; }
    if (ids.has(id)) { err(`дубль id ${id}`); return; }
    const type = String(n.type);
    if (!NODE_TYPES.has(type)) { err(`неизвестный тип ${type}`); return; }
    const label = typeof n.label === 'string' ? n.label : '';
    const x = typeof n.x === 'number' && Number.isFinite(n.x) ? gridRound(n.x) : undefined;
    const y = typeof n.y === 'number' && Number.isFinite(n.y) ? gridRound(n.y) : undefined;
    if (type === 'gateway') {
      let op = typeof n.operator === 'string' ? n.operator.toUpperCase() : 'XOR';
      if (op === 'X') op = 'XOR';
      if (!OPERATORS.has(op)) op = 'XOR';
      nodes.push({ id, type: 'gateway', label, operator: op as GatewayOperator, x, y });
      ids.add(id);
      return;
    }
    if (type === 'role' || type === 'document' || type === 'system') {
      const attachTo = typeof n.attachTo === 'string' ? n.attachTo : '';
      const side = typeof n.side === 'string' && SIDES.has(n.side) ? n.side as Side
        : type === 'document' ? 'left' : 'right';
      let dir: AttachDir | undefined;
      if (type !== 'role') {
        dir = typeof n.dir === 'string' && DIRS.has(n.dir) ? n.dir as AttachDir : 'in';
      }
      nodes.push({ id, type, label, attachTo, side, ...(dir ? { dir } : {}) });
      ids.add(id);
      return;
    }
    nodes.push({ id, type, label, x, y } as DiagramNode);
    ids.add(id);
  });

  const flows: FlowEdge[] = [];
  const seen = new Set<string>();
  const flowList = Array.isArray(r.flows) ? r.flows : [];
  flowList.forEach((rawFlow, i) => {
    const err = (msg: string) => errors.push(`flows[${i}]: ${msg}`);
    if (typeof rawFlow !== 'object' || rawFlow === null) { err('не объект'); return; }
    const f = rawFlow as Record<string, unknown>;
    const from = typeof f.from === 'string' ? f.from : '';
    const to = typeof f.to === 'string' ? f.to : '';
    if (!from || !to) { err('нет from/to'); return; }
    if (!ids.has(from)) { err(`from ${from} не существует`); return; }
    if (!ids.has(to)) { err(`to ${to} не существует`); return; }
    const key = `${from}->${to}`;
    if (seen.has(key)) return; // silently drop exact duplicates
    if (from === to) { err('петля на себя'); return; }
    seen.add(key);
    const id = typeof f.id === 'string' ? f.id : `fl${flows.length + 1}`;
    flows.push({ id, from, to });
  });

  // Attachments must point at functions.
  for (const n of nodes) {
    if (isAttachedNode(n)) {
      const target = nodes.find(m => m.id === n.attachTo);
      if (!target) errors.push(`Элемент ${n.id}: attachTo ${n.attachTo} не существует`);
      else if (target.type !== 'function') errors.push(`Элемент ${n.id} может быть привязан только к функции, а не к ${target.type}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, diagram: { format: 'eepc-diagram', version: 1, name, nodes, flows } };
}

export function parseDiagramJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Некорректный JSON: ${(e as Error).message}`] };
  }
  return parseDiagram(raw);
}

// ── Serialization ────────────────────────────────────────────────────────────

export function serializeDiagram(d: Diagram): string {
  const nodes = d.nodes.map(n => {
    const o: Record<string, unknown> = { id: n.id, type: n.type };
    if (n.label) o.label = n.label;
    if (n.type === 'gateway') o.operator = n.operator;
    if (isAttachedNode(n)) {
      o.attachTo = n.attachTo;
      o.side = n.side;
      if (n.type !== 'role' && n.dir) o.dir = n.dir;
    }
    if (n.x !== undefined) o.x = n.x;
    if (n.y !== undefined) o.y = n.y;
    return o;
  });
  const flows = d.flows.map(f => ({ id: f.id, from: f.from, to: f.to }));
  return JSON.stringify({ format: 'eepc-diagram', version: 1, name: d.name, nodes, flows }, null, 2) + '\n';
}
