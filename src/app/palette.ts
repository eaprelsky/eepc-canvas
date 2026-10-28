import type { GatewayOperator, NodeType } from '../core';
import type { EditorContext, Tool } from './editor';

interface PaletteItem {
  type: NodeType;
  operator?: GatewayOperator;
  caption: string;
  hint: string;
  preview: string; // inline svg markup
}

const ITEMS: PaletteItem[] = [
  {
    type: 'event', caption: 'Событие',
    hint: 'Шестиугольник: что произошло. Процесс начинается и заканчивается событием',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><polygon points="12,2 84,2 94,18 84,34 12,34 2,18" fill="#F7CDBD" stroke="#B34A26" stroke-width="1.5"/></svg>',
  },
  {
    type: 'function', caption: 'Функция',
    hint: 'Что сделать: действие участника процесса',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><rect x="2" y="2" width="92" height="32" rx="8" fill="#C4DE9C" stroke="#4A731B" stroke-width="1.5"/></svg>',
  },
  {
    type: 'gateway', operator: 'XOR', caption: 'XOR',
    hint: 'Ветвление: ровно одна ветвь',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><circle cx="48" cy="18" r="16" fill="#E3F0FA" stroke="#4B7BA8" stroke-width="1.5"/><text x="48" y="19" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill="#2C5F8A" font-family="system-ui">XOR</text></svg>',
  },
  {
    type: 'gateway', operator: 'OR', caption: 'OR',
    hint: 'Ветвление: одна ветвь или несколько',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><circle cx="48" cy="18" r="16" fill="#E3F0FA" stroke="#4B7BA8" stroke-width="1.5"/><text x="48" y="19" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill="#2C5F8A" font-family="system-ui">OR</text></svg>',
  },
  {
    type: 'gateway', operator: 'AND', caption: 'AND',
    hint: 'Ветвление: все ветви параллельно',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><circle cx="48" cy="18" r="16" fill="#E3F0FA" stroke="#4B7BA8" stroke-width="1.5"/><text x="48" y="19" text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill="#2C5F8A" font-family="system-ui">AND</text></svg>',
  },
  {
    type: 'role', caption: 'Роль',
    hint: 'Кто выполняет функцию. Кликните по функции, чтобы привязать',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><ellipse cx="48" cy="18" rx="44" ry="16" fill="#FFF3C2" stroke="#B7A000" stroke-width="1.5"/><line x1="14" y1="7" x2="14" y2="29" stroke="#B7A000" stroke-width="2"/></svg>',
  },
  {
    type: 'document', caption: 'Документ',
    hint: 'Документ-артефакт функции. Кликните по функции, чтобы привязать',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><path d="M2,2 L94,2 L94,28 Q70,38 48,28 Q26,18 2,28 Z" fill="#DCEBFD" stroke="#3B82F6" stroke-width="1.5"/></svg>',
  },
  {
    type: 'system', caption: 'Система',
    hint: 'Информационная система функции. Кликните по функции, чтобы привязать',
    preview: '<svg viewBox="0 0 96 36" width="96" height="36"><rect x="2" y="2" width="92" height="32" fill="#E0F2FE" stroke="#0E8FC9" stroke-width="1.5"/><line x1="8" y1="2" x2="8" y2="34" stroke="#0E8FC9" stroke-width="1.2"/><line x1="88" y1="2" x2="88" y2="34" stroke="#0E8FC9" stroke-width="1.2"/></svg>',
  },
];

export function mountPalette(container: HTMLElement, ctx: EditorContext): () => void {
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'eepc-panel-title';
  title.textContent = 'Элементы';
  container.appendChild(title);

  const buttons: HTMLButtonElement[] = [];

  const isActive = (item: PaletteItem, tool: Tool): boolean =>
    tool.kind === 'create' && tool.type === item.type &&
    (item.type !== 'gateway' || tool.operator === item.operator);

  for (const item of ITEMS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'eepc-palette-item';
    b.title = item.hint;
    b.innerHTML = `<div class="eepc-palette-preview">${item.preview}</div><div class="eepc-palette-caption">${item.type === 'gateway' ? `Ветвление ${item.caption}` : item.caption}</div>`;
    b.addEventListener('click', () => {
      const active = isActive(item, ctx.tool);
      ctx.setTool(active
        ? { kind: 'select' }
        : { kind: 'create', type: item.type, operator: item.operator });
    });
    container.appendChild(b);
    buttons.push(b);
  }

  const hint = document.createElement('div');
  hint.className = 'eepc-palette-hint';
  container.appendChild(hint);

  const refresh = (): void => {
    ITEMS.forEach((item, i) => {
      buttons[i].classList.toggle('eepc-palette-active', isActive(item, ctx.tool));
    });
    hint.textContent = ctx.tool.kind === 'create'
      ? ctx.tool.type === 'role' || ctx.tool.type === 'document' || ctx.tool.type === 'system'
        ? 'Кликните по функции, чтобы привязать элемент. Esc — отмена'
        : 'Кликните по свободному месту, чтобы добавить. Esc — отмена'
      : '';
  };
  refresh();
  return ctx.onChange(refresh);
}
