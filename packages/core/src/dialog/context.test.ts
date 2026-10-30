import { describe, expect, it, vi } from 'vitest';

import { ContentTree } from '../content/tree';
import { DEFAULT_SETTINGS } from '../content/types';
import type { ContentNode } from '../content/types';

import { DialogEngine } from './engine';
import { MemorySessionStore } from './memory-sessions';
import { DEFAULT_SEARCH_POLICY } from './search';
import type { Candidate } from './search';

// Deliberately unrelated domain, opaque identifiers and nonsequential IDs.
// Only synthetic search evidence is injected; no railway words/codes or lexical router.
const item = (id: number, code: string, parentId: number | null, title: string, text: string | null, extra: Partial<ContentNode> = {}): ContentNode => ({
	id,
	code,
	parentId,
	title,
	text,
	type: 'section',
	url: null,
	targetId: null,
	image: null,
	imageText: null,
	file: null,
	fileName: null,
	synonyms: [],
	sort: id,
	isActive: true,
	isHidden: false,
	...extra,
});
const fixture = () => {
	const root = item(7019, 'root', null, 'Помощник библиотеки', 'Чем Вам помочь?');
	const registration = item(9027, 'n4', root.id, 'Запись в библиотеку', 'Как Вам удобнее оформить читательский билет?');
	const online = item(367, 'q9', registration.id, 'Онлайн', 'Заполните электронную анкету читателя.');
	const desk = item(812, 'j2', registration.id, 'Лично', 'Приходите с паспортом на стойку регистрации.');
	const books = item(5412, 'm6', root.id, 'Продление книг', 'Срок возврата можно продлить на 14 дней.');
	const hours = item(12888, 'z7', root.id, 'Часы работы', 'Библиотека открыта с 10 до 19 часов.');
	const address = item(2843, 'c5', root.id, 'Адрес библиотеки', 'Улица Лесная, дом 5.');
	const map = item(620, 'r8', address.id, 'Открыть на карте', null, { type: 'link', url: 'https://example.org/map' });
	const article = item(633, 'h1', root.id, 'Электронный каталог', 'В электронном каталоге можно искать книги по автору и названию.', { type: 'link', url: 'https://example.org/catalog' });
	const shortcut = item(7777, 't3', registration.id, 'Уже есть читательский билет', null, { type: 'goto', targetId: books.id });
	const tree = new ContentTree([root, registration, online, desk, books, hours, address, map, article, shortcut], DEFAULT_SETTINGS);
	const sessions = new MemorySessionStore();
	const rank = vi.fn<(tree: ContentTree, nodes: ContentNode[], text: string, mode?: unknown) => Promise<Candidate[]>>().mockResolvedValue([]);
	const engine = new DialogEngine(() => tree, sessions, { rank });
	const user = { id: 117 };
	const say = (text: string) => engine.process(user, { type: 'text', text });
	const results = (...entries: Array<[ContentNode, number]>): Candidate[] => entries.map(([node, score]) => ({ node, score }));
	return { root, registration, online, desk, books, hours, address, map, article, shortcut, tree, sessions, rank, engine, user, say, results };
};

