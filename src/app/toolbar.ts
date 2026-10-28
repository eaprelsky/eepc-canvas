import {
  emptyDiagram, parseDiagramJson, serializeDiagram, serializeSvg, svgToPngBlob,
} from '../core';
import type { EditorContext } from './editor';

interface Btns {
  [key: string]: HTMLButtonElement;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_');
  return cleaned || 'diagram';
}

async function pickOpenFile(): Promise<string | null> {
  const w = window as unknown as {
    showOpenFilePicker?: () => Promise<FileSystemFileHandle>;
  };
  if (w.showOpenFilePicker) {
    try {
      const result = await w.showOpenFilePicker() as unknown;
      const handle = (Array.isArray(result) ? result[0] : result) as FileSystemFileHandle;
      const file = await handle.getFile();
      return await file.text();
    } catch {
      return null; // cancelled
    }
  }
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsText(file, 'utf-8');
    };
    input.click();
  });
}

async function saveFile(ctx: EditorContext): Promise<void> {
  const text = serializeDiagram(ctx.store.diagram);
  const filename = `${safeFilename(ctx.store.diagram.name)}.eepc.json`;
  const w = window as unknown as {
    showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandle>;
  };
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'eEPC диаграмма', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], { type: 'application/json' }));
      await writable.close();
      ctx.toast('Файл сохранён');
      return;
    } catch {
      return; // cancelled
    }
  }
  download(new Blob([text], { type: 'application/json' }), filename);
}

export function mountToolbar(container: HTMLElement, ctx: EditorContext): () => void {
  container.innerHTML = '';
  const btns: Btns = {};

  const mkBtn = (key: string, label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'eepc-btn';
    b.title = title;
    b.textContent = label;
    b.addEventListener('click', onClick);
    btns[key] = b;
    return b;
  };

  const mkGroup = (...els: HTMLElement[]): HTMLDivElement => {
    const g = document.createElement('div');
    g.className = 'eepc-toolbar-group';
    g.append(...els);
    return g;
  };

  const brand = document.createElement('span');
  brand.className = 'eepc-brand';
  brand.textContent = 'eEPC Canvas';

  const nameInput = document.createElement('input');
  nameInput.className = 'eepc-name-input';
  nameInput.type = 'text';
  nameInput.title = 'Название диаграммы';
  nameInput.value = ctx.store.diagram.name;
  let nameEditing = false;
  nameInput.addEventListener('focus', () => { nameEditing = true; });
  nameInput.addEventListener('blur', () => { nameEditing = false; });
  nameInput.addEventListener('input', () => {
    ctx.store.mutate(d => { d.name = nameInput.value; }, { history: false });
  });

  const newBtn = mkBtn('new', 'Новая', 'Пустая диаграмма', () => {
    ctx.store.replace(emptyDiagram('Новый процесс'));
    ctx.fitView();
  });

  const openBtn = mkBtn('open', 'Открыть…', 'Открыть файл .eepc.json (Ctrl+O)', async () => {
    const text = await pickOpenFile();
    if (text === null) return;
    const parsed = parseDiagramJson(text);
    if (!parsed.ok) {
      ctx.toast(`Не удалось открыть: ${parsed.errors[0]}`);
      return;
    }
    ctx.store.replace(parsed.diagram);
    ctx.fitView();
  });

  const saveBtn = mkBtn('save', 'Сохранить…', 'Сохранить диаграмму в файл (Ctrl+S)', () => { void saveFile(ctx); });

  const arrangeBtn = mkBtn('arrange', 'Упорядочить', 'Автоматически разложить диаграмму по слоям', () => {
    ctx.autoArrange();
    ctx.fitView();
  });

  const undoBtn = mkBtn('undo', '↶', 'Отменить (Ctrl+Z)', () => ctx.store.undo());
  const redoBtn = mkBtn('redo', '↷', 'Повторить (Ctrl+Y)', () => ctx.store.redo());

  const svgBtn = mkBtn('svg', 'SVG', 'Экспорт в SVG', () => {
    const el = ctx.exportSvgElement();
    if (!el) { ctx.toast('Диаграмма пуста'); return; }
    download(new Blob([serializeSvg(el)], { type: 'image/svg+xml' }),
      `${safeFilename(ctx.store.diagram.name)}.svg`);
  });

  const pngBtn = mkBtn('png', 'PNG', 'Экспорт в PNG (2×)', async () => {
    const el = ctx.exportSvgElement();
    if (!el) { ctx.toast('Диаграмма пуста'); return; }
    try {
      const blob = await svgToPngBlob(el, 2);
      download(blob, `${safeFilename(ctx.store.diagram.name)}.png`);
    } catch {
      ctx.toast('Не удалось собрать PNG');
    }
  });

  const zoomOut = mkBtn('zoomout', '−', 'Уменьшить', () => ctx.zoomBy(1 / 1.2));
  const zoomIn = mkBtn('zoomin', '+', 'Увеличить', () => ctx.zoomBy(1.2));
  const fitBtn = mkBtn('fit', '⤢', 'Вписать в экран', () => ctx.fitView());

  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'eepc-zoom-label';
  const zoomGroup = mkGroup(zoomOut, zoomLabel, zoomIn, fitBtn);

  const spacer = document.createElement('div');
  spacer.className = 'eepc-toolbar-spacer';

  container.append(
    brand,
    nameInput,
    mkGroup(newBtn, openBtn, saveBtn),
    mkGroup(arrangeBtn),
    mkGroup(undoBtn, redoBtn),
    mkGroup(svgBtn, pngBtn),
    spacer,
    zoomGroup,
  );

  const refresh = (): void => {
    undoBtn.disabled = !ctx.store.canUndo;
    redoBtn.disabled = !ctx.store.canRedo;
    zoomLabel.textContent = `${Math.round(ctx.getZoom() * 100)}%`;
    if (!nameEditing && nameInput.value !== ctx.store.diagram.name) {
      nameInput.value = ctx.store.diagram.name;
    }
  };
  refresh();
  const unsub = ctx.onChange(refresh);

  const onKeydown = (e: KeyboardEvent): void => {
    const inInput = (e.target as HTMLElement)?.matches?.('input, textarea, select');
    if (inInput) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void saveFile(ctx);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      void openBtn.click();
    }
  };
  window.addEventListener('keydown', onKeydown);

  return () => {
    unsub();
    window.removeEventListener('keydown', onKeydown);
  };
}
