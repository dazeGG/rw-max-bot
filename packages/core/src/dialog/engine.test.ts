import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { flattenSeed, SEED_SETTINGS } from '../content/seed-data';
import { ContentTree } from '../content/tree';

import { DialogEngine } from './engine';
import { MemorySessionStore } from './memory-sessions';
import { DEFAULT_SEARCH_POLICY } from './search';
import type { Candidate, DialogSearch } from './search';
import type { UnrecognizedEvent } from './types';

const tree = new ContentTree(flattenSeed(), SEED_SETTINGS);
const user = { id: 42 };
const node = (code: string) => tree.getByCode(code)!;
const candidates = (...items: Array<[string, number]>): Candidate[] => items.map(([code, score]) => ({ node: node(code), score }));
const options = (text: string) => text.split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));

let sessions: MemorySessionStore;
let unrecognized: UnrecognizedEvent[];
let rank: Mock<DialogSearch['rank']>;
let engine: DialogEngine;

const currentCode = async () => tree.get((await sessions.get(user.id)).nodeId)?.code;
const say = (text: string) => engine.process(user, { type: 'text', text });
const at = (code: string, choices: string[] = []) => sessions.set(user.id, { nodeId: node(code).id, choices: choices.map(code => node(code).id) });

beforeEach(async () => {
	sessions = new MemorySessionStore();
	unrecognized = [];
	rank = vi.fn<DialogSearch['rank']>().mockResolvedValue([]);
	engine = new DialogEngine(() => tree, sessions, { rank }, { onUnrecognized: event => void unrecognized.push(event) });
	await engine.handle(user, { type: 'start' });
});

