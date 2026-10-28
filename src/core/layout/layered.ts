import { GATEWAY_D, H_GAP, NODE_H, PADDING, SIDE_GAP, SIDE_V_GAP, V_GAP } from '../constants';
import { gridRound } from '../geom';
import type { AttachedNode, Diagram, NodeView, NodeType } from '../types';
import { isAttachedNode, isMainNode } from '../types';
import { fitNodeText } from '../text';

export interface AutoLayoutResult {
  views: NodeView[];
  width: number;
  height: number;
}

interface ONode {
  key: string;          // real node id or virtual `__v{n}`
  layer: number;
  virtual: boolean;
  realId?: string;
}

/**
 * Layered top-down layout (Sugiyama-lite):
 * cycle removal → longest-path layering → virtual nodes for long edges →
 * barycenter ordering sweeps → spine alignment → grid coordinates with
 * reserved bands for attached roles/documents/systems.
 *
 * Aesthetic contract:
 *  - every layer's main row is anchored to the top of its band, so arrow
 *    lengths between neighbour layers stay uniform;
 *  - attachment stacks hang DOWN from their function; the first attachment
 *    always sits in the function's own row;
 *  - chains are aligned vertically onto their predecessor's center whenever
 *    neighbour gaps allow, so straight lines stay straight.
 */
