import { describe, expect, it } from 'vitest';
import { fitNodeText, measureText, wrapLabel, wrapText } from '../text';

const w = (s: string) => measureText(s);

describe('text: balanced wrapping', () => {
  it('prefers a single line when the label fits', () => {
    const lines = wrapLabel('Тикет', 200, 3);
    expect(lines).toEqual(['Тикет']);
  });

  it('does not leave 1–2 letter words dangling at line ends', () => {
    const lines = wrapLabel('Оформление заказа в едином окне обслуживания', 120, 3);
    for (let i = 0; i < lines.length - 1; i++) {
      const lastWord = lines[i].split(' ').pop() ?? '';
      expect(lastWord.length, `line "${lines[i]}" ends with a dangling word`).toBeGreaterThan(2);
    }
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) {
      expect(w(line)).toBeLessThanOrEqual(120);
    }
  });

  it('balances two lines better than greedy fill', () => {
    // Greedy fills the first line maximally: "Поступило обращение в" / "техподдержку".
    const label = 'Поступило обращение в техподдержку';
    const greedy = wrapText(label, 140);
    const lines = wrapLabel(label, 140, 2);
    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith(' в')).toBe(false);
    const balancedDiff = Math.abs(w(lines[0]) - w(lines[1]));
    const greedyDiff = Math.abs(w(greedy[0]) - w(greedy[1] ?? ''));
    expect(balancedDiff).toBeLessThanOrEqual(greedyDiff + 0.01);
    if (greedy[0].endsWith(' в')) {
      // When greedy dangles a preposition, the balanced variant must avoid it
      // while staying at least as even.
      expect(balancedDiff).toBeLessThanOrEqual(greedyDiff + 0.01);
    }
  });

  it('hard-splits words longer than the whole line', () => {
    const lines = wrapLabel('Договорстрахованияответственности', 90, 3);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(w(line)).toBeLessThanOrEqual(91);
    }
  });
});

describe('text: node sizing', () => {
  it('picks widths on the 20 px step so centers stay on the grid', () => {
    for (const label of ['Старт', 'Провести полную проверку всех документов заявителя', 'Счёт']) {
      const fit = fitNodeText('function', label);
      expect(fit.w % 20).toBe(0);
      expect(fit.w).toBeLessThanOrEqual(360);
    }
  });

  it('keeps at most 3 lines at full font and 4 at small font', () => {
    const fit = fitNodeText('function', 'Поступил очень-очень длинный запрос на согласование бюджета на следующий отчётный период от филиала в Самаре');
    expect(fit.lines.length).toBeLessThanOrEqual(4);
  });

  it('reserves at least one symbol of padding around the label', () => {
    const fit = fitNodeText('event', 'Поступило обращение в техподдержку');
    const padL = 46, padR = 46; // PAD.event
    for (const line of fit.lines) {
      expect(w(line) + padL + padR).toBeLessThanOrEqual(fit.w);
    }
    expect(fit.w - 2 * 46).toBeGreaterThan(0);
  });
});
