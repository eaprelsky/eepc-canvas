import { inFlows, nodeById, outFlows } from './model';
import { fitNodeText } from './text';
import type { Diagram, DiagramNode } from './types';
import { isAttachedNode, isMainNode } from './types';

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  nodeId?: string;
}

const INF_ENDINGS = ['ть', 'ться', 'ти', 'ться.', 'чь', 'сти'];

function looksInfinitive(label: string): boolean {
  const first = label.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^а-яё-]/g, '') ?? '';
  return INF_ENDINGS.some(e => first.endsWith(e));
}

/** Whether an event can reach another event by crossing only gateways. */
function eventReachesEventViaGateways(d: Diagram, fromId: string): { gatewayId: string } | null {
  const queue: string[] = outFlows(d, fromId).map(f => f.to);
  const visited = new Set<string>([fromId]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const n = nodeById(d, id);
    if (!n) continue;
    if (n.type === 'event') return { gatewayId: id };
    if (n.type === 'gateway') {
      for (const f of outFlows(d, id)) queue.push(f.to);
    }
  }
  return null;
}

export function validateDiagram(d: Diagram): Issue[] {
  const issues: Issue[] = [];
  const main = d.nodes.filter(isMainNode);
  if (main.length === 0) {
    return [{ level: 'info', code: 'empty', message: 'Диаграмма пуста — добавьте элементы из палитры' }];
  }

  const push = (level: IssueLevel, code: string, message: string, nodeId?: string) =>
    issues.push({ level, code, message, nodeId });

  for (const n of main) {
    const name = labelOf(n);
    if (n.type !== 'event' && inFlows(d, n.id).length === 0) {
      push('error', 'start-not-event', `Процесс должен начинаться событием, а «${name}» — не событие`, n.id);
    }
    if (n.type !== 'event' && outFlows(d, n.id).length === 0) {
      push('error', 'end-not-event', `Процесс должен заканчиваться событием, а «${name}» — не событие`, n.id);
    }
    if (n.type === 'event' || n.type === 'function') {
      if (outFlows(d, n.id).length > 1) {
        push('error', 'multi-out', `У «${name}» несколько выходов — для ветвления нужна точка ветвления`, n.id);
      }
      if (inFlows(d, n.id).length > 1) {
        push('error', 'multi-in', `У «${name}» несколько входов — для слияния нужна точка ветвления`, n.id);
      }
    }
    if (n.type === 'gateway') {
      const hasFuncNeighbor = [...inFlows(d, n.id), ...outFlows(d, n.id)].some(f => {
        const other = nodeById(d, f.from === n.id ? f.to : f.from);
        return other?.type === 'function';
      });
      const deg = inFlows(d, n.id).length + outFlows(d, n.id).length;
      if (deg === 0) {
        push('warning', 'unconnected', `Точка ветвления «${name}» ни с чем не соединена`, n.id);
      } else if (!hasFuncNeighbor) {
        push('error', 'gateway-no-func', `Точка ветвления «${n.operator}» должна соединяться с функцией хотя бы с одной стороны`, n.id);
      }
    }
    if (degOf(d, n.id) === 0) {
      push('warning', 'unconnected', `Элемент «${name}» не соединён с процессом`, n.id);
    }
    if (n.type === 'event' && looksInfinitive(n.label)) {
      push('warning', 'event-infinitive', `Событие «${name}» похоже на функцию: события формулируются как свершившийся факт («что произошло?»)` , n.id);
    }
    if (n.type === 'function' && n.label.trim() && !looksInfinitive(n.label)) {
      push('warning', 'func-not-infinitive', `Функция «${name}» должна начинаться с глагола в инфинитиве («что сделать?»)` , n.id);
    }
    const fit = fitNodeText(n.type, n.label);
    if (fit.truncated) {
      push('warning', 'label-long', `Формулировка «${name}» не помещается в 3 строки — лучше сократить или разбить на элементы`, n.id);
    }
  }

  // Event→event and event→gateway-chain→event.
  for (const f of d.flows) {
    const from = nodeById(d, f.from);
    const to = nodeById(d, f.to);
    if (from && to) {
      if (isAttachedNode(from) || isAttachedNode(to)) {
        push('error', 'flow-side', 'Роль, документ и система соединяются с функцией привязкой, а не стрелкой процесса', f.from);
      }
      if (from.type === 'event' && to.type === 'event') {
        push('error', 'event-event', `Два события подряд («${from.label}» → «${to.label}») — между ними нужна функция`, f.from);
      }
      if (from.type === 'function' && to.type === 'function') {
        push('info', 'func-func', `Между «${from.label}» и «${to.label}» нет события — допустимо, но каноничнее добавить событие-результат`, f.to);
      }
    }
  }
  for (const n of main) {
    if (n.type === 'event') {
      const chain = eventReachesEventViaGateways(d, n.id);
      if (chain) {
        const gw = nodeById(d, chain.gatewayId);
        const gwName = gw
          ? (gw.type === 'gateway' ? (gw.label || gw.operator) : (gw.label || gw.id))
          : '';
        push('error', 'event-event-via-gw',
          `Событие «${n.label}» соединено с другим событием через точку ветвления${gwName ? ` «${gwName}»` : ''} — точка ветвления ставится после функции`, chain.gatewayId);
      }
    }
  }

  const funcCount = main.filter(n => n.type === 'function').length;
  if (funcCount >= 6 && !main.some(n => n.type === 'gateway')) {
    push('info', 'no-gateways', 'В процессе нет ни одной точки ветвления — проверьте, действительно ли процесс линейный');
  }
  const sideCount = d.nodes.filter(isAttachedNode).length;
  if (funcCount >= 5 && sideCount === 0) {
    push('info', 'no-side-elements', 'Не используются роли, документы и системы — они делают процесс понятнее');
  }

  return issues;
}

