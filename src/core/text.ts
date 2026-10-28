import {
  FONT, FONT_SMALL, GATEWAY_D, LINE_H, LINE_H_SMALL, MAX_LINES, MAX_LINES_SMALL,
  MAX_W, MIN_W, NODE_H, PAD,
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

// ── Balanced wrapping ─────────────────────────────────────────────────────────
// Minimises the widest line (balance) instead of filling lines greedily,
// and avoids lines ending in 1–2 letter words (prepositions like «в», «по»).

interface WrapResult { lines: string[]; maxW: number }

function balancedWrap(words: string[], maxLines: number, maxWidth: number): WrapResult | null {
  if (words.length === 0) return { lines: [], maxW: 0 };
  const widths: number[] = words.map(w => measureText(w));
  const spaceW = measureText(' ');
  // lineW(i, j) = width of words[i..j)
  const lineW = (i: number, j: number): number => {
    let w = 0;
    for (let k = i; k < j; k++) w += widths[k] + (k > i ? spaceW : 0);
    return w;
  };

  // best[i][k] = best arrangement of words[i..) into k lines: {maxW, pen, breaks}.
  // Penalty keeps lines balanced and avoids line ends after 1–2 letter words.
  const n = words.length;
  const memo = new Map<string, { maxW: number; pen: number; next: number[] } | null>();

  const best = (i: number, k: number): { maxW: number; pen: number; next: number[] } | null => {
    const key = `${i}:${k}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let result: { maxW: number; pen: number; next: number[] } | null = null;
    if (k === 1) {
      const w = lineW(i, n);
      if (w <= maxWidth) result = { maxW: w, pen: 0, next: [n] };
    } else {
      for (let j = i + 1; j <= n - (k - 1); j++) {
        const w = lineW(i, j);
        if (w > maxWidth) break;
        const sub = best(j, k - 1);
        if (!sub) continue;
        const slack = maxWidth - w;
        const dangle = words[j - 1].length <= 2 ? 1000 : 0;
        const cand = { maxW: Math.max(w, sub.maxW), pen: sub.pen + slack * slack + dangle, next: [j, ...sub.next] };
        if (!result ||
            cand.pen < result.pen ||
            (cand.pen === result.pen && cand.maxW < result.maxW)) {
          result = cand;
        }
      }
    }
    memo.set(key, result ?? null);
    return result;
  };

  // Fewest lines wins; within that count the DP balance penalty decides.
  for (let k = 1; k <= Math.min(maxLines, n); k++) {
    const r = best(0, k);
    if (!r) continue;
    const cuts = [0, ...r.next];
    const lines: string[] = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      lines.push(words.slice(cuts[i], cuts[i + 1]).join(' '));
    }
    return { lines, maxW: r.maxW };
  }
  return null;
}

/** Balanced wrap used for shape labels; falls back to greedy for overlong words. */
export function wrapLabel(text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(w => w !== '');
  if (words.length === 0) return [];
  const anyWordTooLong = words.some(w => measureText(w) > maxWidth);
  if (anyWordTooLong) return wrapText(text, maxWidth).slice(0, maxLines);
  const result = balancedWrap(words, maxLines, maxWidth);
  if (!result) return wrapText(text, maxWidth).slice(0, maxLines);
  // Post-fix: never leave a 1–2 letter word at a line end when it can move down.
  const lines = [...result.lines];
  for (let i = 0; i < lines.length - 1; i++) {
    const parts = lines[i].split(' ');
    const last = parts[parts.length - 1];
    if (last.length <= 2 && parts.length > 1) {
      const moved = parts.slice(0, -1).join(' ');
      const candidate = lines[i + 1] ? `${last} ${lines[i + 1]}` : last;
      if (measureText(candidate) <= maxWidth) {
        lines[i] = moved;
        lines[i + 1] = candidate;
      }
    }
  }
  return lines;
}

export interface NodeTextFit {
  w: number;
  lines: string[];
  font: number;
  lineH: number;
  truncated: boolean;
}

/** Pick the smallest width (20 px steps keep node centers on the 10 px grid)
 *  that fits the label within the line limit. */
export function fitNodeText(type: NodeType, label: string): NodeTextFit {
  if (type === 'gateway') {
    return { w: GATEWAY_D, lines: [], font: FONT, lineH: LINE_H, truncated: false };
  }
  const pad = PAD[type].l + PAD[type].r;
  const tryFit = (font: number, maxLines: number): NodeTextFit | null => {
    const minW = Math.ceil(MIN_W[type] / 20) * 20;
    for (let w = minW; w <= MAX_W; w += 20) {
      const lines = wrapLabel(label, w - pad, maxLines);
      if (lines.length <= maxLines && (lines.length === 0 || lines.every(l => measureText(l) <= w - pad))) {
        return { w, lines, font, lineH: font === FONT ? LINE_H : LINE_H_SMALL, truncated: false };
      }
    }
    return null;
  };
  const fit = tryFit(FONT, MAX_LINES) ?? tryFit(FONT_SMALL, MAX_LINES_SMALL);
  if (fit) return fit;
  // Give up on fitting: use max width, shrink font, truncate with ellipsis.
  let lines = wrapText(label, MAX_W - pad);
  if (lines.length > MAX_LINES_SMALL) {
    lines = lines.slice(0, MAX_LINES_SMALL);
    const last = lines[MAX_LINES_SMALL - 1];
    lines[MAX_LINES_SMALL - 1] = last.length > 1 ? last.slice(0, -1) + '…' : '…';
  }
  return { w: MAX_W, lines, font: FONT_SMALL, lineH: LINE_H_SMALL, truncated: true };
}

/** Bounding size of the drawn shape (gateway circle is smaller than the row). */
export function shapeSize(type: NodeType, w: number): { w: number; h: number } {
  return type === 'gateway' ? { w: GATEWAY_D, h: GATEWAY_D } : { w, h: NODE_H };
}
