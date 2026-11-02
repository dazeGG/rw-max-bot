// @vitest-environment happy-dom

import { createDocument, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { flattenSeed } from '@rw/core';
import type { JSONContent } from '@tiptap/core';

import { editorDocToMessage, messageExtensions, messageParseOptions, messageToEditorHtml } from './message-format';

const schema = getSchema(messageExtensions);

// Как при создании редактора: тот же разбор HTML, те же настройки
const throughEditor = (text: string) =>
	editorDocToMessage(createDocument(messageToEditorHtml(text), schema, messageParseOptions).toJSON() as JSONContent);

// Посимвольно: какой символ с какой разметкой. Порядок тегов и разрыв <b> на переводе строки пассажир не увидит
const appearance = (text: string) => {
	const open: string[] = [];
	const chars: string[] = [];

	for (const [token] of text.matchAll(/<\/?[abi](?: href="[^"]*")?>|&[a-z]+;|[^]/g)) {
		if (token.startsWith('</')) {
			open.pop();
		} else if (token.length > 1 && token.startsWith('<')) {
			open.push(token);
		} else if (token !== '\n') {
			chars.push(`${token}|${[...open].sort().join('')}`);
		} else {
			chars.push(token);
		}
	}

	return chars;
};

describe('текст в редакторе', () => {
	it.each([
		['простой текст'],
		['первая строка\nвторая строка'],
		['абзац\n\nчерез пустую строку'],
		['<b>жирный</b> и <i>курсив</i>'],
		['<b>жирный</b> <i>курсив</i>'],
		['<a href="https://rw-y.ru/a?b=1">сайт</a>, <a href="tel:88005500620">телефон</a>'],
		['  пробелы по краям  '],
		['значок &amp; и &lt;скобка&gt;'],
		['<a href="https://rw-y.ru"><b>жирная</b> ссылка</a>'],
		['<u>подчеркнутый</u> <s>зачеркнутый</s> <mark>выделенный</mark> <code>A-123</code>'],
		['<b><u>жирный и подчеркнутый</u></b>'],
		['<h1>Заголовок</h1>'],
		['<h1>Заголовок</h1>\nтекст'],
		['<h1>Заголовок</h1>\n\nтекст через пустую строку'],
		['текст\n<h1>Заголовок</h1>'],
		['текст\n\n<h1>Заголовок</h1>\nтекст'],
		['<h1><a href="https://rw-y.ru">Заголовок-ссылка</a></h1>'],
		['<blockquote>цитата</blockquote>'],
		['<blockquote>строка 1\nстрока 2</blockquote>\nтекст'],
		['<blockquote>строка 1\n\nстрока 3</blockquote>'],
		['текст\n\n<blockquote><b>жирная</b> цитата</blockquote>'],
		['<h1>Заголовок</h1>\n<blockquote>цитата</blockquote>\n<h1>Еще один</h1>'],
	])('не меняется: %s', text => {
		expect(throughEditor(text)).toBe(text);
	});

	it('сохраняет разметку через перевод строки', () => {
		expect(throughEditor('<b>один\nдва</b>')).toBe('<b>один</b>\n<b>два</b>');
	});

	it('не ломает начальный контент: пассажир видит то же самое', () => {
		const texts = flattenSeed().map(seed => seed.text).filter(text => text !== null);

		expect(texts.length).toBeGreaterThan(0);

		for (const text of texts) {
			expect(appearance(throughEditor(text))).toEqual(appearance(text));
		}
	});

	it('повторное прохождение через редактор ничего не меняет', () => {
		for (const seed of flattenSeed().filter(item => item.text !== null)) {
			const once = throughEditor(seed.text!);
			expect(throughEditor(once)).toBe(once);
		}
	});

	it('экранирует то, что напечатал сотрудник', () => {
		const doc = {
			type: 'doc',
			content: [{
				type: 'paragraph',
				content: [{ type: 'text', text: '<script> & "кавычки"' }],
			}],
		};

		expect(editorDocToMessage(doc)).toBe('&lt;script&gt; &amp; "кавычки"');
	});

	it('пустой редактор — пустой текст', () => {
		expect(editorDocToMessage({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
	});
});
