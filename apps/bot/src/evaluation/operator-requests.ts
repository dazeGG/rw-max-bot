// Evaluation-only fixtures. No runtime routing imports this module.
// Просьбы позвать человека и похожие на них фразы, которые оператора не просят.
// Набор отдельный: эталоны реальных диалогов и замороженный heldout не меняются.
// Пункт оператора живет в контенте (синонимы раздела operator в seed-data.ts), здесь только проверка того, как поиск с ним справляется.
import type { Step } from './fixtures';

export const OPERATOR_REQUESTS_VERSION = '2026-11-10-v1';

// Ожидается переход к оператору сразу или уточнение, где пункт оператора есть среди вариантов
export const operatorRequests: Step[] = [
	{ text: 'позови оператора', expected: ['operator'] },
	{ text: 'Хочу поговорить с живым человеком', expected: ['operator'] },
	{ text: 'соедините меня с оператором', expected: ['operator'] },
	{ text: 'можно написать сотруднику поддержки?', expected: ['operator'] },
	{ text: 'мне нужен живой оператор, а не бот', expected: ['operator'] },
	{ text: 'переключите на оператора пожалуйста', expected: ['operator'] },
	{ text: 'позовите кого-нибудь из сотрудников', expected: ['operator'] },
	{ text: 'хочу пообщаться с человеком', expected: ['operator'] },
	{ text: 'как связаться с оператором', expected: ['operator'] },
	{ text: 'нужна помощь оператора', expected: ['operator'] },
];

// Похожие по смыслу, но другие просьбы: прямого перехода к оператору быть не должно.
// expected — разделы, которые подошли бы пассажиру; проверка смотрит только на то, что оператор не открылся сам
export const notOperatorRequests: Step[] = [
	{ text: 'телефон справочной', expected: ['support'] },
	{ text: 'как позвонить в справочную', expected: ['support'] },
	{ text: 'как связаться с РЖД', expected: ['support'] },
	{ text: 'горячая линия РЖД', expected: ['support'] },
	{ text: 'жалоба на проводника', expected: ['question'] },
	{ text: 'сотрудник нагрубил, хочу пожаловаться', expected: ['question'] },
	{ text: 'как оставить заявку на сайте', expected: ['question'] },
	{ text: 'где находится касса', expected: ['buy'] },
	{ text: 'адрес электронной почты для вопросов по билетам', expected: ['support'] },
	{ text: 'как работает служба поддержки клиентов', expected: ['support'] },
	{ text: 'кто может помочь пассажиру на коляске', expected: ['limited-mobility'] },
	{ text: 'номер телефона кассы', expected: ['support', 'buy'] },
];
