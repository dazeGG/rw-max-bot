import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentTree, DEFAULT_SETTINGS } from '@rw/core';
import type { ContentNode } from '@rw/core';

import { buildPassages, createE5Search, E5_MODEL, E5_REVISION, E5Search } from './semantic-search';

const { pipelineMock } = vi.hoisted(() => ({ pipelineMock: vi.fn() }));
vi.mock('@huggingface/transformers', () => ({ pipeline: pipelineMock }));

const vector = (axis = 0): number[] => Array.from({ length: 384 }, (_, index) => Number(index === axis));
const node = (id: number, code: string, title: string, parentId: number | null, extra: Partial<ContentNode> = {}): ContentNode => ({
	id,
	code,
	title,
	parentId,
	type: 'section',
	text: null,
	url: null,
	targetId: null,
	image: null,
	file: null,
	fileName: null,
	synonyms: ['SECRET_LEGACY_SYNONYM'],
	sort: id * 10,
	isActive: true,
	isHidden: false,
	...extra,
});
const nodes = () => [
	node(1, 'root', 'Начало', null),
	node(2, 'transfer', 'Трансфер', 1),
	node(3, 'schedule', 'Расписание', 2, { text: '<b>Автобус</b> &amp; поезд' }),
	node(4, 'buy', 'Купить билет', 1),
	node(5, 'refund', 'Возврат талона', 1, { isHidden: true }),
	node(6, 'disabled', 'Неактивный раздел', 1, { isActive: false }),
];
const tree = () => new ContentTree(nodes(), DEFAULT_SETTINGS);
const encoder = () => vi.fn(async (texts: string[]) => texts.map(() => vector()));

beforeEach(() => {
	vi.clearAllMocks();
});

describe('E5 passages', () => {
	it('indexes headings and plain content, never legacy synonyms or inactive nodes', () => {
		const passages = buildPassages(tree());
		expect(passages.every(passage => passage.text.startsWith('passage: '))).toBe(true);
		expect(passages.map(passage => passage.text)).toContain('passage: Трансфер — Расписание. Автобус & поезд');
		expect(passages.some(passage => passage.text.includes('SECRET_LEGACY_SYNONYM'))).toBe(false);
		expect(passages.some(passage => passage.nodeId === 1 || passage.nodeId === 6)).toBe(false);
		expect(passages.some(passage => passage.nodeId === 5)).toBe(true);
	});

	it.each([
		'Абонемент оформляется по документу.\n\nКнигу можно продлить дистанционно.',
		'<p>Абонемент оформляется по документу.</p><p>Книгу можно продлить дистанционно.</p>',
		'<div>Абонемент оформляется по документу.</div><div>Книгу можно продлить дистанционно.</div>',
		'Абонемент оформляется по документу.<br>Книгу можно продлить дистанционно.',
		'<ul><li>Абонемент оформляется по документу.</li><li>Книгу можно продлить дистанционно.</li></ul>',
		'• Абонемент оформляется по документу.\n• Книгу можно продлить дистанционно.',
		'- Абонемент оформляется по документу.\n- Книгу можно продлить дистанционно.',
	])('indexes separate facts as separate passages: %s', text => {
		const content = new ContentTree([
			node(1, 'root', 'Начало', null),
			node(44, 'arbitrary-service', 'Библиотечные услуги', 1, { text }),
		], DEFAULT_SETTINGS);
		const passages = buildPassages(content).filter(passage => passage.kind === 'content').map(passage => passage.text);
		expect(passages).toEqual([
			'passage: Библиотечные услуги',
			'passage: Библиотечные услуги. Абонемент оформляется по документу.',
			'passage: Библиотечные услуги. Книгу можно продлить дистанционно.',
		]);
	});

	it('splits long paragraphs with overlap without merging adjacent facts', () => {
		const long = Array.from({ length: 160 }, (_, index) => `слово${index}`).join(' ');
		const content = new ContentTree([
			node(1, 'root', 'Начало', null),
			node(44, 'long-answer', 'Руководство', 1, { text: `${long}\n\nНезависимый короткий ответ.` }),
		], DEFAULT_SETTINGS);
		const passages = buildPassages(content).filter(passage => passage.kind === 'content').map(passage => passage.text);
		expect(passages.length).toBeGreaterThan(3);
		expect(passages.at(-1)).toBe('passage: Руководство. Независимый короткий ответ.');
		expect(passages.filter(text => text.includes('Независимый'))).toHaveLength(1);
		const first = passages[1].split(' ');
		const second = passages[2].split(' ');
		expect(second).toEqual(expect.arrayContaining(first.slice(-12)));
	});

	it('keeps generic links and goto aliases label-only while substantive link answers remain searchable', () => {
		const content = new ContentTree([
			...nodes(),
			node(7, 'external', 'Открыть сайт', 2, { type: 'link', url: 'https://example.test' }),
			node(8, 'answer-link', 'Инструкция', 2, { type: 'link', text: 'Подробная инструкция по настройке', url: 'https://example.test/help' }),
			node(9, 'alias', 'Вернуть покупку', 2, { type: 'goto', targetId: 5 }),
		], DEFAULT_SETTINGS);
		const passages = buildPassages(content);
		expect(passages.filter(passage => passage.nodeId === 7).map(passage => passage.kind)).toEqual(['label']);
		expect(passages.filter(passage => passage.nodeId === 9).map(passage => passage.kind)).toEqual(['label']);
		expect(passages.some(passage => passage.nodeId === 8 && passage.kind === 'content')).toBe(true);
		expect(passages.find(passage => passage.nodeId === 9)?.text).toBe('passage: Вернуть покупку');
	});
});