describe('content-independent conversation state', () => {
	it('stores exactly the options actually displayed by opening a question', async () => {
		const f = fixture();
		f.rank.mockResolvedValue(f.results([f.registration, 0.96]));
		const result = await f.say('Как зарегистрироваться в библиотеке?');
		const expected = f.tree.visibleChildren(f.registration).map(node => node.id);

		expect(result.event.nodeCode).toBe(f.registration.code);
		expect((await f.sessions.get(f.user.id)).choices).toEqual(expected);
		expect(result.replies[0].text).toContain('Как Вам удобнее оформить читательский билет?');
	});

	it('opening the root persists its displayed numeric options, without making it a domain', async () => {
		const f = fixture();
		await f.engine.process(f.user, { type: 'start' });
		expect((await f.sessions.get(f.user.id)).choices).toEqual(f.tree.visibleChildren(f.root).map(node => node.id));
		expect(f.rank).not.toHaveBeenCalled();
	});

	it('a completed nested answer never supplies its parent as semantic context for the next short question', async () => {
		const f = fixture();
		await f.sessions.set(f.user.id, { nodeId: f.online.id, choices: [] });
		f.rank.mockResolvedValue(f.results([f.books, 0.96]));
		const result = await f.say('продление');

		expect(result.event).toMatchObject({ type: 'answer', nodeCode: f.books.code });
		expect(f.rank.mock.calls.every(call => call[3] === undefined)).toBe(true);
		expect(f.rank.mock.calls.every(call => call[2] === 'продление')).toBe(true);
	});

	it('a number after a completed leaf cannot choose an inherited sibling that was not shown', async () => {
		const f = fixture();
		await f.sessions.set(f.user.id, { nodeId: f.online.id, choices: [] });
		const result = await f.say('2');

		expect(result.event.type).toBe('unrecognized');
		expect(result.event.nodeCode).not.toBe(f.desk.code);
		expect(f.rank).not.toHaveBeenCalled();
	});

	it('numeric choices use stored displayed IDs, not the current node children or sort order', async () => {
		const f = fixture();
		await f.sessions.set(f.user.id, { nodeId: f.registration.id, choices: [f.books.id] });
		const result = await f.say('1');

		expect(result.event).toMatchObject({ type: 'option', nodeCode: f.books.code });
		expect(f.rank).not.toHaveBeenCalled();
	});

	it.each(['removed', 'disabled'])('keeps displayed numeric positions when the second option is %s', async state => {
		const f = fixture();
		const changed = f.tree.all().flatMap(node => {
			if (node.id !== f.desk.id) {
				return [node];
			}
			return state === 'removed' ? [] : [{ ...node, isActive: false }];
		});
		const newTree = new ContentTree(changed, DEFAULT_SETTINGS);
		const engine = new DialogEngine(() => newTree, f.sessions, { rank: f.rank });
		const displayed = [f.online.id, f.desk.id, f.shortcut.id];

		await f.sessions.set(f.user.id, { nodeId: f.registration.id, choices: displayed });
		const missing = await engine.process(f.user, { type: 'text', text: '2' });
		expect(missing.event.type).toBe('unrecognized');
		expect(missing.event.nodeCode).not.toBe(f.books.code);

		await f.sessions.set(f.user.id, { nodeId: f.registration.id, choices: displayed });
		const third = await engine.process(f.user, { type: 'text', text: '3' });
		expect(third.event).toMatchObject({ type: 'option', nodeCode: f.books.code });
		expect(f.rank).not.toHaveBeenCalled();
	});

	it('resource links do not keep an answered question semantically pending', async () => {
		const f = fixture();
		f.rank.mockResolvedValue(f.results([f.address, 0.97]));
		const address = await f.say('Адрес библиотеки');

		expect(address.replies.at(-1)?.text).toBe(DEFAULT_SETTINGS['text.anythingElse']);
		expect((await f.sessions.get(f.user.id)).choices).toEqual([f.map.id]);
		f.rank.mockClear().mockResolvedValue(f.results([f.books, 0.96]));
		const next = await f.say('продление');
		expect(next.event.nodeCode).toBe(f.books.code);
		expect(f.rank.mock.calls.every(call => call[3] === undefined)).toBe(true);
	});
});