export function computeAutoLayout(d: Diagram): AutoLayoutResult {
  const mainEls = d.nodes.filter(isMainNode);
  if (mainEls.length === 0) {
    return { views: [], width: PADDING * 2, height: PADDING * 2 };
  }

  const ids = mainEls.map(n => n.id);
  const idSet = new Set(ids);

  // ── Graph edges between main nodes ──
  const allEdges: Array<[string, string]> = [];
  for (const f of d.flows) {
    if (idSet.has(f.from) && idSet.has(f.to)) allEdges.push([f.from, f.to]);
  }

  // ── Cycle removal: iterative DFS, back edges are excluded from the DAG ──
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const [a, b] of allEdges) adj.get(a)!.push(b);

  const backEdges = new Set<string>();
  const color = new Map<string, 0 | 1 | 2>(); // 0 white, 1 gray, 2 black
  for (const id of ids) color.set(id, 0);
  for (const start of ids) {
    if (color.get(start) !== 0) continue;
    const stack: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    color.set(start, 1);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const outs = adj.get(top.id) ?? [];
      if (top.i < outs.length) {
        const next = outs[top.i++];
        const c = color.get(next)!;
        if (c === 1) backEdges.add(`${top.id}->${next}`);
        else if (c === 0) {
          color.set(next, 1);
          stack.push({ id: next, i: 0 });
        }
      } else {
        color.set(top.id, 2);
        stack.pop();
      }
    }
  }
  const dagEdges = allEdges.filter(([a, b]) => !backEdges.has(`${a}->${b}`));

  // ── Longest-path layering (Kahn) ──
  const dagSucc = new Map<string, string[]>();
  const dagPred = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) { dagSucc.set(id, []); dagPred.set(id, []); indeg.set(id, 0); }
  for (const [a, b] of dagEdges) {
    dagSucc.get(a)!.push(b);
    dagPred.get(b)!.push(a);
    indeg.set(b, (indeg.get(b) ?? 0) + 1);
  }
  const layer = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids) if ((indeg.get(id) ?? 0) === 0) { layer.set(id, 0); queue.push(id); }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const to of dagSucc.get(id)!) {
      const proposed = (layer.get(id) ?? 0) + 1;
      if ((layer.get(to) ?? -1) < proposed) layer.set(to, proposed);
      const deg = (indeg.get(to) ?? 0) - 1;
      indeg.set(to, deg);
      if (deg === 0) queue.push(to);
    }
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
  const numLayers = Math.max(...ids.map(id => layer.get(id)!)) + 1;

  // ── Virtual nodes for edges spanning several layers ──
  const onodes: ONode[] = [];
  for (const id of ids) onodes.push({ key: id, layer: layer.get(id)!, virtual: false, realId: id });
  const orderEdges: Array<[string, string]> = [];
  let vCounter = 0;
  for (const [a, b] of dagEdges) {
    const la = layer.get(a)!, lb = layer.get(b)!;
    let prev = a;
    for (let l = la + 1; l < lb; l++) {
      const key = `__v${vCounter++}`;
      onodes.push({ key, layer: l, virtual: true });
      orderEdges.push([prev, key]);
      prev = key;
    }
    orderEdges.push([prev, b]);
  }

  const layerList: ONode[][] = Array.from({ length: numLayers }, () => []);
  for (const n of onodes) layerList[n.layer].push(n);
  for (const list of layerList) list.sort((a, b) => (a.realId ?? a.key).localeCompare(b.realId ?? b.key, 'en'));

  const down = new Map<string, string[]>();
  const up = new Map<string, string[]>();
  for (const n of onodes) { down.set(n.key, []); up.set(n.key, []); }
  for (const [a, b] of orderEdges) { down.get(a)!.push(b); up.get(b)!.push(a); }

  const positionIn = (list: ONode[], key: string): number =>
    list.findIndex(n => n.key === key);

  const barySweep = (l: number, dir: 'down' | 'up') => {
    const list = layerList[l];
    const scored = list.map((n, i) => {
      const nbrs = dir === 'down' ? up.get(n.key)! : down.get(n.key)!;
      const other = dir === 'down' ? layerList[l - 1] : layerList[l + 1];
      let bary: number;
      if (nbrs.length === 0 || !other) bary = i;
      else {
        let sum = 0;
        for (const nb of nbrs) sum += positionIn(other, nb);
        bary = sum / nbrs.length;
      }
      return { n, bary, i };
    });
    scored.sort((a, b) => a.bary - b.bary || a.i - b.i);
    layerList[l] = scored.map(s => s.n);
  };

  const countCrossings = (): number => {
    let total = 0;
    for (let l = 0; l < numLayers - 1; l++) {
      const A = layerList[l], B = layerList[l + 1];
      const pairs: Array<[number, number]> = [];
      for (const a of A) {
        for (const b of down.get(a.key)!) pairs.push([positionIn(A, a.key), positionIn(B, b)]);
      }
      for (let i = 0; i < pairs.length; i++) {
        for (let j = i + 1; j < pairs.length; j++) {
          if ((pairs[i][0] < pairs[j][0] && pairs[i][1] > pairs[j][1]) ||
              (pairs[i][0] > pairs[j][0] && pairs[i][1] < pairs[j][1])) total++;
        }
      }
    }
    return total;
  };

  let best = layerList.map(l => [...l]);
  let bestCross = countCrossings();
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let l = 1; l < numLayers; l++) barySweep(l, 'down');
    for (let l = numLayers - 2; l >= 0; l--) barySweep(l, 'up');
    const cross = countCrossings();
    if (cross < bestCross) { bestCross = cross; best = layerList.map(l => [...l]); }
  }
  for (let l = 0; l < numLayers; l++) layerList[l] = best[l];

  // ── Attachments per function ──
  const { leftOf, rightOf } = attachmentLists(d);

  const fitOf = new Map<string, ReturnType<typeof fitNodeText>>();
  const getFit = (id: string, type: NodeType, label: string) => {
    if (!fitOf.has(id)) fitOf.set(id, fitNodeText(type, label));
    return fitOf.get(id)!;
  };
  const typeOf = (id: string): NodeType =>
    (d.nodes.find(n => n.id === id)?.type ?? 'event') as NodeType;
  const labelOfNode = (id: string): string => d.nodes.find(n => n.id === id)?.label ?? '';

  const sideStackWidth = (fid: string, side: 'left' | 'right'): number => {
    const list = (side === 'left' ? leftOf : rightOf).get(fid) ?? [];
    if (list.length === 0) return 0;
    const maxW = Math.max(...list.map(a => getFit(a.id, a.type, a.label).w));
    return maxW + SIDE_GAP;
  };

  // ── X coordinates: per-layer packing, centered ──
  const xOf = new Map<string, number>();
  const layerWidths: number[] = [];
  for (let l = 0; l < numLayers; l++) {
    let cursor = 0;
    for (const n of layerList[l]) {
      if (n.virtual) { xOf.set(n.key, cursor); continue; }
      const fit = getFit(n.realId!, typeOf(n.realId!), labelOfNode(n.realId!));
      const w = n.realId && typeOf(n.realId!) === 'gateway' ? GATEWAY_D : fit.w;
      const isFunc = n.realId !== undefined && typeOf(n.realId!) === 'function';
      const leftW = isFunc ? sideStackWidth(n.realId!, 'left') : 0;
      const rightW = isFunc ? sideStackWidth(n.realId!, 'right') : 0;
      xOf.set(n.key, cursor + leftW);
      cursor = cursor + leftW + w + rightW + H_GAP;
    }
    layerWidths.push(Math.max(0, cursor - H_GAP));
  }
  const maxWidth = Math.max(...layerWidths);
  const layerOffset = layerWidths.map(w => gridRound((maxWidth - w) / 2));
  for (const n of onodes) {
    if (n.virtual) continue;
    xOf.set(n.key, PADDING + layerOffset[n.layer] + xOf.get(n.key)!);
  }

  // ── Spine alignment: pull chains onto their predecessor's center ──
  const nodeW = (id: string): number =>
    typeOf(id) === 'gateway' ? GATEWAY_D : getFit(id, typeOf(id), labelOfNode(id)).w;

  for (let sweep = 0; sweep < 2; sweep++) {
    for (let l = 1; l < numLayers; l++) {
      const cells = layerList[l].filter(n => !n.virtual).map(n => {
        const id = n.realId!;
        const isFunc = typeOf(id) === 'function';
        return {
          key: n.key,
          id,
          x: xOf.get(n.key)!,
          w: nodeW(id),
          leftW: isFunc ? sideStackWidth(id, 'left') : 0,
          rightW: isFunc ? sideStackWidth(id, 'right') : 0,
        };
      });
      for (let idx = 0; idx < cells.length; idx++) {
        const cell = cells[idx];
        const preds = (dagPred.get(cell.id) ?? []).filter(p => xOf.has(p));
        if (preds.length === 0) continue;
        const predCxs = preds.map(p => xOf.get(p)! + nodeW(p) / 2).sort((a, b) => a - b);
        const desired = predCxs.length === 1 ? predCxs[0] : predCxs[Math.floor(predCxs.length / 2)];
        const current = cell.x + cell.w / 2;
        if (Math.abs(desired - current) < 1) continue;
        // Clamp so neighbour cells (with their attachment reservations) keep H_GAP.
        const minX = idx > 0
          ? cells[idx - 1].x + cells[idx - 1].w + cells[idx - 1].rightW + H_GAP + cell.leftW
          : -Infinity;
        const maxX = idx < cells.length - 1
          ? cells[idx + 1].x - cells[idx + 1].leftW - H_GAP - cell.rightW - cell.w
          : Infinity;
        const target = Math.min(Math.max(cell.x + (desired - current), minX), maxX);
        const shift = gridRound(target - cell.x);
        if (shift !== 0) {
          cell.x += shift;
          xOf.set(cell.key, cell.x);
        }
      }
    }
  }

  // ── Y bands: every main row is anchored to the band top; stacks hang down ──
  const bandExtra = (l: number): number => {
    let maxStack = 1;
    for (const n of layerList[l]) {
      if (!n.realId || typeOf(n.realId!) !== 'function') continue;
      const stack = Math.max((leftOf.get(n.realId) ?? []).length, (rightOf.get(n.realId) ?? []).length);
      maxStack = Math.max(maxStack, stack);
    }
    return (maxStack - 1) * (NODE_H + SIDE_V_GAP);
  };
  const bandH: number[] = [];
  const layerY: number[] = [];
  let y = PADDING;
  for (let l = 0; l < numLayers; l++) {
    const h = NODE_H + bandExtra(l);
    bandH.push(h);
    layerY.push(y);
    y += h + V_GAP;
  }

  // ── Views for main nodes ──
  const views: NodeView[] = [];
  for (const n of onodes) {
    if (n.virtual) continue;
    const node = d.nodes.find(m => m.id === n.realId)!;
    const fit = getFit(node.id, node.type, node.label);
    const isGw = node.type === 'gateway';
    const h = isGw ? GATEWAY_D : NODE_H;
    const yy = isGw ? layerY[n.layer] + (NODE_H - GATEWAY_D) / 2 : layerY[n.layer];
    const xx = gridRound(xOf.get(n.key)!);
    views.push({
      node, x: xx, y: yy, w: isGw ? GATEWAY_D : fit.w, h,
      lines: fit.lines, font: fit.font, lineH: fit.lineH,
    });
  }

  // ── Views for attached elements, stacked downward from their function ──
  const viewOf = new Map(views.map(v => [v.node.id, v]));
  const attachViews = placeAttachments(d, viewOf);

  const all = [...views, ...attachViews];
  const width = Math.max(...all.map(v => v.x + v.w)) + PADDING;
  const height = layerY[numLayers - 1] + bandH[numLayers - 1] + PADDING;
  return { views: all, width: gridRound(width), height: gridRound(height) };
}