describe('E5 model setup', () => {
	it('uses the pinned CPU model and normalized mean-pooled embeddings without downloading in tests', async () => {
		const extractor = vi.fn(async (texts: string[]) => ({ tolist: () => texts.map(() => vector()) }));
		pipelineMock.mockResolvedValue(extractor);
		const search = await createE5Search();
		const content = tree();
		await search.rank(content, content.all(), 'вопрос');

		expect(pipelineMock).toHaveBeenCalledWith('feature-extraction', E5_MODEL, expect.objectContaining({
			revision: E5_REVISION, device: 'cpu', dtype: 'q8',
		}));
		expect(extractor).toHaveBeenCalledWith(['query: вопрос'], { pooling: 'mean', normalize: true });
	});
});

describe('E5 index lifecycle', () => {
	it('reuses one prepared index for the same immutable tree and reindexes a new tree', async () => {
		const encode = encoder();
		const search = new E5Search(encode);
		const first = tree();
		const batches = Math.ceil(buildPassages(first).length / 8);
		await Promise.all([search.prepare(first), search.prepare(first)]);
		await search.rank(first, first.all(), 'первый вопрос');
		await search.rank(first, first.all(), 'другой вопрос');
		expect(encode.mock.calls.filter(([texts]) => texts[0].startsWith('passage: '))).toHaveLength(batches);
		expect(encode.mock.calls.filter(([texts]) => texts[0].startsWith('query: '))).toHaveLength(2);

		const changed = new ContentTree(nodes().map(item => item.id === 3 ? { ...item, text: 'Новое расписание' } : item), DEFAULT_SETTINGS);
		await search.prepare(changed);
		expect(encode.mock.calls.filter(([texts]) => texts[0].startsWith('passage: '))).toHaveLength(batches * 2);
		expect(encode.mock.calls.slice(-batches).some(([texts]) => texts.some(text => text.includes('Новое расписание')))).toBe(true);
	});

	it('does not permanently cache a rejected index', async () => {
		const encode = encoder().mockRejectedValueOnce(new Error('index unavailable'));
		const search = new E5Search(encode);
		const content = tree();
		await expect(search.prepare(content)).rejects.toThrow('index unavailable');
		await expect(search.prepare(content)).resolves.toBeUndefined();
		expect(encode).toHaveBeenCalledTimes(1 + Math.ceil(buildPassages(content).length / 8));
	});

	it('serializes concurrent encoder work instead of running multiple inference jobs', async () => {
		let started!: () => void;
		let release!: () => void;
		const firstStarted = new Promise<void>(resolve => {
			started = resolve;
		});
		const releaseFirst = new Promise<void>(resolve => {
			release = resolve;
		});
		let active = 0;
		let maxActive = 0;
		const encode = vi.fn(async (texts: string[]) => {
			active++;
			maxActive = Math.max(active, maxActive);
			if (encode.mock.calls.length === 1) {
				started();
				await releaseFirst;
			}
			active--;
			return texts.map(() => vector());
		});
		const search = new E5Search(encode);
		const first = search.prepare(tree());
		const second = search.prepare(tree());
		await firstStarted;
		expect(encode).toHaveBeenCalledTimes(1);
		release();
		await Promise.all([first, second]);
		expect(encode).toHaveBeenCalledTimes(Math.ceil(buildPassages(tree()).length / 8) * 2);
		expect(maxActive).toBe(1);
	});
});

