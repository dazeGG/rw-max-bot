// Opt-in real-model evaluation. Fixtures never affect runtime routing.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { ContentTree, DialogEngine, flattenSeed, MemorySessionStore, SEED_SETTINGS } from '@rw/core';
import type { DialogResult, SeedNode } from '@rw/core';
import { repoPath } from '@rw/runtime';

import { semanticPolicy } from '../semantic-config';
import { createE5Search, E5_MODEL, E5_REVISION } from '../semantic-search';

type Step = { text: string; expected: string[]; clarification?: string[]; };
type Example = { name: string; domain: 'railway' | 'library'; steps: Step[]; };
type Outcome = 'direct-correct' | 'relevant-clarification' | 'unnecessary-clarification' | 'wrong-answer' | 'irrelevant-clarification' | 'no-answer' | 'correct-rejection';
type EvaluationRow = Step & {
	scenario: string;
	domain: Example['domain'];
	step: number;
	outcome: Outcome;
	pass: boolean;
	actual: string[];
	type: DialogResult['event']['type'];
	from: string | undefined;
	milliseconds: number;
	candidates: DialogResult['event']['details']['candidates'];
};
const direct = (text: string, ...expected: string[]): Step => ({ text, expected });
const clarify = (text: string, clarification: string[]): Step => ({ text, expected: [], clarification });
const railway = (name: string, ...steps: Step[]): Example => ({ name, domain: 'railway', steps });
const placeOptions = ['schedule-direct-blagoveshensk', 'schedule-train-317318', 'schedule-traffic-317', 'schedule-traffic-318'];

