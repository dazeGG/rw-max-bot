import { describe, expect, it } from 'vitest';

import { flattenSeed } from '@rw/core';
import type { NodeType } from '@rw/core';

import { linkUrlError, messageError, moveError, normalizeSynonyms, parentError, subtreeIds, targetError } from './content-rules';

const node = (id: number, parentId: number | null, type: NodeType = 'section', targetId: number | null = null) => ({ id, parentId, type, targetId });

// 1 ─ 2 ─ 3
//   └ 4 (ссылка)
//   └ 5 (переход в 3)
//   └ 6 (переход в 5)
const tree = [node(1, null), node(2, 1), node(3, 2), node(4, 1, 'link'), node(5, 1, 'goto', 3), node(6, 1, 'goto', 5)];

describe('текст сообщения', () => {
	it('весь начальный контент проходит проверку', () => {
		for (const seed of flattenSeed()) {
			expect(seed.text === null ? null : messageError(seed.text), seed.code).toBeNull();
		}
	});

	it('принимает разрешенную разметку', () => {
		expect(messageError('<b>Жирный <i>курсив</i></b> <a href="tel:88005500620">телефон</a> &amp; текст')).toBeNull();
		expect(messageError('<u>а</u> <s>б</s>')).toBeNull();
		expect(messageError('<h1><b>Заголовок</b></h1>\n<blockquote>строка\n<i>строка</i></blockquote>')).toBeNull();
	});

	it.each([
		['<script>alert(1)</script>'],
		['<a href="javascript:alert(1)">x</a>'],
		['<a href="https://a.ru" onclick="x()">x</a>'],
		['<b>не закрыт'],
		['<b><i>наоборот</b></i>'],
		['лишний </b>'],
		['обрывок <b'],
		['<img src=x>'],
		['<b><h1>заголовок внутри</h1></b>'],
		['<blockquote><h1>заголовок в цитате</h1></blockquote>'],
		['<h2>другой уровень</h2>'],
		['<mark>маркер MAX показывает обычным текстом</mark>'],
		['<code>код тоже</code>'],
		['<u onclick="x()">м</u>'],
		['<strong>синоним тега</strong>'],
		['<a>без адреса</a>'],
		['</a>'],
		['<u>не закрыт'],
	])('отклоняет %s', text => {
		expect(messageError(text)).not.toBeNull();
	});

	it('ограничивает длину', () => {
		expect(messageError('я'.repeat(4000))).toBeNull();
		expect(messageError('я'.repeat(4001))).not.toBeNull();
	});
});

describe('ссылка', () => {
	it('все ссылки начального контента проходят проверку', () => {
		for (const seed of flattenSeed().filter(item => item.type === 'link')) {
			expect(linkUrlError(seed.url), seed.code).toBeNull();
		}
	});

	it.each([[null], [''], ['сайт.рф'], ['javascript:alert(1)'], ['tel:123']])('отклоняет %s', url => {
		expect(linkUrlError(url)).not.toBeNull();
	});
});

describe('структура дерева', () => {
	it('находит раздел со всеми вложенными', () => {
		expect(subtreeIds(tree, 2)).toEqual(new Set([2, 3]));
		expect(subtreeIds(tree, 1).size).toBe(6);
	});

	it('не зависает на цикле в данных', () => {
		expect(subtreeIds([node(1, 2), node(2, 1)], 1)).toEqual(new Set([1, 2]));
	});

	it('вложенные пункты только у раздела', () => {
		expect(parentError(tree, 2)).toBeNull();
		expect(parentError(tree, 4)).not.toBeNull();
		expect(parentError(tree, 5)).not.toBeNull();
		expect(parentError(tree, 99)).not.toBeNull();
	});

	it('перенос', () => {
		expect(moveError(tree, 3, 1)).toBeNull();
		expect(moveError(tree, 1, 2), 'корень').not.toBeNull();
		expect(moveError(tree, 2, 2), 'в себя').not.toBeNull();
		expect(moveError(tree, 2, 3), 'во вложенный').not.toBeNull();
		expect(moveError(tree, 3, 4), 'в ссылку').not.toBeNull();
	});

	it('цель перехода', () => {
		expect(targetError(tree, null, 3)).toBeNull();
		expect(targetError(tree, 5, 2)).toBeNull();
		expect(targetError(tree, 5, null), 'нет цели').not.toBeNull();
		expect(targetError(tree, 5, 99), 'неизвестная цель').not.toBeNull();
		expect(targetError(tree, 5, 5), 'в себя').not.toBeNull();
		expect(targetError(tree, 5, 6), 'цикл через другой переход').not.toBeNull();
	});
});

describe('синонимы', () => {
	it('убирает пустые, лишние пробелы и повторы', () => {
		expect(normalizeSynonyms([' как сдать билет ', '', '  ', 'как сдать билет', 'вернуть деньги'])).toEqual(['как сдать билет', 'вернуть деньги']);
	});
});
