// Evaluation-only fixtures. No runtime routing imports this module.
// Real MAX dialogs from production dialog_events (2026-10-26 … 2026-10-30), without user ids.
// Steps keep the original wording and order, including button numbers, so follow-ups are judged in their context.
// Labels are what the passenger needed, not what the production matcher answered. `// ?` marks labels awaiting review.
import { clarify, direct } from './fixtures';
import type { Example, Step } from './fixtures';

export const REAL_MAX_VERSION = '2026-10-30-draft';
const max = (name: string, ...steps: Step[]): Example => ({ name: `max: ${name}`, domain: 'railway', steps });
const blagoveshensk = ['schedule-direct-blagoveshensk', 'schedule-train-317318', 'schedule-traffic-317', 'schedule-traffic-318'];

export const realMaxExamples: Example[] = [
	max('privileges', direct('Льготы', 'privileges')),
	max('tariffs both carriers', direct('Тарифы', 'tariffs'), direct('И там и там', 'tariffs', 'unrecognized'), direct('Тарифы ржд', 'tariffs-rzd'), direct('Тарифы ждя', 'tariffs-yakutia')), // ?
	max('dining then tickets', direct('Питание', 'onboard-dining'), direct('Билет до Благовещенска', 'tariffs', 'buy'), // ?
		direct('Стоимость билета', 'tariffs'), direct('Тарифы', 'tariffs'), direct('Тариф ждя', 'tariffs-yakutia')),
	max('capabilities', direct('Что ты умеешь?', 'unrecognized')),
	max('purchase follow-ups and pets', direct('Как купить билет?', 'buy'), direct('В кассе', 'buy-offline'), direct('Якутск', 'buy-yakutsk'),
		direct('Расскажи о правилах перевозки животных', 'faq-pets', 'rules-7')),
	max('out of network route', direct('Как поехать с Москвы до лабытнанги', 'unrecognized')),
	max('tariffs then purchase', direct('Тарифы', 'tariffs'), direct('Тарифы ждя', 'tariffs-yakutia'), direct('Тарифы ржд', 'tariffs-rzd'),
		direct('Как купить билет', 'buy'), direct('Онлайн', 'buy-online')),
	max('traffic to Tynda', direct('расписание', 'schedule'), direct('График движения', 'schedule-traffic'),
		direct('Тында', 'schedule-train-327328', 'schedule-traffic-327', 'schedule-traffic-328')),
	max('mixed purchase questions', direct('купить билет', 'buy'), direct('онлайн', 'buy-online'),
		direct('сколько стоит билет из Якутска до Нерюнгри?', 'tariffs', 'tariffs-yakutia'), direct('в вагонах ЖДЯ', 'tariffs-yakutia'),
		direct('как подтвердить льготу при покупке билетов?', 'privileges'), // ?
		direct('льготы', 'privileges'), direct('купить билет', 'buy'), direct('в кассе', 'buy-offline'),
		direct('а можно использовать идентификатор ID max&', 'unrecognized'),
		direct('можно приобрести билеты до Нью-Йорка?', 'unrecognized'), direct('онлайн?', 'buy-online')),
	max('luggage, pets, rights, lost luggage', direct('Как перевезти спиртное', 'faq-hand-luggage', 'rules-6'), // ?
		direct('Как перевезти жидкость', 'faq-hand-luggage', 'rules-6'), // ?
		direct('Как перевезти кошку?', 'faq-pets', 'rules-7'), direct('Как купить билет', 'buy'), direct('Онлайн', 'buy-online'),
		direct('Какие у меня права при задержке поезда?', 'rules', 'unrecognized'), // ?
		direct('Чем ты мне можешь помочь?', 'unrecognized'), direct('Куда мне обращаться, если я потерял багаж?', 'forgotten')),
	max('direct car from trains menu', direct('расписание', 'schedule'), direct('1', 'schedule-trains'),
		direct('бестях владивосток', 'schedule-direct-vladivostok'), direct('тарифы', 'tariffs')),
	max('train number', direct('Расписание', 'schedule'), direct('Пассажирские поезда', 'schedule-trains'), direct('318', 'schedule-train-317318')),
	max('Vladivostok compartment fares', direct('2', 'tariffs'), direct('1', 'tariffs-yakutia'),
		direct('Якутск владивосток', 'tariffs-yakutia'), // ?
		direct('Купе 2хместное', 'tariffs-yakutia', 'promo-kupek'), // ?
		direct('Билет купе до влаливосток', 'tariffs-yakutia')),
	max('seats in compartment', direct('6', 'promo'), direct('целое купе', 'promo-kupek'), direct('В купе сколько мест', 'promo-kupek')), // ?
	max('Ulan-Ude and Neryungri fares', direct('Как купить билет?', 'buy'), direct('Онлайн', 'buy-online'),
		direct('Сколько стоит билет с нижнего бестяха до Улан-удэ', 'tariffs', 'tariffs-yakutia'), direct('Тарифы', 'tariffs'),
		direct('И 1. И 2.', 'tariffs', 'unrecognized'), // ?
		direct('Тарифы с нижнего бестяха до Нерюнгри?', 'tariffs', 'tariffs-yakutia'),
		direct('Тарифы с Нерюнгри до улан -удэ?', 'tariffs', 'tariffs-rzd', 'tariffs-yakutia'), direct('Тарифы ржд', 'tariffs-rzd')),
	max('arrival information', direct('13', 'support'), direct('Информация о прибытии пассажирского состава', 'schedule-traffic', 'schedule')), // ?
	max('dining on a route', direct('питание в вагоне Алдан - Благовещенск', 'onboard-dining'), direct('питание', 'onboard-dining')),
	// Button numbers that followed a clarification are dropped: the replayed list may differ
	max('disabled fare', direct('Тариф билета по маршруту Нижний Бестях-Владивосток для инвалида второй группы?', 'privileges-long-distance', 'privileges', 'tariffs', 'tariffs-yakutia')), // ?
	max('disabled privileges in fares', direct('2', 'tariffs'), direct('1', 'tariffs-yakutia'),
		direct('Льготы для инвалидов', 'privileges', 'privileges-long-distance')), // ?
	max('disability after privileges', direct('5', 'privileges'), direct('По инвалидности', 'privileges-long-distance', 'privileges')), // ?
	max('transfer schedule', direct('Трансфер Якутск- Нижний Бестях', 'transfer'), direct('Расписание трансфера', 'transfer-schedule')),
	max('Blagoveshchensk fare by date', direct('Сколько стоит билет до Благовещенска на 5.11', 'tariffs', 'tariffs-yakutia')),
	max('storage in Bestyakh', direct('Есть ли камера хранения в нижнем бестяхе?', 'faq-storage')),
	max('whole compartment', direct('6', 'promo'), direct('Целое купе', 'promo-kupek')),
	max('school privileges', direct('5', 'privileges'), clarify('Льгота школьникам', ['privileges', 'transfer-privileges-children'])), // ?
	max('carriers after tariffs', direct('Тарифы', 'tariffs'), direct('Ждя', 'tariffs-yakutia'), direct('Ржд', 'tariffs-rzd')),
	max('seat availability', direct('Купить билет', 'buy'), direct('Онлайн', 'buy-online'), direct('Наличие билетов на рейсы', 'buy-online'),
		direct('Есть сайт где посмотреть о наличии свободных мест на определенеые дни', 'buy-online')),
	max('Namyv', direct('Как уехать с Намыва?', 'transfer', 'unrecognized'), direct('Трансфер', 'transfer')), // ?
	max('Aldan fare then place', direct('Тариф Алдан-Благовещенск', 'tariffs', 'tariffs-yakutia'), clarify('Благовещенск', blagoveshensk),
		direct('Сколько стоит билет', 'tariffs'), direct('1', 'tariffs-yakutia'), direct('РЖД', 'tariffs-rzd')),
	max('RZD cars from menu', direct('2', 'tariffs'), direct('1', 'tariffs-yakutia'), direct('Тарифа в вагонах ржд', 'tariffs-rzd')),
	max('pensioners then plackart fare', direct('Льготы проезда пенсионеров', 'privileges-pensioner', 'promo-senior', 'privileges'), // ?
		direct('Тариф на плацкарт Нижний Бестях - Алдан', 'tariffs', 'tariffs-yakutia')),
	max('dining on Blagoveshchensk train', direct('Питание в поезде Нижний Бестях - Благовещенск', 'onboard-dining'),
		direct('Питание в пути следования', 'onboard-dining')),
	max('Vladivostok route', direct('Якутск -владивосток', 'schedule-direct-vladivostok'), // ?
		direct('Нижний Бестях Владивосток', 'schedule-direct-vladivostok'),
		direct('Расписание поездов нижний Бестях Владивосток', 'schedule-direct-vladivostok')),
	max('tariffs then purchase online', direct('Тарифы', 'tariffs'), direct('1', 'tariffs-yakutia'), direct('Купить билет', 'buy'), direct('Онлайн', 'buy-online')),
	max('office by name', direct('1', 'buy'), direct('2', 'buy-offline'), direct('1', 'buy-tommot'), direct('Алдан', 'buy-aldan')),
	max('ask a question', direct('1', 'buy'), direct('2', 'buy-offline'), direct('1', 'buy-tommot'), direct('задать вопрос', 'question')),
	max('receipt duplicate', direct('Как получить дубликат кассового чека?', 'paid-services')),
	max('train to Blagoveshchensk then luggage', direct('могу ли я уехать на поезде в Благовещенск', 'schedule-train-317318', 'schedule-direct-blagoveshensk'),
		direct('Сколько стоит билет', 'tariffs'), direct('ЖДЯ', 'tariffs-yakutia'), direct('сколько багажа можно', 'faq-hand-luggage')),
	max('main menu titles', direct('Льготы', 'privileges'), direct('Расписание', 'schedule'), direct('Служба поддержки пассажиров', 'support'),
		direct('Тарифы в зимнее время', 'tariffs'), direct('Тарифы в вагонах ЖДЯ', 'tariffs-yakutia')),
	max('typo in price question', direct('Четко стоит билет', 'tariffs'), direct('Ждя', 'tariffs-yakutia')),
	max('crossing', direct('3', 'schedule'), direct('1', 'schedule-trains'), direct('1', 'schedule-train-317318'),
		direct('Переправа Якутск - Нижний бестях', 'transfer')),
	max('long session', direct('какие маршруты есть из якутска?', 'schedule', 'transfer'), // ?
		direct('сколько стоит билет до владивостока', 'tariffs', 'tariffs-yakutia'), direct('в чем отличие', 'tariffs', 'unrecognized'), // ?
		direct('тарифы в вагонах ЖДЯ', 'tariffs-yakutia'), direct('какие социальные льготы есть?', 'privileges'),
		direct('сколько стоит билет для детей?', 'faq-child'), direct('какие акции сейчас есть?', 'promo'), direct('целое купе', 'promo-kupek'),
		direct('какие часто задаваемые вопросы?', 'faq'), direct('Что входит в стоимость проезда?', 'faq-price-includes'),
		direct('сколько мест в  купэ?', 'promo-kupek', 'tariffs-yakutia'), // ?
		direct('как вернуть билет?', 'refund'), direct('билет на поезд', 'faq-refund')),
	max('disabled after online purchase', direct('купить билет', 'buy'), direct('онлайн', 'buy-online'), direct('для инвалидов', 'limited-mobility')),
	max('December fare and carriers', direct('Тариф с Нижнего Бестяха до Благовещенска на декабрь 2026 года?', 'tariffs', 'tariffs-yakutia'),
		direct('поезд Нижний-Бестях - Благовещенск?', 'schedule-train-317318'), direct('стоимость билетов', 'tariffs'),
		clarify('в ЖДЯ и РЖД', ['tariffs-yakutia', 'tariffs-rzd']),
		direct('ТАРИФЫ вагонов ЖДЯ', 'tariffs-yakutia')),
];