describe('контракт семантического поиска', () => {
	it('свободный вопрос выбирает только результат внедрённого поиска', async () => {
		rank.mockResolvedValue(candidates(['faq-storage', 0.91234]));
		const { event, replies } = await say('Где оставить чемодан?');

		expect(event).toMatchObject({ type: 'answer', nodeCode: 'faq-storage', text: 'Где оставить чемодан?' });
		expect(event.details).toMatchObject({ fromNodeCode: 'root', normalized: 'где оставить чемодан', candidates: [{ code: 'faq-storage', score: 0.912 }] });
		expect(replies[0].text).toBe(node('faq-storage').text);
		expect(rank).toHaveBeenCalledOnce();
		expect(rank.mock.calls[0][2]).toBe('Где оставить чемодан?');
		expect(rank.mock.calls[0][3]).toBeUndefined();
	});

	it('совпадение с названием или прежним синонимом не заменяет результат модели', async () => {
		const { event } = await say('купить билет');

		expect(event.type).toBe('unrecognized');
		expect(await currentCode()).toBe('root');
		expect(rank).toHaveBeenCalledOnce();
	});

	it('низкая оценка означает непонятый запрос и сохраняется в статистике', async () => {
		rank.mockResolvedValue(candidates(['support', 0.6]));
		const { event, replies } = await say('вопрос вне справочника');

		expect(event).toMatchObject({ type: 'unrecognized', details: { candidates: [{ code: 'support', score: 0.6 }] } });
		expect(replies[0].text).toContain(SEED_SETTINGS['text.fallback']);
		expect(options(replies[0].text)).toContain('Купить билет');
		expect(unrecognized).toEqual([{ userId: user.id, text: 'вопрос вне справочника', nodeId: tree.root.id }]);
	});

	it('оценки сортируются по сходству, а не порядку разделов или результатов', async () => {
		rank.mockResolvedValue(candidates(['buy', 0.82], ['support', 0.94]));

		expect((await say('вопрос')).event).toMatchObject({ type: 'answer', nodeCode: 'support' });
	});

	it('порог и зазор неоднозначности задаются политикой поиска', async () => {
		const local = new DialogEngine(() => tree, sessions, { rank }, {}, { threshold: 0.7, ambiguityGap: 0.01 });
		rank.mockResolvedValue(candidates(['support', 0.75]));

		expect((await local.process(user, { type: 'text', text: 'вопрос' })).event.nodeCode).toBe('support');
	});

	it('близкие оценки дают уточнение и сохраняют варианты', async () => {
		rank.mockResolvedValue(candidates(['support', 0.9], ['question', 0.895]));
		const { event, replies } = await say('помогите разобраться');

		expect(event).toMatchObject({ type: 'clarify', nodeCode: 'root', details: { suggested: ['support', 'question'] } });
		expect(replies[0].text).toContain(SEED_SETTINGS['text.didYouMean']);
		expect((await sessions.get(user.id)).choices).toEqual([node('support').id, node('question').id]);
	});

	it('близкий конкурент ниже порога не превращает победителя в уверенный ответ', async () => {
		rank.mockResolvedValue(candidates(['support', DEFAULT_SEARCH_POLICY.threshold + 0.005], ['question', DEFAULT_SEARCH_POLICY.threshold - 0.001]));

		expect((await say('вопрос')).event).toMatchObject({ type: 'clarify', details: { suggested: ['support', 'question'] } });
	});

	it('разные переходы в один ответ не создают неоднозначности', async () => {
		await at('refund');
		rank.mockResolvedValue(candidates(['refund-train', 0.9], ['faq-refund', 0.895]));

		expect((await say('на поезд')).event).toMatchObject({ type: 'answer', nodeCode: 'faq-refund' });
	});

	it('уточняющий раздел поглощает свои варианты ответа', async () => {
		rank.mockResolvedValue(candidates(['refund', 0.9], ['faq-refund', 0.895], ['transfer-refund', 0.89]));

		expect((await say('вернуть покупку')).event).toMatchObject({ type: 'answer', nodeCode: 'refund' });
	});

	it('более точный дочерний ответ не заменяется менее уверенным родительским разделом', async () => {
		rank.mockResolvedValue(candidates(['buy-online', 0.895], ['buy', 0.877]));

		expect((await say('как купить билеты онлайн')).event).toMatchObject({ type: 'answer', nodeCode: 'buy-online' });
	});

	it('более уверенный ответ поезда не поглощается общим вопросом о возврате через goto', async () => {
		rank.mockResolvedValue(candidates(['faq-refund', 0.873], ['refund', 0.868]));

		expect((await say('вернуть билет на поезд')).event).toMatchObject({ type: 'answer', nodeCode: 'faq-refund' });
	});

	it('при равных оценках родительский вопрос предпочтительнее его варианта', async () => {
		rank.mockResolvedValue(candidates(['buy-online', 0.9], ['buy', 0.9]));

		expect((await say('покупка')).event).toMatchObject({ type: 'answer', nodeCode: 'buy' });
	});

	it('более уверенный раздел поглощает внука, даже если промежуточного раздела нет среди кандидатов', async () => {
		rank.mockResolvedValue(candidates(['transfer', 0.89], ['transfer-privileges-pensioners', 0.88]));

		expect((await say('трансфер')).event).toMatchObject({ type: 'answer', nodeCode: 'transfer' });
	});

	it('более уверенный внук сохраняется вместо общего раздела', async () => {
		rank.mockResolvedValue(candidates(['transfer-privileges-pensioners', 0.89], ['transfer', 0.88]));

		expect((await say('трансфер для пенсионера')).event).toMatchObject({ type: 'answer', nodeCode: 'transfer-privileges-pensioners' });
	});

	it('goto обратно в родителя не удаляет самого родителя из вариантов уточнения', async () => {
		const changed = flattenSeed().map(item => item.code === 'refund-train' ? { ...item, targetId: node('refund').id } : item);
		const localTree = new ContentTree(changed, SEED_SETTINGS);
		const local = new DialogEngine(() => localTree, new MemorySessionStore(), { rank });
		rank.mockResolvedValue(candidates(['refund', 0.91], ['support', 0.9]));
		const { event } = await local.process(user, { type: 'text', text: 'вопрос' });

		expect(event.type).toBe('clarify');
		expect(event.details.suggested).toEqual(['refund', 'support']);
	});

	it('новый вопрос во время уточнения может уйти в другую тему', async () => {
		await at('root', ['support', 'question']);
		rank.mockResolvedValue(candidates(['faq-pets', 0.91]));

		expect((await say('можно ли ехать с собакой')).event).toMatchObject({ type: 'answer', nodeCode: 'faq-pets' });
	});

	it('ответ на явное уточнение может выбрать вариант с независимым подтверждением подписи', async () => {
		await at('root', ['support', 'question']);
		rank.mockImplementation(async (_tree, _nodes, _text, mode) => mode === 'options'
			? candidates(['support', 0.98], ['question', 0.5])
			: candidates(['buy', 0.91], ['support', 0.9], ['question', 0.85]));

		expect((await say('телефон')).event).toMatchObject({ type: 'answer', nodeCode: 'support' });
	});

	it('короткий ответ не удерживается в уточнении при заметно лучшем глобальном результате', async () => {
		await at('root', ['support', 'question']);
		rank.mockResolvedValue(candidates(['faq-pets', 0.94], ['support', 0.88]));

		expect((await say('с собакой')).event).toMatchObject({ type: 'answer', nodeCode: 'faq-pets' });
	});

	it('прежний вариант около порога остаётся признаком неоднозначности, но не уверенным ответом', async () => {
		await at('root', ['support', 'question']);
		rank.mockImplementation(async (_tree, _nodes, _text, mode) => mode === 'options'
			? candidates(['support', 0.5])
			: candidates(['buy', DEFAULT_SEARCH_POLICY.threshold + 0.005], ['support', DEFAULT_SEARCH_POLICY.threshold - 0.001]));

		expect((await say('билет')).event).toMatchObject({ type: 'clarify', details: { suggested: ['buy', 'support'] } });
	});

	it('новый вопрос не сужается до прежних вариантов без подтверждения их подписей', async () => {
		await at('root', ['support', 'question']);
		rank.mockImplementation(async (_tree, _nodes, _text, mode) => mode === 'options'
			? candidates(['support', 0.5], ['question', 0.4])
			: candidates(['faq-pets', 0.91], ['support', 0.905]));
		const { event } = await say('как мне ехать с большой собакой');

		expect(event.type).toBe('clarify');
		expect(event.details.suggested).toEqual(['faq-pets', 'support']);
	});

	it('глобальный поиск получает исходный вопрос без текущего раздела и прибавок', async () => {
		await at('transfer');
		rank.mockResolvedValue(candidates(['transfer-schedule', 0.88]));
		const { event } = await say('а когда отправление');

		expect(rank.mock.calls[0][2]).toBe('а когда отправление');
		expect(rank.mock.calls[0][3]).toBeUndefined();
		expect(event.details.candidates).toEqual([{ code: 'transfer-schedule', score: 0.88 }]);
	});

	it('после конечного ответа родительский раздел не передаётся как контекст', async () => {
		await at('transfer-schedule');
		await say('а сколько стоит');

		expect(rank.mock.calls.every(call => call[3] === undefined)).toBe(true);
	});

	it('корень, неактивные разделы и несвязанные goto не включаются в поиск', async () => {
		await say('вопрос');
		const passed = rank.mock.calls[0][1].map(item => item.code);

		expect(passed).not.toContain('root');
		expect(passed).not.toContain('schedule-train-321322');
		expect(passed).not.toContain('refund-train');
	});

	it('goto доступен только как явно показанный вариант, а не глобальное знание', async () => {
		await at('refund', ['refund-train', 'refund-transfer']);
		rank.mockImplementation(async (_tree, _nodes, _text, mode) => mode === 'options'
			? candidates(['refund-train', 0.97], ['refund-transfer', 0.5])
			: []);
		const { event } = await say('железнодорожный');
		const global = rank.mock.calls.find(call => call[3] === undefined);
		const scoped = rank.mock.calls.find(call => call[3] === 'options');

		expect(global?.[1].map(item => item.code)).not.toContain('refund-train');
		expect(scoped?.[1].map(item => item.code)).toEqual(['refund-train', 'refund-transfer']);
		expect(event).toMatchObject({ type: 'answer', nodeCode: 'faq-refund' });
	});

	it('посторонние узлы и нечисловые оценки не могут быть выбраны', async () => {
		rank.mockResolvedValue([{ node: tree.root, score: 1 }, ...candidates(['support', Number.NaN])]);

		expect((await say('вопрос')).event.type).toBe('unrecognized');
	});

	it('ошибка модели не запускает старый поиск и не меняет сессию', async () => {
		await at('transfer');
		rank.mockRejectedValue(new Error('E5 unavailable'));

		await expect(say('купить билет')).rejects.toThrow('E5 unavailable');
		expect(await currentCode()).toBe('transfer');
		expect(unrecognized).toEqual([]);
	});
});

