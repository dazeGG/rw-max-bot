import { describe, expect, it } from 'vitest';

import type { ContentTable } from './content/types';
import { tablesError, tablesSearchText } from './tables';

const table = (rows: string[][] = [['Станция', 'Плацкарт'], ['Томмот', '2 039 ₽']], extra: Partial<ContentTable> = {}): ContentTable =>
	({ title: 'Тарифы', rows, searchable: true, ...extra });

describe('правила таблиц', () => {
	it('принимает обычную таблицу', () => {
		expect(tablesError([table()])).toBeNull();
		expect(tablesError([])).toBeNull();
	});

	it.each([
		['шесть таблиц', [1, 2, 3, 4, 5, 6].map(() => table())],
		['одна строка', [table([['Станция', 'Плацкарт']])]],
		['девять столбцов', [table([Array(9).fill('а'), Array(9).fill('б')])]],
		['201 строка', [table(Array.from({ length: 201 }, () => ['а', 'б']))]],
		['разное число столбцов', [table([['а', 'б'], ['в']])]],
		['длинная ячейка', [table([['а', 'б'], ['в', 'я'.repeat(201)]])]],
		['длинный заголовок', [table(undefined, { title: 'я'.repeat(201) })]],
		['длинное описание', [table(undefined, { description: 'я'.repeat(201) })]],
		['текст для поиска длиннее 10 000', [1, 2, 3, 4, 5].map(() => table(Array.from({ length: 100 }, () => ['я'.repeat(30), 'я'.repeat(30)])))],
	])('отклоняет: %s', (_name, tables) => {
		expect(tablesError(tables)).not.toBeNull();
	});

	it('границы лимитов проходят', () => {
		expect(tablesError([1, 2, 3, 4, 5].map(() => table()))).toBeNull();
		expect(tablesError([table([Array(8).fill('а'), Array(8).fill('б')])])).toBeNull();
		expect(tablesError([table(Array.from({ length: 200 }, () => ['а', 'б']), { searchable: false })])).toBeNull();
		expect(tablesError([table([['а', 'б'], ['в', 'я'.repeat(200)]], { title: 'я'.repeat(200) })])).toBeNull();
	});
});

describe('текст таблиц для поиска', () => {
	const tariffs = table([
		['Станция', 'Плацкарт', 'Купе'],
		['Томмот', '2 039 ₽', 'от 2 803 ₽'],
		['Чита', '6 996 ₽', '-'],
		['Пустая', '', ' '],
	], { title: 'Тарифы в вагонах ЖДЯ', description: 'На проезд в поездах №317, №327 / №318, №328' });

	it('одна строка таблицы — одна фраза', () => {
		expect(tablesSearchText([tariffs])).toBe([
			'Тарифы в вагонах ЖДЯ. На проезд в поездах №317, №327 / №318, №328',
			'Томмот: плацкарт 2 039 ₽, купе от 2 803 ₽',
			'Чита: плацкарт 6 996 ₽',
		].join('\n'));
	});

	it('аббревиатуры и номера в заголовках столбцов остаются как есть', () => {
		const text = tablesSearchText([table([['Станция', 'ЖДЯ', '№ 317/327', 'Плацкарт, купе'], ['Томмот', '1', '2', '3']])]);

		expect(text).toContain('Томмот: ЖДЯ 1, № 317/327 2, плацкарт, купе 3');
	});

	it('таблицы без включенного поиска не входят, остальные через пустую строку', () => {
		expect(tablesSearchText([tariffs, table(undefined, { title: 'Скрытая', searchable: false })])).toBe(tablesSearchText([tariffs]));
		expect(tablesSearchText([table(undefined, { searchable: false })])).toBe('');
		expect(tablesSearchText([table(), table(undefined, { title: 'Вторая' })])).toBe('Тарифы\nТоммот: плацкарт 2 039 ₽\n\nВторая\nТоммот: плацкарт 2 039 ₽');
	});
});
