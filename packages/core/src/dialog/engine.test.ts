import { beforeEach, describe, expect, it } from 'vitest';

import { flattenSeed, SEED_SETTINGS } from '../content/seed-data';
import { ContentTree } from '../content/tree';

import { DialogEngine } from './engine';
import { MemorySessionStore } from './memory-sessions';
import type { UnrecognizedEvent } from './types';

const tree = new ContentTree(flattenSeed(), SEED_SETTINGS);
const user = { id: 42 };

let sessions: MemorySessionStore;
let unrecognized: UnrecognizedEvent[];
let engine: DialogEngine;

const currentCode = async () => tree.get((await sessions.get(user.id)).nodeId)?.code;
const say = (text: string) => engine.handle(user, { type: 'text', text });
// Варианты из нумерованного списка в сообщении («2. Талон на трансфер» → «Талон на трансфер»)
const options = (text: string) => text.split('\n').filter(line => /^\d+\. /.test(line)).map(line => line.replace(/^\d+\. /, ''));

beforeEach(async () => {
	sessions = new MemorySessionStore();
	unrecognized = [];
	engine = new DialogEngine(() => tree, sessions, { onUnrecognized: event => void unrecognized.push(event) });
	await engine.handle(user, { type: 'start' });
});

describe('свободный текст ведет в нужный раздел', () => {
	it.each([
		['Здравствуйте, как мне купить билет на поезд?', 'buy'],
		['где купить билеты', 'buy'],
		['билт на поезд', 'buy'],
		['сколько стоит детский билет', 'faq-child'],
		['сколько стоит билет для ребенка', 'faq-child'],
		['сколько стоит билет', 'tariffs'],
		['нужен дубликат чека', 'paid-services'],
		['справка о стоимости проезда', 'faq-certificate'],
		['как купить билет дешевле', 'faq-cheaper'],
		['можно ли с собакой', 'faq-pets'],
		['где камера хранения', 'faq-storage'],
		['кормят в поезде?', 'onboard-dining'],
		['забыл сумку в вагоне', 'forgotten'],
		['телефон поддержки', 'support'],
		['расписание трансфера', 'transfer-schedule'],
		['льготы', 'privileges'],
		['скидки', 'promo'],
		['за сколько дней начинается продажа билетов', 'faq-sale-start'],
		['я инвалид, кто поможет?', 'limited-mobility'],
	])('«%s» → %s', async (text, code) => {
		await say(text);
		expect(await currentCode()).toBe(code);
	});
});

describe('уточняющие вопросы, как в чат-боте РЖД', () => {
	it('«сдать билет» → вопрос с вариантами в тексте → ответ текстом', async () => {
		const [question] = await say('хочу сдать билет');

		expect(await currentCode()).toBe('refund');
		expect(options(question.text)).toContain('Билет на поезд');
		expect(options(question.text)).toContain('Талон на трансфер');

		await say('трансфер');
		expect(await currentCode()).toBe('transfer-refund');
	});

	it.each([
		['расписание', 'transfer-schedule'],
		['тарифы', 'transfer-tariffs'],
		['возврат', 'transfer-refund'],
		['льготы', 'transfer-privileges'],
	])('короткий вопрос внутри раздела дополняется им: «%s» в «Трансфере» → %s', async (text, code) => {
		await say('трансфер');
		await say(text);

		expect(await currentCode()).toBe(code);
	});

	it('после ответа соседний пункт тоже понимается коротко: «тарифы» после расписания трансфера', async () => {
		await say('трансфер');
		await say('расписание');
		await say('тарифы');

		expect(await currentCode()).toBe('transfer-tariffs');
	});

	it('вопрос из другой ветки внутри раздела не перехватывается', async () => {
		await say('трансфер');
		await say('расписание поездов');

		expect(await currentCode()).toBe('schedule');
	});

	it('короткий ответ учитывает контекст: «якутск» после «купить билет» → касса в Якутске', async () => {
		await say('купить билет');
		await say('якутск');

		expect(await currentCode()).toBe('buy-yakutsk');
	});

	it.each([
		['онлайн', 'buy-online'],
		['через интернет', 'buy-online'],
		['в кассе', 'buy-offline'],
		['оффлайн', 'buy-offline'],
	])('«купить билет» → «%s» → %s', async (answer, code) => {
		await say('купить билет');
		await say(answer);

		expect(await currentCode()).toBe(code);
	});

	it('при равных вариантах бот переспрашивает и понимает ответ на уточнение', async () => {
		const [reply] = await say('благовещенск');

		expect(reply.text).toContain(SEED_SETTINGS['text.didYouMean']);
		expect(options(reply.text)).toContain('Благовещенск');
		expect(options(reply.text)).toContain('Поезд №317/№318 | Нижний Бестях – Благовещенск');

		await say('поезд');
		expect(await currentCode()).toBe('schedule-train-317318');
	});

	it('новый вопрос посреди уточнения уводит в другой раздел', async () => {
		await say('сдать билет');
		await say('как провозить животных');

		expect(await currentCode()).toBe('faq-pets');
	});
});

describe('ответ номером варианта', () => {
	it('номер выбирает пункт из списка текущего раздела', async () => {
		const [transfer] = await say('трансфер');

		expect(options(transfer.text)[0]).toBe('Расписание трансфера');

		await say('1');
		expect(await currentCode()).toBe('transfer-schedule');
	});

	it('номер выбирает из вариантов уточнения', async () => {
		const [question] = await say('благовещенск');
		const index = options(question.text).indexOf('Поезд №317/№318 | Нижний Бестях – Благовещенск');

		await say(`${index + 1}.`);
		expect(await currentCode()).toBe('schedule-train-317318');
	});

	it('после «не понял» номер выбирает раздел главного меню', async () => {
		const [fallback] = await say('асдфыва');
		const index = options(fallback.text).indexOf('Трансфер');

		await say(String(index + 1));
		expect(await currentCode()).toBe('transfer');
	});

	it('номер вне списка не выбирает случайный пункт', async () => {
		await say('трансфер');
		await say('99');

		expect(await currentCode()).not.toMatch(/^transfer-/);
	});
});

