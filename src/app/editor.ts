import {
  GRID, isAttachedNode, isMainNode, layoutDiagram, renderLayouted, SELECT_COLOR,
  addFlow, makeNode, removeNode, canConnect, svgEl,
} from '../core';
import type { Diagram, GatewayOperator, LayoutedDiagram, NodeView, NodeType, Point } from '../core';
import { autoArrange, buildViews } from '../core/layout';
import { rectsOverlap, gridRound } from '../core/geom';
import { DiagramStore } from './store';
import { mountToolbar } from './toolbar';
import { mountPalette } from './palette';
import { mountInspector } from './inspector';

export type Tool =
  | { kind: 'select' }
  | { kind: 'create'; type: NodeType; operator?: GatewayOperator };

export interface EditorContext {
  readonly store: DiagramStore;
  readonly layouted: LayoutedDiagram;
  readonly selection: string | null;
  readonly tool: Tool;
  select(id: string | null): void;
  setTool(tool: Tool): void;
  autoArrange(): void;
  fitView(): void;
  zoomBy(factor: number): void;
  getZoom(): number;
  toast(message: string): void;
  requestRender(): void;
  focusLabelEditor(): void;
  labelFocusTick: number;
  onChange(cb: () => void): () => void;
  exportSvgElement(): SVGSVGElement | null;
}

type Gesture =
  | { type: 'none' }
  | { type: 'maybe-drag'; nodeId: string; grabDx: number; grabDy: number; startX: number; startY: number }
  | { type: 'drag'; nodeId: string; grabDx: number; grabDy: number }
  | { type: 'connect'; fromId: string; dir: 'in' | 'out'; to: Point }
  | { type: 'pan'; startX: number; startY: number; tx0: number; ty0: number; moved: boolean }
  | { type: 'maybe-click-create'; startX: number; startY: number };

const AUTOSAVE_KEY = 'eepc-canvas:autosave';

export class Editor implements EditorContext {
  readonly store: DiagramStore;
  layouted: LayoutedDiagram;
  selection: string | null = null;
  tool: Tool = { kind: 'select' };
  labelFocusTick = 0;

  private root: HTMLDivElement;
  private svg: SVGSVGElement;
  private world: SVGGElement;
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
    const wrap = document.createElement('div');
    wrap.className = 'eepc-canvas-wrap';
    const inspector = document.createElement('aside');
    inspector.className = 'eepc-inspector';
    this.root.append(header, body);
    body.append(palette, wrap, inspector);

    this.svg = svgEl('svg', { class: 'eepc-canvas' }) as SVGSVGElement;
    wrap.appendChild(this.svg);
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
    this.resizeObserver(wrap);

    this.renderScene();
    this.fitView();
  }

  destroy(): void {
    for (const u of this.unsubs) u();
    this.root.remove();
  }

  // ── EditorContext ──

  select(id: string | null): void {
    this.selection = id;
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
    const cx = rect.width / 2, cy = rect.height / 2;
    this.zoomAt(cx, cy, factor);
  }

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

  focusLabelEditor(): void {
    this.labelFocusTick++;
    this.notify();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  exportSvgElement(): SVGSVGElement | null {
    if (this.layouted.views.length === 0) return null;
    return renderLayouted(this.layouted, { background: '#ffffff', idPrefix: `x${++this.renderCount}` });
  }

  getZoom(): number { return this.viewport.scale; }

  // ── Internals ──

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private onStoreChange(): void {
    this.layouted = layoutDiagram(this.store.diagram);
    if (this.selection && !this.store.diagram.nodes.some(n => n.id === this.selection)) {
      this.selection = null;
    }
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

    if (this.selection) {
      const v = this.viewOf(this.selection);
      if (v) drawOutline(v, SELECT_COLOR, false);
    }

    // Ports for the hovered or selected main node.
    const portNode = this.hoverNodeId ?? this.selection;
    if (portNode) {
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

  // ── Pointer gestures ──

  private bindPointer(): void {
    const svg = this.svg;

    svg.addEventListener('pointerdown', (e: PointerEvent) => {
      this.root.focus();
      svg.setPointerCapture(e.pointerId);
      const target = e.target as Element;
      const world = this.toWorld(e);
      this.lastPointerWorld = world;

      if (e.button === 1) {
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
        this.select(nodeId);
        const v = this.viewOf(nodeId);
        if (v && isMainNode(v.node)) {
          this.gesture = {
            type: 'maybe-drag', nodeId,
            grabDx: world.x - v.x, grabDy: world.y - v.y,
            startX: e.clientX, startY: e.clientY,
          };
        }
        return;
      }

      this.select(null);
      this.gesture = { type: 'pan', startX: e.clientX, startY: e.clientY, tx0: this.viewport.tx, ty0: this.viewport.ty, moved: false };
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
        this.gesture = { type: 'drag', nodeId: g.nodeId, grabDx: g.grabDx, grabDy: g.grabDy };
        this.requestRender();
        return;
      }
      if (g.type === 'drag') {
        const node = this.store.diagram.nodes.find(n => n.id === g.nodeId);
        if (node && isMainNode(node)) {
          node.x = gridRound(world.x - g.grabDx);
          node.y = gridRound(world.y - g.grabDy);
          this.store.mutate(() => { /* positions already written */ }, { history: false });
        }
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
        const free = this.findFreePosition(g.nodeId);
        const node = this.store.diagram.nodes.find(n => n.id === g.nodeId);
        if (node && isMainNode(node) && free) {
          node.x = free.x;
          node.y = free.y;
        }
        this.store.mutate(() => { /* positions already written */ }, { history: false });
        this.select(g.nodeId);
      } else if (g.type === 'maybe-click-create') {
        this.handleCreateClick(world, targetId);
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
        this.select(nodeEl.getAttribute('data-node-id'));
        this.focusLabelEditor();
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
        addNodeSafe(d, n);
        this.select(n.id);
        this.focusLabelEditor();
      });
    } else {
      this.store.mutate(d => {
        const n = makeNode(d, type, defaultLabel(type), { operator, x: 0, y: 0 });
        addNodeSafe(d, n);
        const pos = this.findFreePosition(n.id, world);
        if (pos) { n.x = pos.x; n.y = pos.y; }
        this.select(n.id);
        if (type !== 'gateway') this.focusLabelEditor();
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
    this.root.addEventListener('keydown', (e: KeyboardEvent) => {
      const inInput = (e.target as HTMLElement)?.matches?.('input, textarea, select');
      if (inInput) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.store.redo(); else this.store.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.store.redo();
        return;
      }
      if (e.key === 'Escape') {
        if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
        else this.select(null);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection) {
        e.preventDefault();
        const id = this.selection;
        this.store.mutate(d => removeNode(d, id));
        return;
      }
      if (this.selection && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 3 : GRID;
        const id = this.selection;
        this.store.mutate(d => {
          const n = d.nodes.find(m => m.id === id);
          if (n && isMainNode(n)) {
            const x = n.x ?? 0, y = n.y ?? 0;
            if (e.key === 'ArrowUp') n.y = y - step;
            if (e.key === 'ArrowDown') n.y = y + step;
            if (e.key === 'ArrowLeft') n.x = x - step;
            if (e.key === 'ArrowRight') n.x = x + step;
          }
        });
      }
    });
  }
}

/** Mount the full editor into a container element. */
export function mountEditor(container: HTMLElement, diagram: Diagram): Editor {
  return new Editor(container, diagram);
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

function addNodeSafe(d: Diagram, n: Diagram['nodes'][number]): void {
  d.nodes.push(n);
}