describe('E5 ranking', () => {
	it('returns only allowed active candidates and still supports hidden searchable sections', async () => {
		const content = tree();
		const search = new E5Search(encoder());
		const allowed = [content.getByCode('refund')!, nodes()[5]];
		const ranked = await search.rank(content, allowed, 'вернуть талон');
		expect(ranked.map(candidate => candidate.node.code)).toEqual(['refund']);
		expect(ranked[0].score).toBeCloseTo(1);
	});

	it('isolates label evidence from knowledge content without boosting either score', async () => {
		const encode = vi.fn(async (texts: string[]) => texts.map(text =>
			text.startsWith('query: ') || text === 'passage: Расписание' ? vector(0) : vector(1)));
		const search = new E5Search(encode);
		const content = tree();
		const allowed = [content.getByCode('schedule')!];
		const global = await search.rank(content, allowed, 'расписание');
		const options = await search.rank(content, allowed, 'расписание', 'options');
		expect(global[0].score).toBe(0);
		expect(options[0].score).toBe(1);
		expect(encode.mock.calls.filter(([texts]) => texts[0].startsWith('query: ')).map(([texts]) => texts)).toEqual([
			['query: расписание'], ['query: расписание'],
		]);
	});

	it.each([
		['хочу купить билет в другой город', undefined],
		['расписание', 'options'],
		['как настроить подключение к сети', 'options'],
	] as const)('encodes only the unchanged question «%s» in mode %s', async (question, mode) => {
		const encode = encoder();
		const search = new E5Search(encode);
		const content = tree();
		await search.rank(content, content.all(), question, mode);
		expect(encode.mock.calls.at(-1)?.[0]).toEqual([`query: ${question}`]);
	});

	it('returns a navigation-only link only when it is an explicit supplied option', async () => {
		const content = new ContentTree([
			...nodes(),
			node(7, 'external', 'Открыть сайт', 2, { type: 'link', url: 'https://example.test' }),
		], DEFAULT_SETTINGS);
		const search = new E5Search(encoder());
		const allowed = [content.getByCode('external')!];
		expect(await search.rank(content, allowed, 'Открыть сайт')).toEqual([]);
		expect((await search.rank(content, allowed, 'Открыть сайт', 'options')).map(candidate => candidate.node.code)).toEqual(['external']);
	});

	it('does not run inference for empty questions or an empty candidate list', async () => {
		const encode = encoder();
		const search = new E5Search(encode);
		const content = tree();
		expect(await search.rank(content, content.all(), '  ')).toEqual([]);
		expect(await search.rank(content, [], 'вопрос')).toEqual([]);
		expect(encode).not.toHaveBeenCalled();
	});

	it('propagates encoder failures even for exact titles and legacy synonyms, without lexical fallback', async () => {
		const encode = vi.fn(async (texts: string[]) => {
			if (texts[0].startsWith('query: ')) {
				throw new Error('model offline');
			}
			return texts.map(() => vector());
		});
		const search = new E5Search(encode);
		const content = tree();
		for (const question of ['Купить билет', 'SECRET_LEGACY_SYNONYM']) {
			await expect(search.rank(content, content.all(), question)).rejects.toThrow('model offline');
		}
	});

	it.each([
		['wrong dimensions', [1, 0]],
		['non-finite values', vector().map((value, index) => index === 1 ? Number.NaN : value)],
	])('rejects invalid embeddings: %s', async (_, invalid) => {
		const search = new E5Search(async texts => texts.map(() => invalid));
		await expect(search.prepare(tree())).rejects.toThrow('Invalid E5 embeddings');
	});

	it('rejects a vector count that does not match the encoded texts', async () => {
		const search = new E5Search(async () => []);
		await expect(search.prepare(tree())).rejects.toThrow('Invalid E5 embeddings');
	});
});
