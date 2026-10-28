import {
  GRID, isAttachedNode, isMainNode, layoutDiagram, renderLayouted, SELECT_COLOR,
  addFlow, attachmentsOf, makeNode, nodeById, removeNode, canConnect,
} from '../core';
import type { Diagram, LayoutedDiagram, NodeView, NodeType, Point } from '../core';
import { autoArrange, buildViews } from '../core/layout';
import { rectsOverlap, gridRound } from '../core/geom';
import { DiagramStore } from './store';
import { mountToolbar } from './toolbar';
import { mountPalette } from './palette';
import { mountInspector } from './inspector';
import { svgEl } from '../core';

export type Tool = { kind: 'select' } | { kind: 'create'; type: NodeType; operator?: import('../core').GatewayOperator };

export interface EditorContext {
  readonly store: DiagramStore;
  readonly layouted: LayoutedDiagram;
  readonly selection: ReadonlySet<string>;
  readonly tool: Tool;
  select(id: string | null): void;
  setSelection(ids: Iterable<string>): void;
  toggleSelect(id: string): void;
  setTool(tool: Tool): void;
  copySelection(): void;
  pasteClipboard(): void;
  duplicateSelection(): void;
  autoArrange(): void;
  fitView(): void;
  zoomBy(factor: number): void;
  getZoom(): number;
  toast(message: string): void;
  requestRender(): void;
  onChange(cb: () => void): () => void;
  exportSvgElement(): SVGSVGElement | null;
}

type Gesture =
  | { type: 'none' }
  | { type: 'maybe-drag'; nodeId: string; startX: number; startY: number }
  | { type: 'drag'; offsets: Map<string, Point> }
  | { type: 'connect'; fromId: string; dir: 'in' | 'out'; to: Point }
  | { type: 'pan'; startX: number; startY: number; tx0: number; ty0: number; moved: boolean }
  | { type: 'maybe-click-create'; startX: number; startY: number }
  | { type: 'maybe-band'; start: Point; startX: number; startY: number; additive: boolean }
  | { type: 'band'; start: Point; cur: Point; additive: boolean };

interface ClipData {
  mains: Array<{ id: string; type: NodeType; label: string; operator?: string; x?: number; y?: number }>;
  attached: Array<{ id: string; type: NodeType; label: string; attachTo: string; side: 'left' | 'right'; dir?: 'in' | 'out' | 'both' }>;
  flows: Array<{ from: string; to: string }>;
}

const AUTOSAVE_KEY = 'eepc-canvas:autosave';

export class Editor implements EditorContext {
  readonly store: DiagramStore;
  layouted: LayoutedDiagram;
  selection: ReadonlySet<string> = new Set<string>();
  tool: Tool = { kind: 'select' };

  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private world: SVGGElement;
  private canvasWrap: HTMLDivElement;
  private viewport = { scale: 1, tx: 0, ty: 0 };
  private gesture: Gesture = { type: 'none' };
  private hoverNodeId: string | null = null;
  private lastPointerWorld: Point = { x: 0, y: 0 };
  private renderPending = false;
  private listeners = new Set<() => void>();
  private toastEl: HTMLDivElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private renderCount = 0;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: Array<() => void> = [];
  private clipboard: ClipData | null = null;
  private renameEl: HTMLInputElement | null = null;
  private renameId: string | null = null;

