import { ATTACH_COLOR, EDGE_COLOR } from '../core/constants';
import type { LayoutedDiagram } from '../core/types';
import { drawNode } from './shapes';
import { roundedPath, svgEl } from './svg';

export interface RenderOptions {
  /** Page background; use 'transparent' to omit. Default white. */
  background?: string;
  /** Unique prefix so several SVGs can coexist on one page. */
  idPrefix?: string;
}

export function renderLayouted(l: LayoutedDiagram, opts: RenderOptions = {}): SVGSVGElement {
  const p = opts.idPrefix ?? 'eepc';
  const svg = svgEl('svg', {
    width: Math.ceil(l.width),
    height: Math.ceil(l.height),
    viewBox: `0 0 ${Math.ceil(l.width)} ${Math.ceil(l.height)}`,
    style: 'display:block',
  }) as SVGSVGElement;

  const defs = svgEl('defs');
  const mkFlow = svgEl('marker', {
    id: `${p}-arrow`, markerWidth: 10, markerHeight: 8, refX: 8.5, refY: 3,
    orient: 'auto', markerUnits: 'userSpaceOnUse',
  });
  mkFlow.appendChild(svgEl('path', { d: 'M0,0 L9,3 L0,6 Z', fill: EDGE_COLOR }));
  const mkAttach = svgEl('marker', {
    id: `${p}-attach`, markerWidth: 10, markerHeight: 8, refX: 8.5, refY: 3,
    orient: 'auto', markerUnits: 'userSpaceOnUse',
  });
  mkAttach.appendChild(svgEl('path', { d: 'M0,0 L9,3 L0,6 Z', fill: ATTACH_COLOR }));
  const mkAttachStart = svgEl('marker', {
    id: `${p}-attach-start`, markerWidth: 10, markerHeight: 8, refX: 8.5, refY: 3,
    orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
  });
  mkAttachStart.appendChild(svgEl('path', { d: 'M0,0 L9,3 L0,6 Z', fill: ATTACH_COLOR }));
  defs.append(mkFlow, mkAttach, mkAttachStart);
  svg.appendChild(defs);

  const bg = opts.background ?? '#ffffff';
  if (bg !== 'transparent') {
    svg.appendChild(svgEl('rect', {
      x: 0, y: 0, width: Math.ceil(l.width), height: Math.ceil(l.height), fill: bg,
    }));
  }

  const edgeLayer = svgEl('g');
  for (const f of l.flows) {
    edgeLayer.appendChild(svgEl('path', {
      d: roundedPath(f.points),
      fill: 'none', stroke: EDGE_COLOR, 'stroke-width': 1.6,
      'marker-end': `url(#${p}-arrow)`,
      'data-flow-id': f.edge.id,
      'data-degraded': f.degraded ? '1' : undefined,
    }));
  }
  for (const at of l.attachments) {
    const attrs: Record<string, string | number | undefined> = {
      d: roundedPath(at.points),
      fill: 'none', stroke: ATTACH_COLOR, 'stroke-width': 1.3,
      'data-attach-id': at.nodeId,
    };
    if (at.dir === 'out') attrs['marker-end'] = `url(#${p}-attach)`;
    if (at.dir === 'in') attrs['marker-start'] = `url(#${p}-attach-start)`;
    if (at.dir === 'both') {
      attrs['marker-end'] = `url(#${p}-attach)`;
      attrs['marker-start'] = `url(#${p}-attach-start)`;
    }
    edgeLayer.appendChild(svgEl('path', attrs));
  }
  svg.appendChild(edgeLayer);

  const nodeLayer = svgEl('g');
  for (const v of l.views) {
    nodeLayer.appendChild(drawNode(v));
  }
  svg.appendChild(nodeLayer);

  return svg;
}

export function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
}

export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const source = serializeSvg(svg);
  const w = Number(svg.getAttribute('width')) * scale;
  const h = Number(svg.getAttribute('height')) * scale;
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('SVG rasterization failed'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