// Retain the original cases, but do not count irrelevant suggestions as success.
const examples: Example[] = [
	...[
		direct('купить билет', 'buy'), direct('как купить билеты онлайн', 'buy-online'),
		direct('сколько стоит детский билет', 'faq-child'), direct('можно ли ехать с собакой', 'faq-pets'),
		direct('могу ли взять с собой кота', 'faq-pets'), direct('забыл рюкзак в вагоне', 'forgotten'),
		direct('я потерял вещи в поезде', 'forgotten'), direct('телефон службы поддержки', 'support'),
		direct('подскажите телефон справочной', 'support'), direct('где поесть в поезде', 'onboard-dining'),
		direct('за сколько дней продают билеты', 'faq-sale-start'), direct('справка о стоимости проезда', 'faq-certificate'),
		direct('хочу сдать билет', 'refund'), direct('как вернуть билет на поезд', 'faq-refund'),
		direct('сколько стоит билет', 'tariffs'), direct('какая погода завтра', 'unrecognized'),
		direct('как приготовить борщ', 'unrecognized'), direct('напиши программу на питоне', 'unrecognized'), direct('асдфыва', 'unrecognized'),
	].map(step => railway(`original: ${step.text}`, step)),
	railway('original: transfer schedule', direct('трансфер', 'transfer'), direct('расписание', 'transfer-schedule')),
	railway('original: transfer numeric', direct('трансфер', 'transfer'), direct('1', 'transfer-schedule')),
	railway('original: navigation', direct('расписание', 'schedule'), direct('меню', 'root')),
	...[
		direct('Как купить билет?', 'buy'), direct('Где можно приобрести билеты?', 'buy'),
		direct('Хочу купить билет через интернет', 'buy-online'), direct('Сколько стоит детский билет?', 'faq-child'),
		direct('Как получить дубликат кассового чека?', 'paid-services'), direct('Как позвонить в справочную?', 'support'),
		direct('Забыл рюкзак в поезде.', 'forgotten'), direct('Хочу взять кота с собой.', 'faq-pets'),
		direct('Ребёнку четыре года, нужен отдельный билет?', 'faq-child'), direct('Ребёнку 7 лет, нужен отдельный билет?', 'faq-child'),
		direct('Не могу поехать, как вернуть деньги?', 'refund'), direct('Билет дорогой, есть способы сэкономить?', 'faq-cheaper', 'promo'),
		direct('Я на коляске, кто поможет с посадкой?', 'limited-mobility'), direct('Как доехать из Якутска до вокзала Нижнего Бестяха?', 'transfer'),
		direct('Расписание.', 'schedule'), direct('Сколько стоит проезд?', 'tariffs'), direct('Хочу вернуть билет.', 'refund'),
		direct('Какие есть льготы?', 'privileges'), clarify('Благовещенск.', placeOptions),
	].map(step => railway(`screenshot: ${step.text}`, step)),
	railway('sequential: office then child fares', direct('Где находится касса в Нижнем Бестяхе?', 'buy-bestyakh'), direct('Сколько стоит детский билет?', 'faq-child')),
	railway('sequential: completed FAQ then new topics', direct('Как вернуть билет на поезд?', 'faq-refund'), direct('Расписание.', 'schedule'), direct('Какие есть льготы?', 'privileges'), clarify('Благовещенск.', placeOptions)),
	railway('sequential: waiting question permits new topic', direct('Как купить билет?', 'buy'), direct('Можно ли ехать с собакой?', 'faq-pets')),
	railway('sequential: purchase follow-ups', direct('Как купить билет?', 'buy'), direct('В кассе', 'buy-offline'), direct('Якутск', 'buy-yakutsk')),
	railway('sequential: completed transfer must not force new refund domain', direct('Льготы на трансфер для детей', 'transfer-privileges-children'), direct('Не могу поехать, как вернуть деньги?', 'refund')),
	railway('sequential: child ages', direct('Ребёнку четыре года, нужен отдельный билет?', 'faq-child'), direct('Ребёнку 7 лет, нужен отдельный билет?', 'faq-child')),
	...[
		[direct('Как записаться в библиотеку?', 'k17')], [direct('Можно продлить взятую книгу?', 'l55')],
		[direct('Когда открывается библиотека?', 'e08')], [direct('Как позвонить библиотекарю?', 'f66')],
		[direct('Как вернуть книги?', 'd90')], [direct('Как записаться в библиотеку?', 'k17'), direct('Онлайн', 'm40')],
		[direct('Можно продлить книгу?', 'l55'), direct('Как записаться в библиотеку?', 'k17')],
		[direct('Как записаться в библиотеку?', 'k17'), direct('Когда открывается библиотека?', 'e08')],
		[direct('Какая погода завтра?', 'unrecognized')],
	].map((steps, index): Example => ({ name: `unrelated domain ${index + 1}`, domain: 'library', steps })),
];

const libraryContent: SeedNode = {
	code: 'root',
	title: 'Помощник библиотеки',
	text: 'Задайте вопрос о работе библиотеки.',
	children: [
		{
			code: 'k17',
			title: 'Запись в библиотеку',
			text: 'Как Вам удобнее оформить читательский билет?',
			children: [
				{ code: 'm40', title: 'Онлайн', text: 'Для записи через интернет заполните электронную анкету читателя на сайте библиотеки.' },
				{ code: 'o74', title: 'В библиотеке', text: 'Для записи лично приходите в библиотеку с паспортом. Библиотекарь оформит читательский билет.' },
			],
		},
		{ code: 'l55', title: 'Продление срока пользования книгами', text: 'Взятую домой книгу можно продлить на 14 дней по телефону библиотеки, если на неё нет очереди.' },
		{ code: 'd90', title: 'Возврат книг', text: 'Вернуть взятые книги можно в часы работы библиотеки на стойку возврата. Читательский билет предъявлять не нужно.' },
		{ code: 'e08', title: 'Время работы библиотеки', text: 'Библиотека открыта с понедельника по субботу с 10:00 до 19:00. Воскресенье — выходной.' },
		{ code: 'f66', title: 'Связаться с библиотекарем', text: 'Позвонить в справочную библиотеки можно по телефону 8 800 123 45 67. Библиотекарь отвечает в часы работы.' },
		{
			code: 'x22',
			title: 'Адрес библиотеки',
			text: 'Библиотека расположена на улице Лесной, дом 5.',
			children: [
				{ code: 'z05', title: 'Открыть на карте', type: 'link', url: 'https://example.org/library-map' },
			],
		},
	],
};

