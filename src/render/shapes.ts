import { COLORS } from '../core/constants';
import type { NodeView } from '../core/types';
import { svgEl } from './svg';

const HEX_CORNER = 30;

/** Baseline shift that optically centers a text line at a given middle
 *  (cap-height correction, works for Cyrillic and Latin mixes). */
const CAP_RATIO = 0.36;

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export function drawNode(view: NodeView): SVGGElement {
  const g = svgEl('g', {
    transform: `translate(${view.x},${view.y})`,
    'data-node-id': view.node.id,
    'data-node-type': view.node.type,
  }) as SVGGElement;
  const c = COLORS[view.node.type];
  switch (view.node.type) {
    case 'event': {
      const d = HEX_CORNER;
      g.appendChild(svgEl('polygon', {
        points: `${d},0 ${view.w - d},0 ${view.w},${view.h / 2} ${view.w - d},${view.h} ${d},${view.h} 0,${view.h / 2}`,
        fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5,
      }));
      drawLabel(g, view, 0, 0);
      break;
    }
    case 'function': {
      g.appendChild(svgEl('rect', {
        width: view.w, height: view.h, rx: 12,
        fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5,
      }));
      drawLabel(g, view, 0, 0);
      break;
    }
    case 'gateway': {
      const r = view.w / 2;
      g.appendChild(svgEl('circle', {
        cx: r, cy: r, r,
        fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5,
      }));
      const t = svgEl('text', {
        x: r, y: r + 13 * CAP_RATIO, 'text-anchor': 'middle',
        'font-size': 12, 'font-weight': 700, fill: c.text,
        'font-family': FONT_FAMILY,
      });
      t.textContent = view.node.type === 'gateway' ? view.node.operator : '';
      g.appendChild(t);
      break;
    }
    case 'role': {
      const cx = view.w / 2, cy = view.h / 2, rx = view.w / 2 - 2, ry = view.h / 2 - 2;
      g.appendChild(svgEl('ellipse', { cx, cy, rx, ry, fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5 }));
      // Vertical stripe along the left edge (classic eEPC role).
      const sx = 16;
      const t = (sx - cx) / rx;
      const h = ry * Math.sqrt(Math.max(0, 1 - t * t));
      g.appendChild(svgEl('line', {
        x1: sx, y1: cy - h, x2: sx, y2: cy + h,
        stroke: c.stroke, 'stroke-width': 2,
      }));
      // Label is centered in the space right of the stripe, not in the whole ellipse.
      drawLabel(g, view, 0, 12);
      break;
    }
    case 'document': {
      const w = view.w, h = view.h;
      const wave = `M0,0 L${w},0 L${w},${h - 11} Q${(3 * w) / 4},${h + 2} ${w / 2},${h - 11} Q${w / 4},${h - 24} 0,${h - 11} Z`;
      g.appendChild(svgEl('path', { d: wave, fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5 }));
      drawLabel(g, view, -5, 0);
      break;
    }
    case 'system': {
      g.appendChild(svgEl('rect', {
        width: view.w, height: view.h,
        fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5,
      }));
      for (const lx of [7, view.w - 7]) {
        g.appendChild(svgEl('line', {
          x1: lx, y1: 0, x2: lx, y2: view.h,
          stroke: c.stroke, 'stroke-width': 1.2,
        }));
      }
      drawLabel(g, view, 0, 0);
      break;
    }
  }
  return g;
}

/** Multi-line label, block centered on the shape's visual middle. */
function drawLabel(g: SVGGElement, view: NodeView, dy: number, dx: number): void {
  if (view.lines.length === 0) return;
  const c = COLORS[view.node.type];
  const cx = view.w / 2 + dx;
  const top = view.h / 2 + dy - ((view.lines.length - 1) * view.lineH) / 2;
  view.lines.forEach((line, i) => {
    const t = svgEl('text', {
      x: cx,
      y: top + i * view.lineH + view.font * CAP_RATIO,
      'text-anchor': 'middle',
      'font-size': view.font, fill: c.text, 'font-family': FONT_FAMILY,
    });
    t.textContent = line;
    g.appendChild(t);
  });
}
