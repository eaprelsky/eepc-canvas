export type NodeType = 'event' | 'function' | 'gateway' | 'role' | 'document' | 'system';
export type GatewayOperator = 'XOR' | 'OR' | 'AND';
export type Side = 'left' | 'right';
/** Direction of document/system attachment arrows. Roles are always undirected. */
export type AttachDir = 'in' | 'out' | 'both';

export const MAIN_TYPES: ReadonlySet<NodeType> = new Set(['event', 'function', 'gateway'] as NodeType[]);
export const SIDE_TYPES: ReadonlySet<NodeType> = new Set(['role', 'document', 'system'] as NodeType[]);

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export type Dir = 'up' | 'down' | 'left' | 'right';

interface NodeBase {
  id: string;
  type: NodeType;
  label: string;
  /** Optional persisted position. Missing positions are computed by auto-layout. */
  x?: number;
  y?: number;
}

export interface EventNode extends NodeBase { type: 'event' }
export interface FunctionNode extends NodeBase { type: 'function' }
export interface GatewayNode extends NodeBase { type: 'gateway'; operator: GatewayOperator }

export interface AttachedNode extends NodeBase {
  type: 'role' | 'document' | 'system';
  /** Id of the function this element is attached to. */
  attachTo: string;
  /** Which side of the function the element sits on. */
  side: Side;
  /** Arrow direction for document/system. Ignored for roles. */
  dir?: AttachDir;
}

export type DiagramNode = EventNode | FunctionNode | GatewayNode | AttachedNode;

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
}

export interface Diagram {
  format: 'eepc-diagram';
  version: 1;
  name: string;
  nodes: DiagramNode[];
  flows: FlowEdge[];
}

/** Node with computed geometry, used by layout, routing and rendering. */
export interface NodeView {
  node: DiagramNode;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wrapped label lines (empty for gateways). */
  lines: string[];
  font: number;
  lineH: number;
}

export interface RoutedFlow {
  edge: FlowEdge;
  points: Point[];
  degraded: boolean;
}

export interface RoutedAttachment {
  nodeId: string;
  functionId: string;
  dir: AttachDir | null; // null for roles (undirected)
  points: Point[];
}

export interface LayoutedDiagram {
  diagram: Diagram;
  views: NodeView[];
  flows: RoutedFlow[];
  attachments: RoutedAttachment[];
  width: number;
  height: number;
}

export function isMainType(t: NodeType): boolean { return MAIN_TYPES.has(t); }
export function isSideType(t: NodeType): boolean { return SIDE_TYPES.has(t); }
export function isMainNode(n: DiagramNode): n is EventNode | FunctionNode | GatewayNode {
  return MAIN_TYPES.has(n.type);
}
export function isAttachedNode(n: DiagramNode): n is AttachedNode {
  return SIDE_TYPES.has(n.type);
}
