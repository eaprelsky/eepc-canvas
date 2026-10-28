import { COLORS } from '../core/constants';
import type { NodeView } from '../core/types';
import { svgEl } from './svg';

const HEX_CORNER = 30;

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
      drawLabel(g, view, 0);
      break;
    }
    case 'function': {
      g.appendChild(svgEl('rect', {
        width: view.w, height: view.h, rx: 14,
        fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5,
      }));
      drawLabel(g, view, 0);
      break;
    }
    case 'gateway': {
      const r = view.w / 2;
      g.appendChild(svgEl('circle', {
        cx: r, cy: r, r,
        fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5,
      }));
      const t = svgEl('text', {
        x: r, y: r, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': 13, 'font-weight': 700, fill: c.text,
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
      drawLabel(g, view, 10);
      break;
    }
    case 'document': {
      const w = view.w, h = view.h;
      const wave = `M0,0 L${w},0 L${w},${h - 12} Q${(3 * w) / 4},${h + 2} ${w / 2},${h - 12} Q${w / 4},${h - 26} 0,${h - 12} Z`;
      g.appendChild(svgEl('path', { d: wave, fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5 }));
      drawLabel(g, view, -6);
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
      drawLabel(g, view, 0);
      break;
    }
  }
  return g;
}

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function drawLabel(g: SVGGElement, view: NodeView, dy: number): void {
  if (view.lines.length === 0) return;
  const c = COLORS[view.node.type];
  const startX = view.w / 2;
  const startY = view.h / 2 - ((view.lines.length - 1) * view.lineH) / 2 + dy;
  view.lines.forEach((line, i) => {
    const t = svgEl('text', {
      x: startX, y: startY + i * view.lineH,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': view.font, fill: c.text, 'font-family': FONT_FAMILY,
    });
    t.textContent = line;
    g.appendChild(t);
  });
}
