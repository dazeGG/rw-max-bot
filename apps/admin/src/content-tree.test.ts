import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, ROOT_CODE } from '@rw/core';
import type { AdminContentNode, NodeType } from '@rw/core';

import { ancestorsOf, buildTree, dropPlace, isSamePlace, matchingIds, pathOf, previewReplies, subtreeOf } from './content-tree';

const node = (id: number, parentId: number | null, fields: Partial<AdminContentNode> & { type?: NodeType; } = {}): AdminContentNode => ({
	id,
	parentId,
	code: parentId === null ? ROOT_CODE : `n${id}`,
	type: 'section',
	title: `Раздел ${id}`,
	text: null,
	url: null,
	targetId: null,
	image: null,
	imageText: null,
	tables: null,
	file: null,
	fileName: null,
	synonyms: [],
	sort: id * 10,
	isActive: true,
	isHidden: false,
	updatedAt: '2026-11-01T00:00:00.000Z',
	updatedBy: null,
	...fields,
});

// 1 ─ 2 ─ 3
//   │   └ 4
//   └ 5 (ссылка)
//   └ 6 (переход в 3)
//   └ 7
const tree = buildTree([
	node(1, null),
	node(2, 1),
	node(3, 2, { synonyms: ['вернуть билет'] }),
	node(4, 2),
	node(5, 1, { type: 'link', url: 'https://rw-y.ru' }),
	node(6, 1, { type: 'goto', targetId: 3 }),
	node(7, 1),
]);

const place = (dragId: number, nodeId: number, dropToGap: boolean, side: number) => dropPlace(tree, dragId, nodeId, dropToGap, side);

describe('дерево', () => {
	it('путь и вложенные', () => {
		expect(ancestorsOf(tree, 3).map(item => item.id)).toEqual([1, 2]);
		expect(pathOf(tree, tree.byId.get(3)!)).toBe('Раздел 2 / Раздел 3');
		expect(subtreeOf(tree, 2)).toEqual(new Set([2, 3, 4]));
	});

	it('поиск находит по синонимам и оставляет родителей', () => {
		expect(matchingIds(tree, 'Вернуть')).toEqual(new Set([1, 2, 3]));
	});
});

describe('перетаскивание', () => {
	it('внутрь раздела — в начало', () => {
		expect(place(7, 2, false, 0)).toEqual({ parentId: 2, index: 0 });
	});

	it('ниже соседа и выше соседа в другом родителе', () => {
		expect(place(7, 3, true, 1)).toEqual({ parentId: 2, index: 1 });
		expect(place(7, 3, true, -1)).toEqual({ parentId: 2, index: 0 });
	});

	it('внутри одного родителя считает место без самого раздела', () => {
		expect(place(2, 6, true, 1)).toEqual({ parentId: 1, index: 2 });
		expect(place(7, 5, true, -1)).toEqual({ parentId: 1, index: 1 });
	});

	it('узнает, что раздел остался на месте', () => {
		expect(isSamePlace(tree, 5, place(5, 2, true, 1))).toBe(true);
		expect(isSamePlace(tree, 5, place(5, 6, true, -1))).toBe(true);
		expect(isSamePlace(tree, 5, place(5, 6, true, 1))).toBe(false);
		expect(isSamePlace(tree, 7, place(7, 3, true, 1))).toBe(false);
	});
});

describe('предпросмотр', () => {
	const textOf = (draft: AdminContentNode) => previewReplies(tree, DEFAULT_SETTINGS, draft).map(reply => reply.text);

	it('показывает несохраненный текст с вариантами', () => {
		expect(textOf({ ...tree.byId.get(2)!, text: 'Что интересует?' })).toEqual(['Что интересует?\n1. Раздел 3\n2. Раздел 4']);
	});

	it('конечный раздел добавляет вопрос о помощи', () => {
		expect(textOf({ ...tree.byId.get(3)!, text: 'Ответ' })).toEqual(['Ответ', DEFAULT_SETTINGS['text.anythingElse']]);
	});

	it('работает для выключенного раздела', () => {
		expect(textOf({ ...tree.byId.get(3)!, text: 'Ответ', isActive: false })[0]).toBe('Ответ');
	});

	it('переход показывает раздел, куда ведет', () => {
		expect(textOf(tree.byId.get(6)!)[0]).toBe('<b>Раздел 3</b>');
	});

	it('переход без цели бот не показывает', () => {
		expect(textOf({ ...tree.byId.get(6)!, targetId: null })).toEqual([]);
	});
});