/** Left/right attachment lists per function id. */
export function attachmentLists(d: Diagram): {
  leftOf: Map<string, AttachedNode[]>;
  rightOf: Map<string, AttachedNode[]>;
} {
  const leftOf = new Map<string, AttachedNode[]>();
  const rightOf = new Map<string, AttachedNode[]>();
  for (const n of d.nodes) {
    if (!isAttachedNode(n)) continue;
    const map = n.side === 'left' ? leftOf : rightOf;
    if (!map.has(n.attachTo)) map.set(n.attachTo, []);
    map.get(n.attachTo)!.push(n);
  }
  return { leftOf, rightOf };
}

/** Place attached roles/documents/systems in a stack below the function;
 *  the first attachment always shares the function's row. */
export function placeAttachments(d: Diagram, viewOf: Map<string, NodeView>): NodeView[] {
  const { leftOf, rightOf } = attachmentLists(d);
  const out: NodeView[] = [];
  const pitch = NODE_H + SIDE_V_GAP;
  const emit = (fid: string, list: AttachedNode[], isLeft: boolean) => {
    const fv = viewOf.get(fid);
    if (!fv) return;
    list.forEach((a, i) => {
      const fit = fitNodeText(a.type, a.label);
      const yy = gridRound(fv.y + i * pitch);
      const xx = isLeft ? fv.x - SIDE_GAP - fit.w : fv.x + fv.w + SIDE_GAP;
      out.push({
        node: a, x: xx, y: yy, w: fit.w, h: NODE_H,
        lines: fit.lines, font: fit.font, lineH: fit.lineH,
      });
    });
  };
  for (const [fid, list] of leftOf) emit(fid, list, true);
  for (const [fid, list] of rightOf) emit(fid, list, false);
  return out;
}
