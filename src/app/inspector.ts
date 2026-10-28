import {
  countIssues, isAttachedNode, isMainNode, makeNode, nodeById, removeNode, validateDiagram,
} from '../core';
import type { AttachDir, GatewayOperator, Side } from '../core';
import type { EditorContext } from './editor';

const TYPE_TITLES: Record<string, string> = {
  event: 'Событие', function: 'Функция', gateway: 'Точка ветвления',
  role: 'Роль', document: 'Документ', system: 'Информационная система',
};

export function mountInspector(container: HTMLElement, ctx: EditorContext): () => void {
  let lastLabelTick = ctx.labelFocusTick;

  const rebuild = (): void => {
    // Preserve label editing across rebuilds (focus + caret).
    const active = document.activeElement as HTMLElement | null;
    const wasLabel = active?.dataset?.field === 'label';
    const caret = wasLabel ? {
      start: (active as HTMLTextAreaElement).selectionStart,
      end: (active as HTMLTextAreaElement).selectionEnd,
    } : null;

    container.innerHTML = '';
    const d = ctx.store.diagram;
    const sel = ctx.selection ? nodeById(d, ctx.selection) : undefined;

    const props = document.createElement('div');
    props.className = 'eepc-panel';
    const propsTitle = document.createElement('div');
    propsTitle.className = 'eepc-panel-title';
    propsTitle.textContent = 'Свойства';
    props.appendChild(propsTitle);

    if (!sel) {
      const empty = document.createElement('div');
      empty.className = 'eepc-muted';
      empty.textContent = 'Выберите элемент на схеме. Двойной клик — редактировать подпись.';
      props.appendChild(empty);
    } else {
      const typeRow = document.createElement('div');
      typeRow.className = 'eepc-type-caption';
      typeRow.textContent = TYPE_TITLES[sel.type] +
        (sel.type === 'gateway' ? ` · ${sel.operator}` : '');
      props.appendChild(typeRow);

      if (sel.type !== 'gateway') {
        const label = document.createElement('textarea');
        label.dataset.field = 'label';
        label.className = 'eepc-label-input';
        label.rows = 2;
        label.value = sel.label;
        let batch = false;
        label.addEventListener('focus', () => { batch = false; });
        label.addEventListener('input', () => {
          const value = label.value;
          const id = sel.id;
          if (!batch) { ctx.store.beginBatch(); batch = true; }
          ctx.store.mutate(dd => {
            const n = nodeById(dd, id);
            if (n) n.label = value;
          }, { history: false });
        });
        props.appendChild(label);
      }

      if (sel.type === 'gateway') {
        const seg = document.createElement('div');
        seg.className = 'eepc-segment';
        for (const op of ['XOR', 'OR', 'AND'] as GatewayOperator[]) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `eepc-segment-btn ${sel.operator === op ? 'eepc-segment-active' : ''}`;
          b.textContent = op;
          b.addEventListener('click', () => {
            const id = sel.id;
            ctx.store.mutate(dd => {
              const n = nodeById(dd, id);
              if (n && n.type === 'gateway') n.operator = op;
            });
          });
          seg.appendChild(b);
        }
        props.appendChild(seg);
      }

      if (isAttachedNode(sel)) {
        const func = nodeById(d, sel.attachTo);
        const attachedTo = document.createElement('div');
        attachedTo.className = 'eepc-muted';
        attachedTo.textContent = `Привязан к функции: ${func?.label || func?.id || '—'}`;
        props.appendChild(attachedTo);

        props.appendChild(segSelect('Сторона', [
          { value: 'left', caption: 'Слева' },
          { value: 'right', caption: 'Справа' },
        ], sel.side, v => {
          const id = sel.id;
          ctx.store.mutate(dd => {
            const n = nodeById(dd, id);
            if (n && isAttachedNode(n)) n.side = v as Side;
          });
        }));

        if (sel.type !== 'role') {
          props.appendChild(segSelect('Стрелка', [
            { value: 'in', caption: 'В функцию' },
            { value: 'out', caption: 'Из функции' },
            { value: 'both', caption: 'Двусторонняя' },
          ], sel.dir ?? 'in', v => {
            const id = sel.id;
            ctx.store.mutate(dd => {
              const n = nodeById(dd, id);
              if (n && isAttachedNode(n) && n.type !== 'role') n.dir = v as AttachDir;
            });
          }));
        }
      }

      const actions = document.createElement('div');
      actions.className = 'eepc-actions';
      if (isMainNode(sel)) {
        const dup = document.createElement('button');
        dup.type = 'button';
        dup.className = 'eepc-btn';
        dup.textContent = 'Дублировать';
        dup.addEventListener('click', () => {
          const src = sel;
          ctx.store.mutate(dd => {
            const copy = makeNode(dd, src.type, src.label, {
              operator: src.type === 'gateway' ? src.operator : undefined,
              x: (src.x ?? 0) + 40,
              y: (src.y ?? 0) + 40,
            });
            dd.nodes.push(copy);
          });
        });
        actions.appendChild(dup);
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'eepc-btn eepc-btn-danger';
      del.textContent = 'Удалить';
      del.addEventListener('click', () => {
        const id = sel.id;
        ctx.store.mutate(dd => removeNode(dd, id));
        ctx.select(null);
      });
      actions.appendChild(del);
      props.appendChild(actions);
    }
    container.appendChild(props);

    // Validation panel.
    const issues = validateDiagram(d);
    const counts = countIssues(issues);
    const check = document.createElement('div');
    check.className = 'eepc-panel';
    const checkTitle = document.createElement('div');
    checkTitle.className = 'eepc-panel-title';
    const badge = counts.errors > 0 ? ` · ошибок ${counts.errors}`
      : counts.warnings > 0 ? ` · предупреждений ${counts.warnings}` : ' · всё в порядке';
    checkTitle.textContent = `Проверка нотации${badge}`;
    check.appendChild(checkTitle);

    const list = document.createElement('div');
    list.className = 'eepc-issues';
    if (issues.every(i => i.level === 'info') && issues.length > 0 && counts.errors + counts.warnings === 0 && issues[0].code === 'empty') {
      const el = document.createElement('div');
      el.className = 'eepc-issue eepc-issue-info';
      el.textContent = issues[0].message;
      list.appendChild(el);
    } else {
      const order = { error: 0, warning: 1, info: 2 } as const;
      const sorted = [...issues].sort((a, b) => order[a.level] - order[b.level]);
      for (const issue of sorted) {
        if (issue.code === 'func-func' && counts.errors > 0) continue; // hide hints while errors exist
        const el = document.createElement('div');
        el.className = `eepc-issue eepc-issue-${issue.level}`;
        el.textContent = issue.message;
        if (issue.nodeId) {
          el.classList.add('eepc-issue-clickable');
          el.addEventListener('click', () => ctx.select(issue.nodeId!));
        }
        list.appendChild(el);
      }
    }
    check.appendChild(list);
    container.appendChild(check);

    // Stats.
    const stats = document.createElement('div');
    stats.className = 'eepc-panel';
    const f = d.nodes.filter(n => n.type === 'function').length;
    const e = d.nodes.filter(n => n.type === 'event').length;
    const g = d.nodes.filter(n => n.type === 'gateway').length;
    const s = d.nodes.filter(isAttachedNode).length;
    stats.textContent = `Функций ${f} · Событий ${e} · Ветвлений ${g} · Ролей/документов/систем ${s}`;
    stats.classList.add('eepc-stats');
    container.appendChild(stats);

    // Restore label editing.
    if (wasLabel) {
      const ta = container.querySelector<HTMLTextAreaElement>('[data-field="label"]');
      if (ta) {
        ta.focus();
        if (caret) ta.setSelectionRange(caret.start, caret.end);
      }
    }
    // Focus on explicit request (double click).
    if (ctx.labelFocusTick !== lastLabelTick) {
      lastLabelTick = ctx.labelFocusTick;
      const ta = container.querySelector<HTMLTextAreaElement>('[data-field="label"]');
      if (ta) { ta.focus(); ta.select(); }
    }
  };

  rebuild();
  return ctx.onChange(rebuild);
}

function segSelect(
  caption: string,
  options: Array<{ value: string; caption: string }>,
  current: string,
  onPick: (value: string) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'eepc-field';
  const cap = document.createElement('div');
  cap.className = 'eepc-field-caption';
  cap.textContent = caption;
  const seg = document.createElement('div');
  seg.className = 'eepc-segment';
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `eepc-segment-btn ${current === o.value ? 'eepc-segment-active' : ''}`;
    b.textContent = o.caption;
    b.addEventListener('click', () => onPick(o.value));
    seg.appendChild(b);
  }
  wrap.append(cap, seg);
  return wrap;
}
