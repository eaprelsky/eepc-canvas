// Embedding entry: builds window.EepcCanvas when loaded as a single IIFE script.
import { mountEditor } from './app/editor';
import {
  autoArrange, layoutDiagram, parseDiagramJson, renderLayouted, serializeDiagram, serializeSvg,
} from './core';
import type { Diagram } from './core';

export { mountEditor };
export { autoArrange, layoutDiagram, parseDiagramJson, renderLayouted, serializeDiagram, serializeSvg };
export type { Diagram };

/** Programmatic mount into any container. */
export function mount(container: HTMLElement, diagram: Diagram) {
  return mountEditor(container, diagram);
}
