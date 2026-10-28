import { emptyDiagram, parseDiagramJson } from '../core';
import type { Diagram } from '../core';
import { mountEditor } from './editor';
import '../styles.css';
import starterJson from '../../examples/01-obrabotka-obrashcheniya.eepc.json?raw';

const AUTOSAVE_KEY = 'eepc-canvas:autosave';

function loadInitialDiagram(): Diagram {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      const parsed = parseDiagramJson(saved);
      if (parsed.ok) return parsed.diagram;
    }
  } catch { /* ignore */ }
  const parsed = parseDiagramJson(starterJson);
  return parsed.ok ? parsed.diagram : emptyDiagram();
}

const el = document.getElementById('app');
if (el) {
  mountEditor(el as HTMLElement, loadInitialDiagram());
}