describe('протокольная навигация не требует модели', () => {
	it('слова с показанной кнопки выбирают её, как номер', async () => {
		await at('tariffs', ['tariffs-yakutia', 'tariffs-rzd']);
		const { event } = await say('Ждя');

		expect(event).toMatchObject({ type: 'option', nodeCode: 'tariffs-yakutia', details: { labelMatch: true } });
		expect(rank).not.toHaveBeenCalled();
	});

	it('слова из нескольких кнопок дают уточнение только между ними', async () => {
		await at('schedule-traffic', ['schedule-traffic-327', 'schedule-traffic-328', 'schedule-traffic-317', 'schedule-traffic-318']);
		const { event } = await say('Тында');

		expect(event).toMatchObject({ type: 'clarify', details: { labelMatch: true, suggested: ['schedule-traffic-327', 'schedule-traffic-328'] } });
		expect(rank).not.toHaveBeenCalled();
	});

	it('новый вопрос с лишними словами и текст на главном меню ищутся моделью', async () => {
		await at('tariffs', ['tariffs-yakutia', 'tariffs-rzd']);
		await say('сколько стоит в вагонах ЖДЯ');
		expect(rank).toHaveBeenCalled();

		rank.mockClear();
		await engine.process(user, { type: 'start' });
		await say('Тарифы');
		expect(rank).toHaveBeenCalled();
	});

	it('start и чистое приветствие открывают главное меню', async () => {
		const start = await engine.process(user, { type: 'start' });
		expect(start.event).toEqual({ type: 'start', nodeId: tree.root.id, nodeCode: 'root', text: null, details: {} });
		expect((await say('Добрый день!')).event.type).toBe('start');
		expect(rank).not.toHaveBeenCalled();
	});

	it('приветствие с вопросом сохраняется перед ответом', async () => {
		rank.mockResolvedValue(candidates(['buy', 0.9]));
		const { replies, event } = await say('Здравствуйте, где купить билет?');

		expect(replies).toHaveLength(2);
		expect(replies[0].text).toBe(SEED_SETTINGS['text.greeting']);
		expect(event.details.greeting).toBe(true);
	});

	it('назад и меню перемещают по дереву', async () => {
		await at('schedule-trains');
		expect((await say('назад')).event).toMatchObject({ type: 'back', nodeCode: 'schedule' });
		expect((await say('меню')).event).toMatchObject({ type: 'menu', nodeCode: 'root' });
		expect(rank).not.toHaveBeenCalled();
	});

	it('номер выбирает явно показанный пункт текущего раздела', async () => {
		await at('transfer', tree.visibleChildren(node('transfer')).map(item => item.code));
		expect((await say('1')).event).toMatchObject({ type: 'option', nodeCode: 'transfer-schedule', details: { option: 1 } });
		expect(rank).not.toHaveBeenCalled();
	});

	it('номер с точкой выбирает из вариантов уточнения', async () => {
		await at('root', ['support', 'question']);
		expect((await say('2.')).event).toMatchObject({ type: 'option', nodeCode: 'question', details: { shown: ['support', 'question'] } });
		expect(rank).not.toHaveBeenCalled();
	});

	it('после конечного ответа номер не воскрешает непоказанный список родителя', async () => {
		await at('buy-tommot');
		expect((await say('2')).event).toMatchObject({ type: 'unrecognized', details: { shown: [], unmatchedOption: 2 } });
		expect(rank).not.toHaveBeenCalled();
	});

	it('номер вне списка не ищется моделью', async () => {
		await at('transfer');
		expect((await say('99')).event).toMatchObject({ type: 'unrecognized', details: { unmatchedOption: 99, candidates: [] } });
		expect(await currentCode()).toBe('root');
		expect(rank).not.toHaveBeenCalled();
	});

	it('трёхзначный номер поезда передаётся модели как текст', async () => {
		await say('327');
		expect(rank.mock.calls[0][2]).toBe('327');
	});

	it('после fallback номер открывает тему главного меню', async () => {
		const { replies } = await say('неизвестный вопрос');
		const index = options(replies[0].text).indexOf('Трансфер');
		rank.mockClear();

		expect((await say(String(index + 1))).event.nodeCode).toBe('transfer');
		expect(rank).not.toHaveBeenCalled();
	});

	it('да и нет после конечного ответа не вызывают модель', async () => {
		await at('support');
		const more = await say('да');
		expect(more.event.type).toBe('more');
		expect(more.replies[0].text).toContain(SEED_SETTINGS['text.askMore']);
		await at('support');
		expect((await say('нет, спасибо!')).replies).toEqual([{ text: SEED_SETTINGS['text.goodbye'] }]);
		expect(rank).not.toHaveBeenCalled();
	});

	it('новый вопрос после конечного ответа всё ещё передаётся модели', async () => {
		await at('support');
		rank.mockResolvedValue(candidates(['buy', 0.9]));
		expect((await say('где купить билет')).event.nodeCode).toBe('buy');
		expect(rank).toHaveBeenCalledOnce();
	});
});