  constructor(container: HTMLElement, diagram: Diagram) {
    this.store = new DiagramStore(diagram);
    this.layouted = layoutDiagram(this.store.diagram);

    this.root = document.createElement('div');
    this.root.className = 'eepc-app';
    this.root.tabIndex = 0;
    container.appendChild(this.root);

    const header = document.createElement('header');
    header.className = 'eepc-toolbar';
    const body = document.createElement('div');
    body.className = 'eepc-body';
    const palette = document.createElement('aside');
    palette.className = 'eepc-palette';
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'eepc-canvas-wrap';
    const inspector = document.createElement('aside');
    inspector.className = 'eepc-inspector';
    this.root.append(header, body);
    body.append(palette, this.canvasWrap, inspector);

    this.svg = svgEl('svg', { class: 'eepc-canvas' }) as unknown as SVGSVGElement;
    this.canvasWrap.appendChild(this.svg);
    const defs = svgEl('defs');
    const pattern = svgEl('pattern', {
      id: 'eepc-grid-pattern', width: 20, height: 20, patternUnits: 'userSpaceOnUse',
    });
    pattern.appendChild(svgEl('path', {
      d: 'M 20 0 L 0 0 0 20', fill: 'none', stroke: '#E5E9F0', 'stroke-width': 1,
    }));
    defs.appendChild(pattern);
    this.svg.appendChild(defs);
    this.world = svgEl('g') as unknown as SVGGElement;
    this.svg.appendChild(this.world);

    this.toastEl = document.createElement('div');
    this.toastEl.className = 'eepc-toast';
    this.root.appendChild(this.toastEl);

    this.unsubs.push(this.store.subscribe(() => this.onStoreChange()));
    this.unsubs.push(mountToolbar(header, this));
    this.unsubs.push(mountPalette(palette, this));
    this.unsubs.push(mountInspector(inspector, this));

    this.bindPointer();
    this.bindKeyboard();
    this.resizeObserver(this.canvasWrap);

    this.renderScene();
    this.fitView();
    this.root.focus();
  }

  destroy(): void {
    this.closeRename(false);
    for (const u of this.unsubs) u();
    this.root.remove();
  }

  // ── EditorContext ──

  select(id: string | null): void {
    this.setSelection(id ? [id] : []);
  }

  setSelection(ids: Iterable<string>): void {
    this.selection = new Set(ids);
    this.notify();
    this.requestRender();
  }

  toggleSelect(id: string): void {
    const next = new Set(this.selection);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selection = next;
    this.notify();
    this.requestRender();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.notify();
    this.requestRender();
  }

  autoArrange(): void {
    this.store.mutate(d => { autoArrange(d); });
  }

  fitView(): void {
    const views = this.layouted.views;
    if (views.length === 0) { this.viewport = { scale: 1, tx: 0, ty: 0 }; this.updateTransform(); return; }
    const rect = this.svg.getBoundingClientRect();
    const pad = 60;
    const w = this.layouted.width, h = this.layouted.height;
    const scale = Math.min((rect.width - pad) / w, (rect.height - pad) / h, 1.5);
    this.viewport.scale = Math.max(0.15, scale);
    this.viewport.tx = (rect.width - w * this.viewport.scale) / 2;
    this.viewport.ty = (rect.height - h * this.viewport.scale) / 2;
    this.updateTransform();
  }

  zoomBy(factor: number): void {
    const rect = this.svg.getBoundingClientRect();
    this.zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  getZoom(): number { return this.viewport.scale; }

  toast(message: string): void {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('eepc-toast-visible');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl?.classList.remove('eepc-toast-visible'), 2600);
  }

  requestRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.renderScene();
    });
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  exportSvgElement(): SVGSVGElement | null {
    if (this.layouted.views.length === 0) return null;
    return renderLayouted(this.layouted, { background: '#ffffff', idPrefix: `x${++this.renderCount}` });
  }

  // ── Clipboard ──

  private collectSelection(): ClipData | null {
    const d = this.store.diagram;
    const mains: ClipData['mains'] = [];
    for (const id of this.selection) {
      const n = nodeById(d, id);
      if (n && isMainNode(n)) {
        mains.push({
          id: n.id, type: n.type, label: n.label,
          operator: n.type === 'gateway' ? n.operator : undefined,
          x: n.x, y: n.y,
        });
      }
    }
    if (mains.length === 0) return null;
    const mainSet = new Set(mains.map(m => m.id));
    const attachedMap = new Map<string, ClipData['attached'][number]>();
    for (const m of mains) {
      for (const a of attachmentsOf(d, m.id)) {
        attachedMap.set(a.id, {
          id: a.id, type: a.type, label: a.label,
          attachTo: a.attachTo, side: a.side, dir: a.dir,
        });
      }
    }
    // Explicitly selected attachments whose function is also selected.
    for (const id of this.selection) {
      const n = nodeById(d, id);
      if (n && isAttachedNode(n) && mainSet.has(n.attachTo) && !attachedMap.has(id)) {
        attachedMap.set(id, { id: n.id, type: n.type, label: n.label, attachTo: n.attachTo, side: n.side, dir: n.dir });
      }
    }
    const flows = d.flows
      .filter(f => mainSet.has(f.from) && mainSet.has(f.to))
      .map(f => ({ from: f.from, to: f.to }));
    return { mains, attached: [...attachedMap.values()], flows };
  }

  copySelection(): void {
    const clip = this.collectSelection();
    if (!clip) { this.toast('Выберите элементы для копирования'); return; }
    this.clipboard = clip;
    this.toast(`Скопировано элементов: ${clip.mains.length + clip.attached.length}`);
  }

  pasteClipboard(): void {
    this.paste({ dx: 60, dy: 60 });
  }

  duplicateSelection(): void {
    const clip = this.collectSelection();
    if (!clip) { this.toast('Выберите элементы для дублирования'); return; }
    this.clipboard = clip;
    this.paste({ dx: 40, dy: 40 });
  }

  private paste(offset: { dx: number; dy: number }): void {
    const clip = this.clipboard;
    if (!clip || clip.mains.length === 0) { this.toast('Буфер обмена пуст'); return; }
    this.store.mutate(d => {
      const idMap = new Map<string, string>();
      for (const m of clip.mains) {
        const copy = makeNode(d, m.type, m.label, {
          operator: m.type === 'gateway' ? (m.operator as import('../core').GatewayOperator) : undefined,
          x: (m.x ?? 0) + offset.dx,
          y: (m.y ?? 0) + offset.dy,
        });
        d.nodes.push(copy);
        idMap.set(m.id, copy.id);
        const free = this.findFreePosition(copy.id);
        if (free) { copy.x = free.x; copy.y = free.y; }
      }
      for (const a of clip.attached) {
        const target = idMap.get(a.attachTo);
        if (!target) continue;
        const copy = makeNode(d, a.type, a.label, {
          attachTo: target, side: a.side,
          dir: a.type === 'role' ? undefined : a.dir,
        });
        d.nodes.push(copy);
        idMap.set(a.id, copy.id);
      }
      for (const f of clip.flows) {
        const from = idMap.get(f.from);
        const to = idMap.get(f.to);
        if (from && to) addFlow(d, from, to);
      }
      this.selection = new Set([...idMap.values()]);
    });
    this.notify();
    this.requestRender();
    this.toast(`Вставлено элементов: ${clip.mains.length + clip.attached.length}`);
  }

  // ── Internals ──

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private onStoreChange(): void {
    this.layouted = layoutDiagram(this.store.diagram);
    const alive = new Set(this.store.diagram.nodes.map(n => n.id));
    const filtered = new Set([...this.selection].filter(id => alive.has(id)));
    if (filtered.size !== this.selection.size) this.selection = filtered;
    this.notify();
    this.requestRender();
    this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.store.diagram));
      } catch { /* storage may be unavailable */ }
    }, 400);
  }

  private resizeObserver(wrap: HTMLElement): void {
    const ro = new ResizeObserver(() => {
      this.svg.setAttribute('width', String(wrap.clientWidth));
      this.svg.setAttribute('height', String(wrap.clientHeight));
    });
    ro.observe(wrap);
    this.svg.setAttribute('width', String(wrap.clientWidth));
    this.svg.setAttribute('height', String(wrap.clientHeight));
  }

  private updateTransform(): void {
    const { scale, tx, ty } = this.viewport;
    this.world.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`);
  }

  private toWorld(e: PointerEvent | MouseEvent | WheelEvent): Point {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.viewport.tx) / this.viewport.scale,
      y: (e.clientY - rect.top - this.viewport.ty) / this.viewport.scale,
    };
  }

  private viewOf(id: string): NodeView | undefined {
    return this.layouted.views.find(v => v.node.id === id);
  }

  private selectedMainNodes(): string[] {
    const d = this.store.diagram;
    return [...this.selection].filter(id => {
      const n = nodeById(d, id);
      return n !== undefined && isMainNode(n);
    });
  }

  private renderScene(): void {
    this.layouted = layoutDiagram(this.store.diagram);
    this.world.innerHTML = '';
    this.world.appendChild(svgEl('rect', {
      x: -100000, y: -100000, width: 200000, height: 200000, fill: 'url(#eepc-grid-pattern)',
    }));
    const dg = renderLayouted(this.layouted, { background: 'transparent', idPrefix: `d${++this.renderCount}` });
    this.world.appendChild(dg);
    this.world.appendChild(this.buildOverlay());
    this.updateTransform();
  }

  private buildOverlay(): SVGGElement {
    const o = svgEl('g', { class: 'eepc-overlay' }) as unknown as SVGGElement;
    const drawOutline = (v: NodeView, color: string, dashed: boolean) => {
      o.appendChild(svgEl('rect', {
        x: v.x - 5, y: v.y - 5, width: v.w + 10, height: v.h + 10,
        fill: 'none', stroke: color, 'stroke-width': 1.6,
        ...(dashed ? { 'stroke-dasharray': '6 4' } : {}),
        rx: v.node.type === 'gateway' ? (v.w / 2 + 5) : 8,
      }));
    };

    for (const id of this.selection) {
      const v = this.viewOf(id);
      if (v) drawOutline(v, SELECT_COLOR, false);
    }

    // Ports for the hovered or last selected main node.
    const portNode = this.hoverNodeId ?? [...this.selection][this.selection.size - 1];
    if (portNode && this.selection.size <= 1) {
      const v = this.viewOf(portNode);
      if (v && isMainNode(v.node)) {
        const cx = v.x + v.w / 2;
        o.appendChild(svgEl('circle', {
          cx, cy: v.y, r: 6, fill: '#2563EB', stroke: '#fff', 'stroke-width': 1.5,
          'data-port': 'in', 'data-node-id': v.node.id, class: 'eepc-port',
        }));
        o.appendChild(svgEl('circle', {
          cx, cy: v.y + v.h, r: 6, fill: '#16A34A', stroke: '#fff', 'stroke-width': 1.5,
          'data-port': 'out', 'data-node-id': v.node.id, class: 'eepc-port',
        }));
      }
    }

    // Rubber band.
    if (this.gesture.type === 'band') {
      const g = this.gesture;
      o.appendChild(svgEl('rect', {
        x: Math.min(g.start.x, g.cur.x), y: Math.min(g.start.y, g.cur.y),
        width: Math.abs(g.cur.x - g.start.x), height: Math.abs(g.cur.y - g.start.y),
        class: 'eepc-band', 'pointer-events': 'none',
      }));
    }

    // Connection feedback.
    if (this.gesture.type === 'connect') {
      const target = this.hoverNodeId && this.hoverNodeId !== this.gesture.fromId
        ? this.viewOf(this.hoverNodeId) : undefined;
      let valid = false;
      if (target) {
        const check = this.gesture.dir === 'out'
          ? canConnect(this.store.diagram, this.gesture.fromId, target.node.id)
          : canConnect(this.store.diagram, target.node.id, this.gesture.fromId);
        valid = check.ok;
        drawOutline(target, valid ? '#16A34A' : '#DC2626', true);
      }
      const from = this.viewOf(this.gesture.fromId);
      if (from) {
        const start = this.gesture.dir === 'out'
          ? { x: from.x + from.w / 2, y: from.y + from.h }
          : { x: from.x + from.w / 2, y: from.y };
        o.appendChild(svgEl('path', {
          d: `M${start.x},${start.y} L${this.gesture.to.x},${this.gesture.to.y}`,
          stroke: valid ? '#16A34A' : '#6B7280', 'stroke-width': 1.6,
          'stroke-dasharray': '6 5', fill: 'none', 'pointer-events': 'none',
        }));
      }
    }

    // Ghost for the creation tool.
    if (this.tool.kind === 'create' && this.gesture.type !== 'connect') {
      const gw = this.tool.type === 'gateway';
      const w = gw ? 60 : 200, h = gw ? 60 : 80;
      const x = gridRound(this.lastPointerWorld.x - w / 2);
      const y = gridRound(this.lastPointerWorld.y - h / 2);
      o.appendChild(svgEl(gw ? 'circle' : 'rect', gw
        ? { cx: x + w / 2, cy: y + h / 2, r: w / 2, fill: 'rgba(37,99,235,0.12)', stroke: '#2563EB', 'stroke-dasharray': '5 4' }
        : { x, y, width: w, height: h, rx: 12, fill: 'rgba(37,99,235,0.12)', stroke: '#2563EB', 'stroke-dasharray': '5 4' }));
    }
    return o;
  }

  // ── Inline rename ──

  private startInlineRename(id: string): void {
    const v = this.viewOf(id);
    if (!v) return;
    if (v.node.type === 'gateway') return; // operator is edited in the inspector
    this.closeRename(false);
    const { scale, tx, ty } = this.viewport;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'eepc-inline-input';
    input.value = v.node.label;
    input.style.left = `${v.x * scale + tx}px`;
    input.style.top = `${v.y * scale + ty}px`;
    input.style.width = `${v.w * scale}px`;
    input.style.height = `${v.h * scale}px`;
    input.style.fontSize = `${Math.max(11, 13 * scale)}px`;
    this.renameEl = input;
    this.renameId = id;
    this.canvasWrap.appendChild(input);
    input.focus();
    input.select();
    const commit = () => this.closeRename(true);
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      if (ev.key === 'Escape') { ev.preventDefault(); this.closeRename(false); }
      ev.stopPropagation();
    });
    input.addEventListener('blur', commit);
  }

  private closeRename(apply: boolean): void {
    const input = this.renameEl;
    const id = this.renameId;
    this.renameEl = null;
    this.renameId = null;
    if (!input || !id) return;
    const value = input.value.trim();
    input.remove();
    if (apply) {
      this.store.mutate(d => {
        const n = nodeById(d, id);
        if (n) n.label = value;
      });
    }
    this.root.focus();
  }

  // ── Pointer gestures ──

  private bindPointer(): void {
    const svg = this.svg;

    svg.addEventListener('contextmenu', e => e.preventDefault());

    svg.addEventListener('pointerdown', (e: PointerEvent) => {
      this.root.focus();
      try { svg.setPointerCapture(e.pointerId); } catch { /* inactive pointer (synthetic events) */ }
      const target = e.target as Element;
      const world = this.toWorld(e);
      this.lastPointerWorld = world;

      // Right and middle buttons always pan the canvas.
      if (e.button === 1 || e.button === 2) {
        this.gesture = { type: 'pan', startX: e.clientX, startY: e.clientY, tx0: this.viewport.tx, ty0: this.viewport.ty, moved: false };
        return;
      }
      if (e.button !== 0) return;

      const portEl = target.closest?.('[data-port]') as SVGElement | null;
      if (portEl) {
        const nodeId = portEl.getAttribute('data-node-id')!;
        const dir = portEl.getAttribute('data-port') as 'in' | 'out';
        this.gesture = { type: 'connect', fromId: nodeId, dir, to: world };
        this.requestRender();
        return;
      }

      if (this.tool.kind === 'create') {
        this.gesture = { type: 'maybe-click-create', startX: e.clientX, startY: e.clientY };
        return;
      }

      const nodeEl = target.closest?.('[data-node-id]') as SVGElement | null;
      if (nodeEl) {
        const nodeId = nodeEl.getAttribute('data-node-id')!;
        if (e.shiftKey) this.toggleSelect(nodeId);
        else if (!this.selection.has(nodeId)) this.select(nodeId);
        const v = this.viewOf(nodeId);
        if (v && isMainNode(v.node)) {
          this.gesture = { type: 'maybe-drag', nodeId, startX: e.clientX, startY: e.clientY };
        }
        return;
      }

      this.gesture = { type: 'maybe-band', start: world, startX: e.clientX, startY: e.clientY, additive: e.shiftKey };
    });

    svg.addEventListener('pointermove', (e: PointerEvent) => {
      const world = this.toWorld(e);
      this.lastPointerWorld = world;
      const nodeEl = (e.target as Element).closest?.('[data-node-id]') as SVGElement | null;
      const newHover = nodeEl?.getAttribute('data-node-id') ?? null;
      const hoverChanged = newHover !== this.hoverNodeId;
      this.hoverNodeId = newHover;

      const g = this.gesture;
      if (g.type === 'maybe-drag' && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 4) {
        this.store.beginBatch();
        const offsets = new Map<string, Point>();
        for (const id of this.selectedMainNodes()) {
          const v = this.viewOf(id);
          if (v) offsets.set(id, { x: world.x - v.x, y: world.y - v.y });
        }
        if (offsets.size === 0) { const v = this.viewOf(g.nodeId); if (v) offsets.set(g.nodeId, { x: world.x - v.x, y: world.y - v.y }); }
        this.gesture = { type: 'drag', offsets };
        this.requestRender();
        return;
      }
      if (g.type === 'drag') {
        for (const [id, off] of g.offsets) {
          const node = this.store.diagram.nodes.find(n => n.id === id);
          if (node && isMainNode(node)) {
            node.x = gridRound(world.x - off.x);
            node.y = gridRound(world.y - off.y);
          }
        }
        this.store.mutate(() => { /* positions already written */ }, { history: false });
        return;
      }
      if (g.type === 'connect') {
        g.to = world;
        this.requestRender();
        return;
      }
      if (g.type === 'pan') {
        const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
        if (g.moved || Math.hypot(dx, dy) > 3) {
          g.moved = true;
          this.viewport.tx = g.tx0 + dx;
          this.viewport.ty = g.ty0 + dy;
          this.updateTransform();
        }
        return;
      }
      if (g.type === 'maybe-band' && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 4) {
        this.gesture = { type: 'band', start: g.start, cur: world, additive: g.additive };
        return;
      }
      if (g.type === 'band') {
        g.cur = world;
        this.requestRender();
        return;
      }
      if (hoverChanged) this.requestRender();
    });

    svg.addEventListener('pointerup', (e: PointerEvent) => {
      const g = this.gesture;
      this.gesture = { type: 'none' };
      const world = this.toWorld(e);
      const nodeEl = (e.target as Element).closest?.('[data-node-id]') as SVGElement | null;
      const targetId = nodeEl?.getAttribute('data-node-id') ?? null;

      if (g.type === 'connect' && targetId && targetId !== g.fromId) {
        const [from, to] = g.dir === 'out' ? [g.fromId, targetId] : [targetId, g.fromId];
        const check = canConnect(this.store.diagram, from, to);
        if (check.ok) {
          this.store.mutate(d => { addFlow(d, from, to); });
        } else {
          this.toast(check.reason);
        }
      } else if (g.type === 'drag') {
        // Drop: push overlapping nodes to free cells, one history batch already open.
        for (const id of g.offsets.keys()) {
          const free = this.findFreePosition(id);
          const node = this.store.diagram.nodes.find(n => n.id === id);
          if (node && isMainNode(node) && free) {
            node.x = free.x;
            node.y = free.y;
          }
        }
        this.store.mutate(() => { /* positions already written */ }, { history: false });
      } else if (g.type === 'maybe-click-create') {
        this.handleCreateClick(world, targetId);
      } else if (g.type === 'maybe-band') {
        if (!g.additive) this.select(null);
      } else if (g.type === 'band') {
        const rect = {
          x: Math.min(g.start.x, g.cur.x), y: Math.min(g.start.y, g.cur.y),
          w: Math.abs(g.cur.x - g.start.x), h: Math.abs(g.cur.y - g.start.y),
        };
        const hits = this.layouted.views
          .filter(v => isMainNode(v.node) &&
            rectsOverlap(rect, { x: v.x, y: v.y, w: v.w, h: v.h }))
          .map(v => v.node.id);
        const next = g.additive ? new Set([...this.selection, ...hits]) : new Set(hits);
        this.selection = next;
        this.notify();
        this.requestRender();
        if (next.size > 0) this.toast(`Выбрано: ${next.size}`);
      }
      this.requestRender();
    });

    svg.addEventListener('pointerleave', () => {
      if (this.hoverNodeId !== null) {
        this.hoverNodeId = null;
        this.requestRender();
      }
    });

    svg.addEventListener('dblclick', (e: MouseEvent) => {
      const nodeEl = (e.target as Element).closest?.('[data-node-id]') as SVGElement | null;
      if (nodeEl) {
        const id = nodeEl.getAttribute('data-node-id')!;
        this.select(id);
        this.startInlineRename(id);
      }
    });

    svg.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const rect = this.svg.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive: false });
  }

  private zoomAt(cx: number, cy: number, factor: number): void {
    const v = this.viewport;
    const newScale = Math.min(2.5, Math.max(0.15, v.scale * factor));
    const k = newScale / v.scale;
    v.tx = cx - (cx - v.tx) * k;
    v.ty = cy - (cy - v.ty) * k;
    v.scale = newScale;
    this.updateTransform();
    this.notify();
  }

  private handleCreateClick(world: Point, targetId: string | null): void {
    if (this.tool.kind !== 'create') return;
    const type = this.tool.type;
    const operator = this.tool.operator;
    const side = type === 'role' || type === 'document' || type === 'system';
    if (side) {
      const target = this.store.diagram.nodes.find(n => n.id === targetId);
      if (!target || target.type !== 'function') {
        this.toast('Роль, документ и систему привязывают к функции — кликните по функции');
        return;
      }
      this.store.mutate(d => {
        const n = makeNode(d, type, defaultLabel(type), {
          attachTo: target.id,
          side: type === 'document' ? 'left' : 'right',
          dir: type === 'role' ? undefined : 'in',
        });
        d.nodes.push(n);
        this.select(n.id);
        this.startInlineRename(n.id);
      });
    } else {
      this.store.mutate(d => {
        const n = makeNode(d, type, defaultLabel(type), { operator, x: 0, y: 0 });
        d.nodes.push(n);
        const pos = this.findFreePosition(n.id, world);
        if (pos) { n.x = pos.x; n.y = pos.y; }
        this.select(n.id);
        if (type !== 'gateway') this.startInlineRename(n.id);
      });
    }
    this.setTool({ kind: 'select' });
  }

  /** Nearest grid position where the node (and its attachments) overlap nothing. */
  private findFreePosition(nodeId: string, want?: Point): Point | null {
    const d = this.store.diagram;
    const node = d.nodes.find(n => n.id === nodeId);
    if (!node || !isMainNode(node)) return null;
    const views = buildViews(d);
    const moving = views.find(v => v.node.id === nodeId);
    if (!moving) return null;
    const start = {
      x: gridRound(want ? want.x - moving.w / 2 : moving.x),
      y: gridRound(want ? want.y - moving.h / 2 : moving.y),
    };
    const obstacles = views
      .filter(v => v.node.id !== nodeId && !(isAttachedNode(v.node) && v.node.attachTo === nodeId))
      .map(v => ({ x: v.x, y: v.y, w: v.w, h: v.h }));
    const fits = (p: Point) => !obstacles.some(o =>
      rectsOverlap({ x: p.x, y: p.y, w: moving.w, h: moving.h }, o));
    if (fits(start)) return start;
    for (let r = 1; r <= 30; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of Math.abs(dx) === r ? range(-r, r) : [-(r), r]) {
          const p = { x: start.x + dx * GRID, y: start.y + dy * GRID };
          if (fits(p)) return p;
        }
      }
    }
    return null;
  }

  private bindKeyboard(): void {
    // Window-level so shortcuts work regardless of what is focused
    // (right after startup, after toolbar clicks, etc.).
    const onKeydown = (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement)?.matches?.('input, textarea, select');
      if (inInput) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.store.redo(); else this.store.undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.store.redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.duplicateSelection();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this.copySelection();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pasteClipboard();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.setSelection(this.store.diagram.nodes.filter(isMainNode).map(n => n.id));
        return;
      }
      if (e.key === 'Escape') {
        if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
        else this.select(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.size > 0) {
        e.preventDefault();
        const ids = [...this.selection];
        this.store.mutate(d => {
          for (const id of ids) removeNode(d, id);
        });
        return;
      }
      if (this.selection.size > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 3 : GRID;
        const ids = this.selectedMainNodes();
        this.store.mutate(d => {
          for (const id of ids) {
            const n = d.nodes.find(m => m.id === id);
            if (n && isMainNode(n)) {
              const x = n.x ?? 0, y = n.y ?? 0;
              if (e.key === 'ArrowUp') n.y = y - step;
              if (e.key === 'ArrowDown') n.y = y + step;
              if (e.key === 'ArrowLeft') n.x = x - step;
              if (e.key === 'ArrowRight') n.x = x + step;
            }
          }
        });
      }
    };
    window.addEventListener('keydown', onKeydown);
    this.unsubs.push(() => window.removeEventListener('keydown', onKeydown));
  }
}

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function defaultLabel(type: NodeType): string {
  switch (type) {
    case 'event': return 'Новое событие';
    case 'function': return 'Выполнить действие';
    case 'gateway': return '';
    case 'role': return 'Новая роль';
    case 'document': return 'Новый документ';
    case 'system': return 'Новая система';
  }
}

/** Mount the full editor into a container element. */
export function mountEditor(container: HTMLElement, diagram: Diagram): Editor {
  return new Editor(container, diagram);
}
