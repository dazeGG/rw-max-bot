import { describe, expect, it, vi } from 'vitest';

import { ContentTree } from '../content/tree';
import type { ContentNode } from '../content/types';

import { checkSearch } from './check';
import { DEFAULT_SEARCH_POLICY } from './search';
import type { DialogSearch } from './search';

const node = (id: number, parentId: number | null, code: string, title: string): ContentNode => ({
	id,
	parentId,
	code,
	type: 'section',
	title,
	text: `Текст: ${title}`,
	url: null,
	targetId: null,
	sort: id,
	synonyms: [],
	image: null,
	imageText: null,
	file: null,
	fileName: null,
	isActive: true,
	isHidden: false,
});

const tree = new ContentTree([
	node(1, null, 'root', 'Начало'),
	node(2, 1, 'refund', 'Возврат билета'),
	node(3, 1, 'buy', 'Купить билет'),
	node(4, 1, 'support', 'Служба поддержки'),
], { 'text.handoff': 'Нет подходящего варианта', 'search.handoff': 'support' } as never);

const scored = (scores: Record<string, number>): DialogSearch => ({
	rank: vi.fn(async (_tree: ContentTree, nodes: ContentNode[]) => nodes
		.filter(item => item.code in scores)
		.map(item => ({ node: item, score: scores[item.code] }))),
});

const check = (search: DialogSearch, text: string) => checkSearch(() => tree, search, DEFAULT_SEARCH_POLICY, text);

describe('проверка поиска', () => {
	it('ответит сразу', async () => {
		expect(await check(scored({ refund: 0.95, buy: 0.5 }), 'как вернуть билет')).toEqual({
			kind: 'answer',
			node: { id: 2, title: 'Возврат билета' },
		});
	});

	it('уточнит: варианты и пункт для тех, кому они не подошли', async () => {
		expect(await check(scored({ refund: 0.9, buy: 0.89 }), 'билет')).toEqual({
			kind: 'clarify',
			options: [{ id: 2, title: 'Возврат билета' }, { id: 3, title: 'Купить билет' }],
			handoff: 'Нет подходящего варианта',
		});
	});

	it('не поймет', async () => {
		expect(await check(scored({ refund: 0.1 }), 'сколько звезд на небе')).toEqual({ kind: 'none' });
	});

	it('служебное слово не считается вопросом и до поиска не доходит', async () => {
		const search = scored({ refund: 0.95 });

		expect(await check(search, 'меню')).toEqual({ kind: 'service' });
		expect(await check(search, 'Здравствуйте')).toEqual({ kind: 'service' });
		expect(search.rank).not.toHaveBeenCalled();
	});

	it('приветствие перед вопросом не мешает', async () => {
		expect((await check(scored({ refund: 0.95 }), 'Здравствуйте, как вернуть билет')).kind).toBe('answer');
	});

	it('проверки не влияют друг на друга: у каждой чистая память', async () => {
		const search = scored({ refund: 0.9, buy: 0.89 });

		await check(search, 'билет');

		// После уточнения номер выбрал бы вариант, а без памяти это просто непонятная фраза
		expect(await check(search, '1')).toEqual({ kind: 'none' });
	});
});
