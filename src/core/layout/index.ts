import { GATEWAY_D, GRID, NODE_H, PADDING } from '../constants';
import { rectsOverlap } from '../geom';
import type { Diagram, LayoutedDiagram, NodeView } from '../types';
import { isAttachedNode, isMainNode } from '../types';
import { fitNodeText } from '../text';
import { bboxOf } from '../geom';
import { computeAutoLayout, placeAttachments } from './layered';
import { routeDiagram } from './router';

/** Build views from stored manual positions of main nodes. */
export function buildViews(d: Diagram): NodeView[] {
  const mainViews: NodeView[] = [];
  for (const n of d.nodes) {
    if (!isMainNode(n)) continue;
    const fit = fitNodeText(n.type, n.label);
    const isGw = n.type === 'gateway';
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    mainViews.push({
      node: n, x, y,
      w: isGw ? GATEWAY_D : fit.w,
      h: isGw ? GATEWAY_D : NODE_H,
      lines: fit.lines, font: fit.font, lineH: fit.lineH,
    });
  }
  const viewOf = new Map(mainViews.map(v => [v.node.id, v]));
  return [...mainViews, ...placeAttachments(d, viewOf)];
}

function viewRect(v: NodeView) { return { x: v.x, y: v.y, w: v.w, h: v.h }; }

/**
 * Push overlapping nodes apart. Only main nodes move; attachments follow
 * their functions. Bounded, best-effort — the editor normally prevents
 * overlaps at drop time.
 */
export function resolveCollisions(d: Diagram, views: NodeView[]): NodeView[] {
  let current = views;
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 0; i < current.length && !moved; i++) {
      for (let j = i + 1; j < current.length && !moved; j++) {
        const a = current[i], b = current[j];
        if (!rectsOverlap(viewRect(a), viewRect(b))) continue;
        // Choose the movable element: attachments move via their function.
        const moveId = pickMovable(a, b);
        if (!moveId) { moved = true; break; } // both immovable: give up on this pair
        const target = current.find(v => v.node.id === moveId)!;
        target.y += GRID;
        moved = true;
      }
      if (moved) break;
    }
    if (!moved) break;
    // Rebuild attachment views after movement.
    const mainViews = current.filter(v => isMainNode(v.node));
    const viewOf = new Map(mainViews.map(v => [v.node.id, v]));
    current = [...mainViews, ...placeAttachments(d, viewOf)];
  }
  return current;
}

function pickMovable(a: NodeView, b: NodeView): string | null {
  const idOf = (v: NodeView): string | null =>
    isAttachedNode(v.node) ? (v.node.attachTo || null) : v.node.id;
  const ai = idOf(a), bi = idOf(b);
  if (ai && bi && ai !== bi) return a.y >= b.y ? ai : bi;
  if (ai && ai !== bi) return ai;
  if (bi && bi !== ai) return bi;
  return null;
}

/** Write computed coordinates of main nodes back into the diagram. */
function syncPositions(d: Diagram, views: NodeView[]): void {
  const viewOf = new Map(views.map(v => [v.node.id, v]));
  for (const n of d.nodes) {
    if (!isMainNode(n)) continue;
    const v = viewOf.get(n.id);
    if (v) { n.x = v.x; n.y = v.y; }
  }
}

function finalize(d: Diagram, views: NodeView[]): LayoutedDiagram {
  const current = resolveCollisions(d, views);
  const { flows, attachments } = routeDiagram(d, current);
  syncPositions(d, current);
  const pts: Array<{ x: number; y: number; w: number; h: number }> = current.map(viewRect);
  for (const f of flows) {
    for (const p of f.points) pts.push({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 });
  }
  for (const at of attachments) {
    for (const p of at.points) pts.push({ x: p.x - 2, y: p.y - 2, w: 4, h: 4 });
  }
  const bb = bboxOf(pts);
  return {
    diagram: d,
    views: current,
    flows,
    attachments,
    width: bb.x + bb.w + PADDING,
    height: bb.y + bb.h + PADDING,
  };
}

/** Full auto-arrange: layered layout + routing; positions are written back. */
export function autoArrange(d: Diagram): LayoutedDiagram {
  const res = computeAutoLayout(d);
  return finalize(d, res.views);
}

/**
 * Layout honouring manually stored positions. If any main node has no
 * position yet, the whole diagram falls back to auto-arrange.
 */
export function layoutDiagram(d: Diagram): LayoutedDiagram {
  const main = d.nodes.filter(isMainNode);
  if (main.length === 0) {
    return { diagram: d, views: [], flows: [], attachments: [], width: PADDING * 2, height: PADDING * 2 };
  }
  const anyMissing = main.some(n => n.x === undefined || n.y === undefined);
  if (anyMissing) return autoArrange(d);
  return finalize(d, buildViews(d));
}