describe('рендеринг и целостность дерева', () => {
	it('ссылки и изображения остаются в ответах', () => {
		expect(engine.render(tree, node('tariffs-yakutia')).image).toBe('generated/tariffs.jpg');
		expect(engine.render(tree, node('rules')).text).toContain('<a href="https://rw-y.ru/passengers/rules#1">Оформление перевозки пассажиров</a>');
	});

	it('файл и экранированный заголовок сохраняются', () => {
		const changed = flattenSeed().map(item => item.code === 'support'
			? { ...item, title: 'Багаж < 10 кг & A', text: null, file: 'files/support.pdf', fileName: 'Контакты.pdf' }
			: item);
		const localTree = new ContentTree(changed, SEED_SETTINGS);
		const reply = engine.render(localTree, localTree.getByCode('support')!);

		expect(reply.text).toBe('<b>Багаж &lt; 10 кг &amp; A</b>');
		expect(reply.file).toEqual({ path: 'files/support.pdf', name: 'Контакты.pdf' });
	});

	it('конечный ответ сопровождается вопросом о дополнительной помощи', async () => {
		rank.mockResolvedValue(candidates(['support', 0.9]));
		expect((await say('вопрос')).replies.at(-1)?.text).toBe(SEED_SETTINGS['text.anythingElse']);
	});

	it('назад после ссылки возвращает в её родительский раздел', async () => {
		await at('buy-yakutsk-2gis');
		expect((await say('назад')).event.nodeCode).toBe('buy-yakutsk');
	});

	it('скрытый раздел доступен поиску, но отсутствует в меню', async () => {
		expect((await say('меню')).replies[0].text).not.toContain('Возврат билета');
		await say('вопрос');
		expect(rank.mock.calls[0][1].map(item => item.code)).toContain('refund');
	});

	it('goto в выключенный раздел удаляется из дерева', () => {
		const changed = flattenSeed().map(item => item.code === 'faq-refund' ? { ...item, isActive: false } : item);
		const pruned = new ContentTree(changed, SEED_SETTINGS);

		expect(pruned.children(pruned.getByCode('refund')!).map(item => item.code)).toEqual(['refund-transfer']);
	});

	it('циклические ветви не попадают в дерево', () => {
		const changed = flattenSeed().map(item => item.code === 'buy'
			? { ...item, parentId: node('buy-offline').id }
			: item);
		const pruned = new ContentTree(changed, SEED_SETTINGS);

		expect(pruned.getByCode('buy')).toBeUndefined();
		expect(pruned.getByCode('buy-offline')).toBeUndefined();
	});

	it('отсутствие активного корня остаётся ошибкой', () => {
		expect(() => new ContentTree(flattenSeed().filter(item => item.code !== 'root'), SEED_SETTINGS)).toThrow('no active node');
	});
});
