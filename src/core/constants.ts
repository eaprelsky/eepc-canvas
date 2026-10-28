import type { NodeType } from './types';

/** Grid step in px. Every coordinate and size in a layout is a multiple of this. */
export const GRID = 10;

/** Uniform height of events/functions/roles/documents/systems (guide: equal heights).
 *  Must keep node centers on the 10 px grid, so GATEWAY_D/2 stays a grid multiple. */
export const NODE_H = 80;

/** Diameter of a branch point circle (guide: neither too small nor too large). */
export const GATEWAY_D = 60;

/** Horizontal padding between the shape border and the label, per node type. */
export interface PadPair { l: number; r: number }
export const PAD: Record<NodeType, PadPair> = {
  event: { l: 46, r: 46 },    // hexagon corners are cut on both sides
  function: { l: 20, r: 20 },
  gateway: { l: 0, r: 0 },    // no label inside
  role: { l: 46, r: 22 },     // vertical stripe on the left
  document: { l: 20, r: 20 },
  system: { l: 27, r: 27 },   // double side borders
};

/** Minimum node width per type; widths step by 20 px from these. */
export const MIN_W: Record<NodeType, number> = {
  event: 180,
  function: 180,
  gateway: GATEWAY_D,
  role: 180,
  document: 180,
  system: 180,
};

/** Maximum node width; wider means the label should be shortened instead. */
export const MAX_W = 360;

export const FONT = 13;
export const FONT_SMALL = 11;
export const LINE_H = 16;
export const LINE_H_SMALL = 13;
export const MAX_LINES = 3;
export const MAX_LINES_SMALL = 4;

/** Vertical gap between layers (also the routing channel for edges). */
export const V_GAP = 100;

/** Horizontal gap between neighbour cells inside one layer. */
export const H_GAP = 60;

/** Horizontal gap between a function and its attached role/document/system. */
export const SIDE_GAP = 60;

/** Vertical gap between stacked attachments of one function (pitch = NODE_H + this). */
export const SIDE_V_GAP = 20;

/** Canvas padding around the diagram. */
export const PADDING = 40;

/** Routing keeps edge segments at least this far from node borders. */
export const CLEARANCE = 6;

/** Extra discouraged ring around nodes for the router. */
export const SOFT_CLEARANCE = 16;

/** Orthogonal segments shorter than this look like steps and are eliminated. */
export const MIN_SEGMENT = 20;

/** Arrow tip length/width for rendered markers. */
export const ARROW = 9;

export type ColorSet = { fill: string; stroke: string; text: string };

export const COLORS: Record<NodeType, ColorSet> = {
  event:    { fill: '#F7CDBD', stroke: '#B34A26', text: '#4A1D0C' },
  function: { fill: '#C4DE9C', stroke: '#4A731B', text: '#243D08' },
  gateway:  { fill: '#E3F0FA', stroke: '#4B7BA8', text: '#2C5F8A' },
  role:     { fill: '#FFF3C2', stroke: '#B7A000', text: '#5C5000' },
  document: { fill: '#DCEBFD', stroke: '#3B82F6', text: '#12295C' },
  system:   { fill: '#E0F2FE', stroke: '#0E8FC9', text: '#0B4A66' },
};

export const EDGE_COLOR = '#5B6472';
export const ATTACH_COLOR = '#8A94A3';
export const SELECT_COLOR = '#2563EB';
