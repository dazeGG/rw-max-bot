// Таблицы раздела: правила и текст для поиска. Без БД и сети, подключается и в API, и в админке (@rw/core/tables)

import type { ContentTable } from './content/types';

export const TABLES_MAX = 5;
export const TABLE_COLUMNS_MAX = 8;
export const TABLE_ROWS_MAX = 200;
export const TABLE_CELL_MAX = 200;
export const TABLE_TITLE_MAX = 200;
// Столько же принимает поле imageText в API
export const TABLES_TEXT_MAX = 10_000;

export const tablesError = (tables: ContentTable[]): string | null => {
	if (tables.length > TABLES_MAX) {
		return `В разделе не больше ${TABLES_MAX} таблиц`;
	}

	for (const [index, table] of tables.entries()) {
		const name = `Таблица ${index + 1}`;
		const columns = table.rows[0]?.length ?? 0;

		if (table.rows.length < 2) {
			return `${name}: нужна шапка и хотя бы одна строка`;
		}

		if (table.rows.length > TABLE_ROWS_MAX) {
			return `${name}: не больше ${TABLE_ROWS_MAX} строк`;
		}

		if (columns > TABLE_COLUMNS_MAX) {
			return `${name}: не больше ${TABLE_COLUMNS_MAX} столбцов`;
		}

		// Сетка картинки считается по шапке: строка другой длины ее сломает
		if (table.rows.some(row => row.length !== columns)) {
			return `${name}: в каждой строке должно быть одинаковое число столбцов`;
		}

		if (table.title.length > TABLE_TITLE_MAX || (table.description?.length ?? 0) > TABLE_TITLE_MAX) {
			return `${name}: заголовок и описание не длиннее ${TABLE_TITLE_MAX} символов`;
		}

		if (table.rows.some(row => row.some(cell => cell.length > TABLE_CELL_MAX))) {
			return `${name}: в ячейке не больше ${TABLE_CELL_MAX} символов`;
		}
	}

	return tablesSearchText(tables).length > TABLES_TEXT_MAX ? `Текст таблиц для поиска длиннее ${TABLES_TEXT_MAX} символов` : null;
};

// Заголовок «Плацкарт» в середине фразы пишется строчной, а «ЖДЯ» и «№ 317» остаются как есть
const lowerFirstWord = (header: string) => header.replace(/^(\p{Lu})(\p{Ll}+)(?=[\s,.;:]|$)/u, (_, first: string, rest: string) => first.toLowerCase() + rest);

// Перевод строки внутри ячейки схлопывается: поиск делит текст по строкам на отдельные факты, а ячейка — часть одного факта
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();

const isEmptyCell = (cell: string) => !clean(cell) || clean(cell) === '-';

// Каждая строка таблицы — отдельная фраза для поиска: «Томмот: плацкарт 2 039 ₽, купе от 2 803 ₽»
export const tablesSearchText = (tables: ContentTable[]): string =>
	tables.filter(table => table.searchable).map(table => {
		const [header, ...body] = table.rows;
		const lines = body.flatMap(row => {
			const parts = row.slice(1).flatMap((cell, index) => isEmptyCell(cell) ? [] : [`${lowerFirstWord(clean(header[index + 1]))} ${clean(cell)}`.trim()]);
			return parts.length > 0 && !isEmptyCell(row[0]) ? [`${clean(row[0])}: ${parts.join(', ')}`] : [];
		});
		const title = clean(table.title);
		const description = clean(table.description ?? '');

		return [description ? `${title}. ${description}` : title, ...lines].join('\n');
	}).join('\n\n');