function degOf(d: Diagram, id: string): number {
  return inFlows(d, id).length + outFlows(d, id).length;
}

function labelOf(n: DiagramNode): string {
  if (n.type === 'gateway') return n.label || n.operator;
  return n.label || n.id;
}

// ── Live connection check used by the editor ─────────────────────────────────

export type ConnectCheck = { ok: true } | { ok: false; reason: string };

export function canConnect(d: Diagram, fromId: string, toId: string): ConnectCheck {
  const from = nodeById(d, fromId);
  const to = nodeById(d, toId);
  if (!from || !to) return { ok: false, reason: 'Элемент не найден' };
  if (from.id === to.id) return { ok: false, reason: 'Нельзя соединить элемент с самим собой' };
  if (isAttachedNode(from) || isAttachedNode(to)) {
    return { ok: false, reason: 'Роль, документ и система привязываются к функции, а не к потоку процесса' };
  }
  if (d.flows.some(f => f.from === fromId && f.to === toId)) {
    return { ok: false, reason: 'Такая стрелка уже есть' };
  }
  if (from.type === 'event' && to.type === 'event') {
    return { ok: false, reason: 'Два события подряд недопустимы — вставьте функцию' };
  }
  if ((from.type === 'event' || from.type === 'function') && outFlows(d, fromId).length > 0) {
    return { ok: false, reason: 'У события и функции может быть только один выход. Поставьте точку ветвления' };
  }
  if ((to.type === 'event' || to.type === 'function') && inFlows(d, toId).length > 0) {
    return { ok: false, reason: 'У события и функции может быть только один вход. Поставьте точку ветвления' };
  }
  return { ok: true };
}

export function countIssues(issues: Issue[]): { errors: number; warnings: number; infos: number } {
  let errors = 0, warnings = 0, infos = 0;
  for (const i of issues) {
    if (i.level === 'error') errors++;
    else if (i.level === 'warning') warnings++;
    else infos++;
  }
  return { errors, warnings, infos };
}
