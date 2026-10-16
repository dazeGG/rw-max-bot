import { describe, expect, it } from 'vitest';

import { stem } from './stemmer';
import { phraseKey, stripGreeting, tokenize } from './text';

describe('stem', () => {
	it.each([
		['билеты', 'билет'],
		['билетов', 'билет'],
		['дальнего', 'дальн'],
		['дальний', 'дальн'],
		['ребёнка', 'ребенк'],
		['поезда', 'поезд'],
	])('%s → %s', (word, expected) => {
		expect(stem(word)).toBe(expected);
	});

	it('не трогает цифры и латиницу', () => {
		expect(stem('317')).toBe('317');
		expect(stem('faq')).toBe('faq');
	});
});

describe('tokenize', () => {
	it('убирает служебные слова, но оставляет «да» и «нет»', () => {
		expect(tokenize('Подскажите, пожалуйста, как мне купить билет?')).toEqual(['купить', 'билет']);
		expect(tokenize('нет')).toEqual(['нет']);
		expect(tokenize('да')).toEqual(['да']);
	});
});

describe('stripGreeting', () => {
	it.each([
		['Здравствуйте, как купить билет?', true, 'как купить билет'],
		['Добрый день!', true, ''],
		['привет', true, ''],
		['приветствие', false, 'приветствие'],
		['как купить билет', false, 'как купить билет'],
	])('%s', (text, greeting, rest) => {
		expect(stripGreeting(text)).toEqual({ greeting, rest });
	});
});

describe('phraseKey', () => {
	it('одинаков для вопроса и синонима', () => {
		expect(phraseKey('Как мне сдать билет?')).toBe(phraseKey('сдать билет'));
	});
});
