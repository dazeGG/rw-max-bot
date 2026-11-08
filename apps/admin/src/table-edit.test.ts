import { describe, expect, it } from 'vitest';

import type { ContentTable } from '@rw/core';

import { addColumn, addRow, autoLayout, emptyTable, parseTsv, pasteGrid, removeColumn, removeRow, renderKey, setCell, tablesFilled, tablesProblem } from './table-edit';

describe('parseTsv', () => {
	it('разбирает табы и переводы строк, хвостовой перевод строки не считается строкой', () => {
		expect(parseTsv('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
	});

	it('понимает переводы строк Windows и пустые ячейки', () => {
		expect(parseTsv('a\t\tc\r\n\td\te\r\n')).toEqual([['a', '', 'c'], ['', 'd', 'e']]);
	});

	it('снимает кавычки Excel, удвоенная кавычка остаётся одной, перевод строки внутри ячейки становится пробелом', () => {
		expect(parseTsv('"a\nb"\t"say ""hi"""\n')).toEqual([['a b', 'say "hi"']]);
	});

	it('одиночное значение с переводом строки даёт одну ячейку', () => {
		expect(parseTsv('2 039 ₽\n')).toEqual([['2 039 ₽']]);
	});

	it('пустой текст не даёт строк', () => {
		expect(parseTsv('')).toEqual([]);
	});

	it('последняя строка без перевода строки не теряется', () => {
		expect(parseTsv('a\tb\nc\td')).toEqual([['a', 'b'], ['c', 'd']]);
	});
});

describe('правка строк и столбцов', () => {
	const rows = [['a', 'b'], ['c', 'd']];

	it('вставка внутрь таблицы меняет только нужные ячейки', () => {
		expect(pasteGrid(rows, 1, 1, [['x']])).toEqual([['a', 'b'], ['c', 'x']]);
	});

	it('вставка за краем расширяет таблицу пустыми ячейками до прямоугольника', () => {
		expect(pasteGrid(rows, 1, 1, [['x', 'y'], ['z']])).toEqual([['a', 'b', ''], ['c', 'x', 'y'], ['', 'z', '']]);
	});

	it('setCell не меняет исходную таблицу', () => {
		expect(setCell(rows, 0, 1, 'B')).toEqual([['a', 'B'], ['c', 'd']]);
		expect(rows[0][1]).toBe('b');
	});

	it('добавляет строку и столбец', () => {
		expect(addRow(rows)).toEqual([['a', 'b'], ['c', 'd'], ['', '']]);
		expect(addColumn(rows)).toEqual([['a', 'b', ''], ['c', 'd', '']]);
	});

	it('удаляет строку и столбец', () => {
		expect(removeRow([...rows, ['e', 'f']], 1)).toEqual([['a', 'b'], ['e', 'f']]);
		expect(removeColumn(rows, 0)).toEqual([['b'], ['d']]);
	});

	it('не оставляет меньше шапки с одной строкой и меньше одного столбца', () => {
		expect(removeRow(rows, 0)).toBe(rows);
		expect(removeColumn([['a'], ['b']], 0)).toEqual([['a'], ['b']]);
	});
});

describe('autoLayout', () => {
	it('тарифы: 35rem и 2fr 1fr 1fr, как в исходном скрипте', () => {
		const rows = [
			['Со ст. Нижний Бестях', 'Плацкарт', 'Купе'],
			['Томмот', '2 039 ₽', 'от 2 803 ₽'],
			['Благовещенск', '5 425 ₽', 'от 8 797 ₽'],
			['Хабаровск', '6 996 ₽', 'от 10 390 ₽'],
			['Владивосток', '8 941 ₽', 'от 13 367 ₽'],
			['Чита', '6 996 ₽', '-'],
		];

		expect(autoLayout(rows)).toEqual({ width: '35rem', grid: '2fr 1fr 1fr' });
	});

	it('расписание №317: доли 2fr 1fr 1fr 1fr, ширина 45rem против 60rem в исходном скрипте', () => {
		const rows = [
			['Станция', 'Прибытие', 'Стоянка', 'Отправление'],
			['Нижний Бестях', '', '', '17:00'],
			['Нерюнгри-Пассажирская', '10:55', '00:40', '11:35'],
			['Благовещенск', '10:01', '', ''],
		];

		expect(autoLayout(rows)).toEqual({ width: '45rem', grid: '2fr 1fr 1fr 1fr' });
	});

	it('ячейка с переводами строк занимает ширину самой длинной строки', () => {
		const lines = [['а', 'б'], ['1234567890\n1234567890\n1234567890', 'x']];
		const flat = [['а', 'б'], ['1234567890', 'x']];

		expect(autoLayout(lines)).toEqual(autoLayout(flat));
	});

	it('одинаковые столбцы получают равные доли', () => {
		expect(autoLayout([['aaaa', 'bbbb'], ['cccc', 'dddd']]).grid).toBe('1fr 1fr');
	});

	it('ширина не выходит за пределы 25-80rem', () => {
		expect(autoLayout([['a', 'b'], ['c', 'd']]).width).toBe('25rem');
		const long = 'x'.repeat(200);
		expect(autoLayout(Array.from({ length: 2 }, () => Array.from({ length: 8 }, () => long))).width).toBe('80rem');
	});
});

describe('tablesProblem', () => {
	const table = (patch: Partial<ContentTable> = {}): ContentTable => ({ ...emptyTable(), title: 'Тарифы', ...patch });

	it('принимает нормальную таблицу', () => {
		expect(tablesProblem([table()])).toBeNull();
	});

	it('требует таблицу и заголовок', () => {
		expect(tablesProblem([])).toMatch(/хотя бы одну/);
		expect(tablesProblem([table(), table({ title: ' ' })])).toBe('Таблица 2: введите заголовок');
	});

	it('показывает ошибки правил API', () => {
		expect(tablesProblem([table({ rows: [['a', 'b']] })])).toMatch(/нужна шапка/);
		expect(tablesProblem([table({ rows: [['a', 'b'], ['c']] })])).toMatch(/одинаковое число столбцов/);
	});
});

describe('renderKey и tablesFilled', () => {
	it('выключатель поиска не влияет на ключ отрисовки, текст ячейки влияет', () => {
		const base = { ...emptyTable(), title: 'Т' };

		expect(renderKey([{ ...base, searchable: false }])).toBe(renderKey([base]));
		expect(renderKey([{ ...base, rows: setCell(base.rows, 0, 0, 'x') }])).not.toBe(renderKey([base]));
	});

	it('пустая таблица не считается заполненной', () => {
		expect(tablesFilled([emptyTable()])).toBe(false);
		expect(tablesFilled([{ ...emptyTable(), description: 'x' }])).toBe(true);
	});
});
