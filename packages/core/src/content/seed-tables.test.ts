import { describe, expect, it } from 'vitest';

import { tablesError, tablesSearchText } from '../tables';

import { flattenSeed } from './seed-data';

const nodes = flattenSeed().filter(node => node.tables);

describe('таблицы seed', () => {
	it('в 14 разделах 15 таблиц, и API их принимает', () => {
		expect(nodes).toHaveLength(14);
		expect(nodes.flatMap(node => node.tables!)).toHaveLength(15);

		for (const node of nodes) {
			expect(tablesError(node.tables!), node.code).toBeNull();
		}
	});

	it('картинка раздела осталась прежней, ячейки без разметки', () => {
		for (const node of nodes) {
			expect(node.image, node.code).toMatch(/^generated\/.+\.jpg$/);
			expect(JSON.stringify(node.tables), node.code).not.toMatch(/<\/?(br|b)>/);
		}
	});

	it('для поиска включены только тарифы ЖДЯ', () => {
		for (const node of nodes) {
			const searchable = node.code === 'tariffs-yakutia';
			expect(node.tables!.every(table => table.searchable), node.code).toBe(searchable);
			expect(node.imageText, node.code).toBe(searchable ? tablesSearchText(node.tables!) : null);
		}

		expect(nodes.find(node => node.code === 'tariffs-yakutia')!.imageText).toContain('Томмот: плацкарт 2 039 ₽, купе от 2 803 ₽');
	});
});
