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
		await Promise.all([search.prepare(first), search.prepare(first)]);
		await search.rank(first, first.all(), 'первый вопрос');
		await search.rank(first, first.all(), 'другой вопрос');
		expect(encode.mock.calls.filter(([texts]) => texts[0].startsWith('passage: '))).toHaveLength(1);
		expect(encode.mock.calls.filter(([texts]) => texts[0].startsWith('query: '))).toHaveLength(2);

		const changed = new ContentTree(nodes().map(item => item.id === 3 ? { ...item, text: 'Новое расписание' } : item), DEFAULT_SETTINGS);
		await search.prepare(changed);
		expect(encode.mock.calls.filter(([texts]) => texts[0].startsWith('passage: '))).toHaveLength(2);
		expect(encode.mock.calls.at(-1)?.[0].some(text => text.includes('Новое расписание'))).toBe(true);
	});

	it('does not permanently cache a rejected index', async () => {
		const encode = encoder().mockRejectedValueOnce(new Error('index unavailable'));
		const search = new E5Search(encode);
		const content = tree();
		await expect(search.prepare(content)).rejects.toThrow('index unavailable');
		await expect(search.prepare(content)).resolves.toBeUndefined();
		expect(encode).toHaveBeenCalledTimes(2);
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
		expect(encode).toHaveBeenCalledTimes(2);
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

	it('uses the contextual query only for short replies and nodes inside that branch', async () => {
		const encode = vi.fn(async (texts: string[]) => texts.map(text =>
			text === 'query: расписание' ? vector(0) : vector(1)));
		const search = new E5Search(encode);
		const content = tree();
		const ranked = await search.rank(content, content.all(), 'расписание', content.getByCode('transfer'));
		expect(encode.mock.calls.at(-1)?.[0]).toEqual(['query: расписание', 'query: Трансфер. расписание']);
		expect(ranked.find(candidate => candidate.node.code === 'schedule')?.score).toBe(1);
		expect(ranked.find(candidate => candidate.node.code === 'transfer')?.score).toBe(0);
		expect(ranked.find(candidate => candidate.node.code === 'buy')?.score).toBe(0);
	});

	it.each([
		['хочу купить билет в другой город', 'transfer'],
		['расписание', 'root'],
	])('does not add contextual text for «%s» in %s', async (question, contextCode) => {
		const encode = encoder();
		const search = new E5Search(encode);
		const content = tree();
		await search.rank(content, content.all(), question, content.getByCode(contextCode));
		expect(encode.mock.calls.at(-1)?.[0]).toEqual([`query: ${question}`]);
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