const classify = (result: DialogResult, step: Step, tree: ContentTree): { outcome: Outcome; pass: boolean; actual: string[]; } => {
	if (result.event.type === 'unrecognized') {
		const pass = step.expected.includes('unrecognized');
		return { outcome: pass ? 'correct-rejection' : 'no-answer', pass, actual: ['unrecognized'] };
	}
	if (result.event.type !== 'clarify') {
		const actual = result.event.nodeCode ? [result.event.nodeCode] : [];
		const pass = actual.some(code => step.expected.includes(code));
		return { outcome: pass ? 'direct-correct' : 'wrong-answer', pass, actual };
	}
	const actual = [...new Set((result.event.details.suggested ?? []).map(code => {
		const node = tree.getByCode(code);
		return node ? tree.resolve(node).code : code;
	}))];
	const allowed = step.clarification ?? step.expected;
	const relevant = actual.length > 1 && actual.every(code => allowed.includes(code));
	if (relevant && step.clarification) {
		return { outcome: 'relevant-clarification', pass: true, actual };
	}
	return { outcome: relevant ? 'unnecessary-clarification' : 'irrelevant-clarification', pass: false, actual };
};

const main = async () => {
	const sources = await Promise.all(['packages/core/src/dialog/engine.ts', 'apps/bot/src/semantic-search.ts'].map(file => fs.readFile(repoPath(file))));
	const runtimeFingerprint = createHash('sha256').update(Buffer.concat(sources)).digest('hex');
	const libraryNodes = flattenSeed(libraryContent).map(node => ({ ...node, id: node.id + 5000, parentId: node.parentId === null ? null : node.parentId + 5000 }));
	const trees = { railway: new ContentTree(flattenSeed(), SEED_SETTINGS), library: new ContentTree(libraryNodes, SEED_SETTINGS) };
	const search = await createE5Search();
	await Promise.all(Object.values(trees).map(tree => search.prepare(tree)));
	const results: EvaluationRow[] = [];
	for (const example of examples) {
		const tree = trees[example.domain];
		const engine = new DialogEngine(() => tree, new MemorySessionStore(), search, {}, semanticPolicy);
		await engine.process({ id: 1 }, { type: 'start' });
		for (const [index, step] of example.steps.entries()) {
			const started = performance.now();
			const result = await engine.process({ id: 1 }, { type: 'text', text: step.text });
			const row = { scenario: example.name, domain: example.domain, step: index + 1, ...step, ...classify(result, step, tree), type: result.event.type, from: result.event.details.fromNodeCode, milliseconds: Math.round(performance.now() - started), candidates: result.event.details.candidates };
			results.push(row);
			console.log(`${row.pass ? 'OK  ' : 'MISS'} [${row.outcome}] ${example.domain}: ${step.text} => ${row.actual.join(', ')}; expected ${step.expected.join(', ') || 'relevant clarification'}`);
		}
	}
	const passed = results.filter(row => row.pass).length;
	const outcomes = Object.fromEntries([...new Set(results.map(row => row.outcome))].map(outcome => [outcome, results.filter(row => row.outcome === outcome).length]));
	const report = { createdAt: new Date().toISOString(), runtimeFingerprint, model: E5_MODEL, revision: E5_REVISION, policy: semanticPolicy, passed, total: results.length, outcomes, results };
	const filename = process.argv.includes('--baseline') ? '.cache/e5-before-context.json' : '.cache/e5-evaluation.json';
	await fs.mkdir(repoPath('.cache'), { recursive: true });
	await fs.writeFile(repoPath(filename), JSON.stringify(report, null, 2));
	console.log(`\n${passed}/${results.length} strict outcomes. ${JSON.stringify(outcomes)}\nReport: ${filename}`);
	if (process.argv.includes('--strict') && passed !== results.length) {
		process.exitCode = 1;
	}
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
