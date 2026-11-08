// Правка таблиц раздела: чистые функции без React, чтобы их можно было проверить тестами

import type { ContentTable } from '@rw/core';
import { tablesError } from '@rw/core/tables';

import type { SheetTable } from './table-render';

export const emptyTable = (): ContentTable => ({
	title: '',
	rows: [['', ''], ['', '']],
	searchable: true,
});

/**
 * Разбирает текст из буфера обмена Excel: столбцы через табуляцию, строки через перевод строки,
 * ячейка с переводом строки или табом приходит в кавычках, кавычка внутри удваивается.
 */
export const parseTsv = (text: string): string[][] => {
	const source = text.replace(/\r\n?/g, '\n');
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;

	for (let index = 0; index < source.length; index++) {
		const char = source[index];

		if (quoted) {
			if (char !== '"') {
				// Таблица рисуется однострочными ячейками: перевод строки внутри ячейки становится пробелом
				cell += char === '\n' ? ' ' : char;
			} else if (source[index + 1] === '"') {
				cell += '"';
				index++;
			} else {
				quoted = false;
			}
		} else if (char === '"' && cell === '') {
			quoted = true;
		} else if (char === '\t') {
			row.push(cell);
			cell = '';
		} else if (char === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else {
			cell += char;
		}
	}

	// Excel заканчивает текст переводом строки: пустой хвост не считается строкой
	if (cell !== '' || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}

	return rows;
};

/** Кладёт блок в таблицу начиная с ячейки (row, column); таблица расширяется, если блок не помещается. */
export const pasteGrid = (rows: string[][], row: number, column: number, grid: string[][]): string[][] => {
	const width = Math.max(rows[0]?.length ?? 0, column + Math.max(0, ...grid.map(line => line.length)));
	const height = Math.max(rows.length, row + grid.length);
	const result = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => rows[y]?.[x] ?? ''));

	for (const [dy, line] of grid.entries()) {
		for (const [dx, value] of line.entries()) {
			result[row + dy][column + dx] = value;
		}
	}

	return result;
};

export const setCell = (rows: string[][], row: number, column: number, value: string): string[][] =>
	rows.map((line, y) => y === row ? line.map((cell, x) => x === column ? value : cell) : line);

export const addRow = (rows: string[][]): string[][] => [...rows, Array.from({ length: rows[0]?.length ?? 1 }, () => '')];

export const addColumn = (rows: string[][]): string[][] => rows.map(line => [...line, '']);

// Меньше двух строк (шапка и одна строка) таблица быть не может: её не примет API
export const removeRow = (rows: string[][], row: number): string[][] => rows.length > 2 ? rows.filter((_, y) => y !== row) : rows;

export const removeColumn = (rows: string[][], column: number): string[][] =>
	(rows[0]?.length ?? 0) > 1 ? rows.map(line => line.filter((_, x) => x !== column)) : rows;

// Длинный текст в ячейке переносится, поэтому на ширину столбца он влияет не больше, чем столько символов
const COLUMN_CHARS_MAX = 40;
// Ширина символа Open Sans 16px с запасом, rem
const CHAR_REM = 0.7;
// Поля картинки вокруг столбцов: отступы .table (2rem), рамки строки (.25rem), отступы строки (1.5rem)
const SHEET_PADDING_REM = 3.75;
// Зазор между столбцами, rem
const COLUMN_GAP_REM = 1;
const WIDTH_STEP_REM = 5;
const WIDTH_MIN_REM = 25;
const WIDTH_MAX_REM = 80;

/**
 * Подбирает сетку столбцов и ширину картинки по длине содержимого, настроек нет.
 * Доли столбцов растут медленнее длины текста (степень 0.6) и округляются до целых,
 * иначе один длинный столбец съедал бы всю ширину.
 */
export const autoLayout = (rows: string[][]): { width: string; grid: string; } => {
	const columns = rows[0]?.length ?? 0;
	const chars = Array.from({ length: columns }, (_, x) =>
		Math.min(COLUMN_CHARS_MAX, Math.max(3, ...rows.map(line => (line[x] ?? '').trim().length))));
	const weights = chars.map(length => length ** 0.6);
	const lightest = Math.min(...weights);
	const fractions = weights.map(weight => Math.max(1, Math.round(weight / lightest)));
	// Единица доли должна вместить самый тесный столбец
	const unit = Math.max(...chars.map((length, x) => length * CHAR_REM / fractions[x]));
	const width = unit * fractions.reduce((sum, fraction) => sum + fraction, 0) + (columns - 1) * COLUMN_GAP_REM + SHEET_PADDING_REM;
	const rounded = Math.min(WIDTH_MAX_REM, Math.max(WIDTH_MIN_REM, Math.round(width / WIDTH_STEP_REM) * WIDTH_STEP_REM));

	return { width: `${rounded}rem`, grid: fractions.map(fraction => `${fraction}fr`).join(' ') };
};

export const sheetOf = (table: ContentTable): SheetTable => ({
	title: table.title.trim(),
	description: table.description?.trim() || undefined,
	rows: table.rows,
	...autoLayout(table.rows),
});

const isBlank = (table: ContentTable) => !table.title.trim() && !table.description?.trim() && table.rows.every(row => row.every(cell => !cell.trim()));

/** Есть ли в таблицах хоть что-то введённое: пустую таблицу можно убрать без вопросов. */
export const tablesFilled = (tables: ContentTable[]): boolean => tables.some(table => !isBlank(table));

/** Что мешает сохранить таблицы; показывается в форме до отрисовки картинки. */
export const tablesProblem = (tables: ContentTable[]): string | null => {
	if (tables.length === 0) {
		return 'Добавьте хотя бы одну таблицу';
	}

	const untitled = tables.findIndex(table => !table.title.trim());

	return untitled === -1 ? tablesError(tables) : `Таблица ${untitled + 1}: введите заголовок`;
};

/**
 * Всё, от чего зависит вид картинки. Выключатель поиска на картинку не влияет:
 * если изменился только он, картинку перерисовывать не нужно.
 */
export const renderKey = (tables: ContentTable[] | null): string =>
	JSON.stringify(tables?.map(table => ({ title: table.title, description: table.description?.trim() || undefined, rows: table.rows })));
