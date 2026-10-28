import { describe, expect, it } from 'vitest';

import { escapeHtml, normalize, stripGreeting, stripGreetingRaw } from './text';

describe('normalize для протокольных команд', () => {
	it('нормализует регистр, ё, пунктуацию и пробелы, не удаляя слова', () => {
		expect(normalize('  Подскажите, пожалуйста, как мне купить билет? ')).toBe('подскажите пожалуйста как мне купить билет');
		expect(normalize('Ещё — билет №317!')).toBe('еще билет 317');
	});

	it('убирает HTML-теги, сохраняя текст', () => {
		expect(normalize('<b>Меню</b>')).toBe('меню');
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

describe('stripGreetingRaw для семантического запроса', () => {
	it.each([
		['Здравствуйте, как настроить C++ и C#?', true, 'как настроить C++ и C#?'],
		['ДОБРЫЙ\tДЕНЬ! Цена 3.14 или 2,75?', true, 'Цена 3.14 или 2,75?'],
		['Привет — Где моя книга?', true, 'Где моя книга?'],
		['Hello, is C# different from C++?', true, 'is C# different from C++?'],
		['Добрый день!', true, ''],
		['привет', true, ''],
		['Приветствие содержит C++.', false, 'Приветствие содержит C++.'],
		['  C++ или C#?  ', false, 'C++ или C#?'],
		['Какова версия 3.14 и сумма 2,75?', false, 'Какова версия 3.14 и сумма 2,75?'],
		['你好，如何使用 C++？', false, '你好，如何使用 C++？'],
		['Здравствуйте, 如何使用 C#？', true, '如何使用 C#？'],
		['مرحبا، هل يدعم C++؟', false, 'مرحبا، هل يدعم C++؟'],
		['👋 Привет, C++!', false, '👋 Привет, C++!'],
	])('%s', (text, greeting, rest) => {
		expect(stripGreetingRaw(text)).toEqual({ greeting, rest });
	});

	it('does not merge distinct language names or decimal values', () => {
		expect(stripGreetingRaw('C++').rest).not.toBe(stripGreetingRaw('C#').rest);
		expect(stripGreetingRaw('3.14').rest).not.toBe(stripGreetingRaw('314').rest);
	});

	it('keeps line breaks and non-greeting punctuation in the question', () => {
		expect(stripGreetingRaw('Привет! Первый вопрос?\nВторой: C# / C++.')).toEqual({
			greeting: true,
			rest: 'Первый вопрос?\nВторой: C# / C++.',
		});
	});
});

describe('escapeHtml', () => {
	it('экранирует недоверенный текст для ответа MAX', () => {
		expect(escapeHtml('Багаж < 10 кг & A > B')).toBe('Багаж &lt; 10 кг &amp; A &gt; B');
	});
});
