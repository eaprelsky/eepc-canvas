import {
  FONT, FONT_SMALL, GATEWAY_D, LINE_H, LINE_H_SMALL, MAX_LINES, MAX_LINES_SMALL,
  MAX_W, MIN_W, NODE_H, PAD_X,
} from './constants';
import type { NodeType } from './types';

export type MeasureText = (text: string) => number;

let canvasCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function browserMeasure(): MeasureText {
  return (text: string) => {
    if (!canvasCtx) {
      const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(10, 10)
        : document.createElement('canvas');
      canvasCtx = canvas.getContext('2d');
    }
    if (!canvasCtx) return heuristicWidth(text);
    canvasCtx.font = `13px system-ui, -apple-system, "Segoe UI", sans-serif`;
    return canvasCtx.measureText(text).width;
  };
}

// Deterministic approximation used when no canvas is available (tests, SSR).
function heuristicWidth(text: string): number {
  const NARROW = new Set('iljtfrI .,:;!|\'`()[]{}/\\-ьъы'.split(''));
  const WIDE = new Set('mMWwШЩЫЮЖФ@—–'.split(''));
  const CAPS = new Set('ABCDEFGHKNOPQRSTUVXYZБГДЁЗИЙКЛМНПРСТУХЦЧШЩЭЮЯ'.split(''));
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 3.6;
    else if (WIDE.has(ch)) w += 10.4;
    else if (NARROW.has(ch)) w += 3.4;
    else if (CAPS.has(ch)) w += 8.8;
    else w += 7.0;
  }
  return w;
}

let measureFn: MeasureText | null = null;

export function setMeasureText(fn: MeasureText | null): void {
  measureFn = fn;
  canvasCtx = null;
}

export function measureText(text: string): number {
  if (measureFn) return measureFn(text);
  if (typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined') {
    measureFn = browserMeasure();
    return measureFn(text);
  }
  return heuristicWidth(text);
}

/** Greedy word wrap with hard-splitting of words longer than maxWidth. */
export function wrapText(text: string, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  if (words.length === 0 || (words.length === 1 && words[0] === '')) return [];
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    let piece = word;
    // Hard-split overlong words.
    while (measureText(piece) > maxWidth && piece.length > 1) {
      let cut = piece.length;
      while (cut > 1 && measureText(piece.slice(0, cut)) > maxWidth) cut--;
      if (cur !== '') { lines.push(cur); cur = ''; }
      lines.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    const candidate = cur === '' ? piece : `${cur} ${piece}`;
    if (measureText(candidate) > maxWidth && cur !== '') {
      lines.push(cur);
      cur = piece;
    } else {
      cur = candidate;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

export interface NodeTextFit {
  w: number;
  lines: string[];
  font: number;
  lineH: number;
  truncated: boolean;
}

/** Pick the smallest width that fits the label within the line limit.
 *  Widths step by 20 px so that node centers always land on the 10 px grid. */
export function fitNodeText(type: NodeType, label: string): NodeTextFit {
  if (type === 'gateway') {
    return { w: GATEWAY_D, lines: [], font: FONT, lineH: LINE_H, truncated: false };
  }
  const pad = PAD_X[type];
  const tryFit = (font: number, maxLines: number): NodeTextFit | null => {
    const minW = Math.ceil(MIN_W[type] / 20) * 20;
    for (let w = minW; w <= MAX_W; w += 20) {
      const lines = wrapText(label, w - 2 * pad);
      if (lines.length <= maxLines) {
        return { w, lines, font, lineH: font === FONT ? LINE_H : LINE_H_SMALL, truncated: false };
      }
    }
    return null;
  };
  const fit = tryFit(FONT, MAX_LINES) ?? tryFit(FONT_SMALL, MAX_LINES_SMALL);
  if (fit) return fit;
  // Give up on fitting: use max width, shrink font, truncate with ellipsis.
  let lines = wrapText(label, MAX_W - 2 * pad);
  if (lines.length > MAX_LINES_SMALL) {
    lines = lines.slice(0, MAX_LINES_SMALL);
    const last = lines[MAX_LINES_SMALL - 1];
    lines[MAX_LINES_SMALL - 1] = last.length > 1 ? last.slice(0, -1) + '…' : '…';
  }
  return { w: MAX_W, lines, font: FONT_SMALL, lineH: LINE_H_SMALL, truncated: true };
}

/** Bounding rect of the drawn shape (gateway circle is smaller than the text band). */
export function shapeSize(type: NodeType, w: number): { w: number; h: number } {
  return type === 'gateway' ? { w: GATEWAY_D, h: GATEWAY_D } : { w, h: NODE_H };
}
