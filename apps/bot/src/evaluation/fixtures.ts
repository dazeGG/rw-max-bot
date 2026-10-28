// Evaluation-only fixtures. No runtime routing imports this module.
import { createHash } from 'node:crypto';

import { ContentTree, flattenSeed, SEED_SETTINGS } from '@rw/core';
import type { DialogResult, SeedNode } from '@rw/core';

export type Step = { text: string; expected: string[]; clarification?: string[]; };
export type Example = { name: string; domain: 'railway' | 'library'; steps: Step[]; };
export type Outcome = 'direct-correct' | 'relevant-clarification' | 'unnecessary-clarification' | 'wrong-answer' | 'irrelevant-clarification' | 'no-answer' | 'correct-rejection';
export const direct = (text: string, ...expected: string[]): Step => ({ text, expected });
export const clarify = (text: string, clarification: string[]): Step => ({ text, expected: [], clarification });
const railway = (name: string, ...steps: Step[]): Example => ({ name, domain: 'railway', steps });
const placeOptions = ['schedule-direct-blagoveshensk', 'schedule-train-317318', 'schedule-traffic-317', 'schedule-traffic-318'];

// Retain the original cases, but do not count irrelevant suggestions as success.
export const examples: Example[] = [
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

export const libraryContent: SeedNode = {
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

export const classify = (result: DialogResult, step: Step, tree: ContentTree): { outcome: Outcome; pass: boolean; actual: string[]; } => {
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

export const createEvaluationTrees = (): Record<Example['domain'], ContentTree> => {
	const libraryNodes = flattenSeed(libraryContent).map(node => ({
		...node,
		id: node.id + 5000,
		parentId: node.parentId === null ? null : node.parentId + 5000,
		targetId: node.targetId === null ? null : node.targetId + 5000,
	}));
	return {
		railway: new ContentTree(flattenSeed(), SEED_SETTINGS),
		library: new ContentTree(libraryNodes, SEED_SETTINGS),
	};
};

// Frozen before any benchmark model was run against these questions.
// These are manually authored labels against the existing content, never runtime rules.
// Existing 71 turns are calibration/regression data; this standalone set is held out.
export const HELDOUT_VERSION = '2026-10-28-v1';
const heldout = (id: string, domain: Example['domain'], step: Step): Example => ({ name: id, domain, steps: [step] });

export const heldoutExamples: Example[] = [
	heldout('heldout-r01', 'railway', direct('Подскажите способы оформления железнодорожных билетов.', 'buy')),
	heldout('heldout-r02', 'railway', direct('Через какое приложение оплачивают проезд на поезде?', 'buy-online')),
	heldout('heldout-r03', 'railway', direct('Можно оформить поездку лично у кассира, а не через сайт?', 'buy-offline')),
	heldout('heldout-r04', 'railway', direct('На какой улице искать билетную кассу Алдана?', 'buy-aldan')),
	heldout('heldout-r05', 'railway', direct('В какое время у кассы в Томмоте обеденный перерыв?', 'buy-tommot')),
	heldout('heldout-r06', 'railway', direct('В каком микрорайоне Якутска расположен офис продажи билетов?', 'buy-yakutsk')),
	heldout('heldout-r07', 'railway', direct('Покажите расценки на места в вагонах компании ЖДЯ.', 'tariffs-yakutia')),
	heldout('heldout-r08', 'railway', direct('Где узнают актуальные цены на поезда перевозчика РЖД?', 'tariffs-rzd')),
	heldout('heldout-r09', 'railway', direct('Нужно расписание пассажирского поезда 327/328 между Тындой и Нижним Бестяхом.', 'schedule-train-327328')),
	heldout('heldout-r10', 'railway', direct('Ищу расписание беспересадочного вагона до Иркутска.', 'schedule-direct-irkutsk')),
	heldout('heldout-r11', 'railway', direct('Заранее талон на автобус и судно не покупал. Можно оплатить его при посадке в Якутске?', 'transfer-how')),
	heldout('heldout-r12', 'railway', direct('Какой сбор удержат, если сдам неиспользованный талон на трансфер?', 'transfer-refund')),
	heldout('heldout-r13', 'railway', direct('Шестилетний едет автобусом до вокзала без отдельного места. Талон будет бесплатным?', 'transfer-privileges-children')),
	heldout('heldout-r14', 'railway', direct('Я неработающий пенсионер с Крайнего Севера. Возмещают ли стоимость трансфера?', 'transfer-privileges-pensioners')),
	heldout('heldout-r15', 'railway', direct('Нужен бесплатный номер пассажирской горячей линии ЖДЯ.', 'support')),
	heldout('heldout-r16', 'railway', direct('Для отчёта работодателю нужна справка о цене железнодорожной поездки. Её можно заказать по электронной почте?', 'faq-certificate')),
	heldout('heldout-r17', 'railway', direct('Потерял кассовый чек за железнодорожный билет. Как заказать его повторный экземпляр?', 'paid-services')),
	heldout('heldout-r18', 'railway', direct('Сдаю билет именно на поезд за три часа до отправления. Что удержат из его стоимости?', 'faq-refund')),
	heldout('heldout-r19', 'railway', direct('Для восьмилетнего пассажира в купе есть детский тариф?', 'faq-child')),
	heldout('heldout-r20', 'railway', direct('Какой максимальный вес сумки можно бесплатно взять в вагон СВ?', 'faq-hand-luggage')),
	heldout('heldout-r21', 'railway', direct('У меня крупная собака. Разрешат ли с ней плацкарт или придётся выкупать купе?', 'faq-pets')),
	heldout('heldout-r22', 'railway', direct('Сколько берут за сутки хранения одного чемодана на вашем вокзале?', 'faq-storage')),
	heldout('heldout-r23', 'railway', direct('За сколько времени нужно заказать помощь пассажиру с ограниченной подвижностью на вокзале?', 'limited-mobility')),
	heldout('heldout-r24', 'railway', direct('В каком поезде есть специальный вагон для колясочников и когда им открывают продажу мест?', 'faq-disabled-car')),
	heldout('heldout-r25', 'railway', direct('Хочу заранее выбрать и оплатить рацион в поезд. За сколько суток это нужно сделать?', 'onboard-dining')),
	heldout('heldout-r26', 'railway', direct('За девяносто суток до отправления уже разрешено оформлять билеты?', 'faq-sale-start')),
	heldout('heldout-r27', 'railway', direct('Постельное бельё и полотенце в купе уже включены в оплаченную стоимость?', 'faq-price-includes')),
	heldout('heldout-r28', 'railway', direct('После выхода из поезда обнаружил, что телефон остался в вагоне. Куда подать заявку на поиск?', 'forgotten')),
	heldout('heldout-r29', 'railway', { text: 'Покажите ваши расценки на проезд.', expected: ['tariffs'], clarification: ['tariffs-yakutia', 'tariffs-rzd', 'transfer-tariffs'] }),
	heldout('heldout-r30', 'railway', { text: 'Отказываюсь от поездки, можно оформить возврат?', expected: ['refund'], clarification: ['faq-refund', 'transfer-refund', 'refund'] }),
	heldout('heldout-r31', 'railway', direct('Вы продаёте авиабилеты на рейс Якутск — Сочи?', 'unrecognized')),
	heldout('heldout-r32', 'railway', direct('Будет ли завтра снег по дороге из Якутска?', 'unrecognized')),
	heldout('heldout-r33', 'railway', direct('Сообщите пароль от Wi-Fi в поезде.', 'unrecognized')),
	heldout('heldout-r34', 'railway', direct('Объясните, как реализовать бинарное дерево на Java.', 'unrecognized')),
	heldout('heldout-l01', 'library', direct('Что необходимо сделать новому читателю, чтобы получить библиотечный билет?', 'k17')),
	heldout('heldout-l02', 'library', direct('Я хочу зарегистрироваться читателем из дома через электронную анкету.', 'm40')),
	heldout('heldout-l03', 'library', direct('С каким документом приходить для личной регистрации у библиотекаря?', 'o74')),
	heldout('heldout-l04', 'library', direct('На сколько дней мне разрешат оставить у себя выданную книгу после продления?', 'l55')),
	heldout('heldout-l05', 'library', direct('Могу ли я продлить книгу, если за ней уже записался следующий читатель?', 'l55')),
	heldout('heldout-l06', 'library', direct('Обязательно предъявлять читательский билет, когда сдаю книги на стойку?', 'd90')),
	heldout('heldout-l07', 'library', direct('До какого часа можно прийти в библиотеку в субботу?', 'e08')),
	heldout('heldout-l08', 'library', direct('Воскресенье у библиотеки рабочий день или выходной?', 'e08')),
	heldout('heldout-l09', 'library', direct('Какой телефон набрать, чтобы поговорить с сотрудником библиотеки?', 'f66')),
	heldout('heldout-l10', 'library', direct('На какой улице и в каком доме находится ваша библиотека?', 'x22')),
	heldout('heldout-l11', 'library', { text: 'Какие есть способы получить читательский билет?', expected: ['k17'], clarification: ['m40', 'o74'] }),
	heldout('heldout-l12', 'library', { text: 'Хочу воспользоваться услугами библиотеки дистанционно, какие варианты есть?', expected: [], clarification: ['m40', 'l55', 'f66', 'k17'] }),
	heldout('heldout-l13', 'library', direct('Есть ли сейчас на полке третий том «Войны и мира»?', 'unrecognized')),
	heldout('heldout-l14', 'library', direct('Можно записаться на приём к стоматологу на пятницу?', 'unrecognized')),
];

export const HELDOUT_SHA256 = createHash('sha256').update(JSON.stringify({ version: HELDOUT_VERSION, examples: heldoutExamples })).digest('hex');