describe('навигация текстом', () => {
	it('приветствие без вопроса → стартовое сообщение', async () => {
		const replies = await say('Добрый день!');

		expect(replies).toHaveLength(1);
		expect(await currentCode()).toBe('root');
	});

	it('приветствие с вопросом → приветствие и ответ', async () => {
		const replies = await say('Здравствуйте, где купить билет?');

		expect(replies).toHaveLength(2);
		expect(replies[0].text).toBe(SEED_SETTINGS['text.greeting']);
	});

	it('«назад» и «меню»', async () => {
		await say('пассажирские поезда');
		expect(await currentCode()).toBe('schedule-trains');

		await say('назад');
		expect(await currentCode()).toBe('schedule');

		await say('меню');
		expect(await currentCode()).toBe('root');
	});

	it('варианты ответа и ссылки перечисляются в тексте', async () => {
		const [rules] = await say('правила перевозки');

		expect(options(rules.text)).toContain('<a href="https://rw-y.ru/passengers/rules#1">Оформление перевозки пассажиров</a>');
	});

	it('«назад» после ссылки возвращает в раздел, где она лежит', async () => {
		await say('купить билет');
		await say('якутск');
		await say('2гис');
		expect(await currentCode()).toBe('buy-yakutsk-2gis');

		await say('назад');
		expect(await currentCode()).toBe('buy-yakutsk');
	});

	it('скрытые разделы не перечисляются в списке тем', async () => {
		const [root] = await say('меню');
		expect(root.text).not.toContain('Возврат билета');
	});

	it('неактивные разделы не перечисляются и не находятся', async () => {
		const [trains] = await say('пассажирские поезда');

		expect(trains.text).not.toContain('Поезд №321/№322');

		await say('321');
		expect(await currentCode()).not.toBe('schedule-train-321322');
	});
});

describe('«Могу ли я ещё Вам чем-то помочь?» в конце цепочки', () => {
	it('после конечного ответа и ссылки — отдельным сообщением, после вопроса с вариантами — нет', async () => {
		const buy = await say('купить билет');
		expect(buy).toHaveLength(1);

		const office = await say('якутск');
		expect(office).toHaveLength(1);

		const link = await say('2гис');
		expect(link.map(reply => reply.text)).toEqual([expect.stringContaining('2gis'), SEED_SETTINGS['text.anythingElse']]);
	});

	it('«да» — список тем, «нет, спасибо» — прощание', async () => {
		await say('питание в пути');
		const [more] = await say('да');

		expect(more.text).toContain(SEED_SETTINGS['text.askMore']);
		expect(options(more.text)).toContain('Купить билет');
		expect(await currentCode()).toBe('root');

		await say('питание в пути');
		const replies = await say('Нет, спасибо!');

		expect(replies).toEqual([{ text: SEED_SETTINGS['text.goodbye'] }]);
		expect(await currentCode()).toBe('root');
	});

	it('новый вопрос вместо «да» обрабатывается как обычно', async () => {
		await say('питание в пути');
		await say('где купить билет');

		expect(await currentCode()).toBe('buy');
	});
});

describe('целостность дерева', () => {
	it('goto в выключенный раздел не показывается', () => {
		const nodes = flattenSeed().map(n => n.code === 'faq-refund' ? { ...n, isActive: false } : n);
		const pruned = new ContentTree(nodes, SEED_SETTINGS);
		const refund = pruned.getByCode('refund')!;

		expect(pruned.children(refund).map(n => n.code)).toEqual(['refund-transfer']);
	});

	it('HTML в названии экранируется', async () => {
		const nodes = flattenSeed().map(n => n.code === 'support' ? { ...n, title: 'Багаж < 10 кг & A', text: null, synonyms: ['поддержка'] } : n);
		const local = new DialogEngine(() => new ContentTree(nodes, SEED_SETTINGS), new MemorySessionStore());

		const [reply] = await local.handle(user, { type: 'text', text: 'поддержка' });
		expect(reply.text).toBe('<b>Багаж &lt; 10 кг &amp; A</b>');
	});
});

describe('непонятный ввод (ТЗ п. 3.9)', () => {
	it('подсказка со списком тем и запись в журнал', async () => {
		const [reply] = await say('асдфыва');

		expect(reply.text).toContain(SEED_SETTINGS['text.fallback']);
		expect(options(reply.text)).toContain('Купить билет');
		expect(unrecognized).toEqual([{ userId: user.id, text: 'асдфыва', nodeId: tree.root.id }]);
	});
});

describe('вложения', () => {
	it('раздел с картинкой и раздел с файлом', async () => {
		const nodes = flattenSeed().map(n => n.code === 'support' ? { ...n, file: 'files/support.pdf', fileName: 'Контакты.pdf' } : n);
		const local = new DialogEngine(() => new ContentTree(nodes, SEED_SETTINGS), new MemorySessionStore());

		await say('тарифы');
		const [tariffs] = await say('ждя');
		const [support] = await local.handle(user, { type: 'text', text: 'служба поддержки' });

		expect(tariffs.image).toBe('generated/tariffs.jpg');
		expect(support.file).toEqual({ path: 'files/support.pdf', name: 'Контакты.pdf' });
	});
});