describe('content-independent semantic arbitration', () => {
	it('global search excludes navigation-only links and goto but keeps meaningful linked content', async () => {
		const f = fixture();
		await f.sessions.set(f.user.id, { nodeId: f.registration.id, choices: f.tree.visibleChildren(f.registration).map(node => node.id) });
		await f.say('Совсем новый вопрос');
		const global = f.rank.mock.calls.find(call => call[3] === undefined);
		expect(global).toBeDefined();
		expect(global![1].map(node => node.id)).not.toContain(f.map.id);
		expect(global![1].map(node => node.id)).not.toContain(f.shortcut.id);
		expect(global![1].map(node => node.id)).toContain(f.article.id);
	});

	it('long answers to a pending question can use explicit option-label ranking, without query rewriting', async () => {
		const f = fixture();
		await f.sessions.set(f.user.id, { nodeId: f.registration.id, choices: [f.online.id, f.desk.id] });
		f.rank.mockImplementation(async (_tree, _nodes, _text, mode) => mode === 'options'
			? f.results([f.online, 0.98], [f.desk, 0.5])
			: f.results([f.registration, 0.6]));
		const text = 'пожалуйста оформите мне читательский билет полностью через интернет';
		const result = await f.say(text);
		const scoped = f.rank.mock.calls.filter(call => call[3] === 'options');

		expect(result.event).toMatchObject({ type: 'answer', nodeCode: f.online.code });
		expect(scoped.length).toBeGreaterThan(0);
		expect(scoped.every(call => call[1].map(node => node.id).join(',') === [f.online.id, f.desk.id].join(','))).toBe(true);
		expect(f.rank.mock.calls.every(call => call[2] === text)).toBe(true);
		expect(f.rank.mock.calls.every(call => call[3] === undefined || call[3] === 'options')).toBe(true);
	});

	it('a clear new global topic is never silently overridden by a conflicting local label score', async () => {
		const f = fixture();
		await f.sessions.set(f.user.id, { nodeId: f.registration.id, choices: [f.online.id, f.desk.id] });
		f.rank.mockImplementation(async (_tree, _nodes, _text, mode) => mode === 'options'
			? f.results([f.online, 0.99], [f.desk, 0.5])
			: f.results([f.books, 0.95], [f.registration, 0.7]));
		const result = await f.say('Продление книг');

		expect(result.event.type).not.toBe('unrecognized');
		if (result.event.type === 'clarify') {
			expect(result.event.details.suggested).toContain(f.books.code);
		} else {
			expect(result.event.nodeCode).toBe(f.books.code);
		}
	});

	it('a runner-up just below the acceptance cutoff cannot create false confidence in a near-tied winner', async () => {
		const f = fixture();
		f.rank.mockResolvedValue(f.results([f.books, DEFAULT_SEARCH_POLICY.threshold + 0.003], [f.hours, DEFAULT_SEARCH_POLICY.threshold - 0.002]));
		const result = await f.say('Неоднозначный вопрос');

		expect(result.event.type).not.toBe('answer');
	});

	it('preserves meaning-bearing symbols in independent inference queries', async () => {
		const f = fixture();
		f.rank.mockResolvedValue(f.results([f.books, 0.97]));
		await f.say('C++');
		await f.say('C#');

		const rawQueries = f.rank.mock.calls.filter(call => call[3] === undefined).map(call => call[2]);
		expect(rawQueries).toEqual(['C++', 'C#']);
	});

	it('ambiguous siblings open their shared question when its semantic evidence is also close', async () => {
		const f = fixture();
		f.rank.mockResolvedValue(f.results([f.online, 0.91], [f.desk, 0.905], [f.registration, 0.9]));
		const result = await f.say('Как можно записаться?');

		expect(result.event).toMatchObject({ type: 'answer', nodeCode: f.registration.code });
		expect(result.replies[0].text).toContain(f.registration.text);
	});

	it('nested competing menus cannot eliminate every candidate and silently resurrect a confident leaf', async () => {
		const root = item(7019, 'root', null, 'Помощник мастерской', 'Чем Вам помочь?');
		const outer = item(302, 'u11', root.id, 'Ремонт оборудования', 'Какое устройство нужно отремонтировать?');
		const inner = item(508, 'p15', outer.id, 'Ремонт компьютера', 'Какой ремонт компьютера нужен?');
		const screen = item(70, 'y04', inner.id, 'Замена экрана', 'Принесите компьютер для замены экрана.');
		const keyboard = item(912, 'k22', inner.id, 'Замена клавиатуры', 'Принесите компьютер для замены клавиатуры.');
		const tree = new ContentTree([root, outer, inner, screen, keyboard], DEFAULT_SETTINGS);
		const rank = vi.fn(async (): Promise<Candidate[]> => [
			{ node: screen, score: 0.910 }, { node: outer, score: 0.900 },
			{ node: keyboard, score: 0.899 }, { node: inner, score: 0.890 },
		]);
		const engine = new DialogEngine(() => tree, new MemorySessionStore(), { rank });
		const { event } = await engine.process({ id: 117 }, { type: 'text', text: 'Нужен ремонт компьютера' });

		if (event.type === 'answer') {
			expect(event.nodeCode).toBe(inner.code);
		} else {
			expect(event.type).toBe('clarify');
			const suggestions = event.details.suggested ?? [];
			expect(suggestions.length).toBeGreaterThan(1);
			expect(suggestions.includes(inner.code) || (suggestions.includes(screen.code) && suggestions.includes(keyboard.code))).toBe(true);
		}
	});
});
