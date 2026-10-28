import { describe, expect, it } from 'vitest';

import { escapeHtml, normalize, stripGreeting } from './text';

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

describe('escapeHtml', () => {
	it('экранирует недоверенный текст для ответа MAX', () => {
		expect(escapeHtml('Багаж < 10 кг & A > B')).toBe('Багаж &lt; 10 кг &amp; A &gt; B');
	});
});
