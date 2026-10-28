import { parseDiagramJson, serializeDiagram } from '../core/model';
import type { Diagram } from '../core/types';

const MAX_HISTORY = 100;

/** Observable diagram store with undo/redo over serialized snapshots. */
export class DiagramStore {
  diagram: Diagram;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<() => void>();

  constructor(diagram: Diagram) {
    this.diagram = diagram;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Capture the current state once (e.g. at the start of a drag). */
  beginBatch(): void {
    this.undoStack.push(serializeDiagram(this.diagram));
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  mutate(fn: (d: Diagram) => void, opts: { history?: boolean } = {}): void {
    if (opts.history !== false) this.beginBatch();
    fn(this.diagram);
    this.emit();
  }

  replace(diagram: Diagram): void {
    this.beginBatch();
    this.diagram = diagram;
    this.emit();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (prev === undefined) return false;
    this.redoStack.push(serializeDiagram(this.diagram));
    const parsed = parseDiagramJson(prev);
    if (parsed.ok) this.diagram = parsed.diagram;
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (next === undefined) return false;
    this.undoStack.push(serializeDiagram(this.diagram));
    const parsed = parseDiagramJson(next);
    if (parsed.ok) this.diagram = parsed.diagram;
    this.emit();
    return true;
  }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
}
