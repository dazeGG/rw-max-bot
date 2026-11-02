import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, flattenSeed } from '@rw/core';
import type { ContentNode, NodeType, SettingKey } from '@rw/core';

import { diffContent, imagesChanged, linkUrlError, mergeHistory, messageError, moveError, normalizeSynonyms, parentError, settingError, subtreeIds, targetError, toContentNode } from './content-rules';

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

describe('история версий', () => {
	const seed = flattenSeed().slice(0, 4).map(toContentNode);

	it('вид раздела не зависит от порядка ключей и старых снимков без новых полей', () => {
		const old: Partial<ContentNode> = { ...seed[1] };
		delete old.imageText;
		const reversed = Object.fromEntries(Object.entries(old).reverse()) as ContentNode;

		expect(JSON.stringify(toContentNode(reversed))).toBe(JSON.stringify(toContentNode({ ...seed[1], imageText: null })));
	});

	it('различия: изменен, вернулся, исчез', () => {
		const [root, first, second, third] = seed;
		const diff = diffContent([root, first, second], [root, { ...first, title: 'Новое' }, third]);

		expect(diff.changed.map(item => item.id)).toEqual([first.id]);
		expect(diff.returned.map(item => item.id)).toEqual([third.id]);
		expect(diff.removed.map(item => item.id)).toEqual([second.id]);
	});

	it('одинаковые версии без различий', () => {
		expect(diffContent(seed, seed.map(toContentNode))).toEqual({ changed: [], returned: [], removed: [] });
	});

	it('картинки меняет только суперадмин: важны только измененные разделы', () => {
		const [root, first] = seed;

		expect(imagesChanged([root, first], [{ ...first, title: 'x' }])).toBe(false);
		expect(imagesChanged([root, first], [{ ...first, image: 'new.jpg' }])).toBe(true);
		expect(imagesChanged([root, first], [{ ...first, imageText: 'новые цены' }])).toBe(true);
	});

	const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 10, minute));
	const edit = (id: number, minute: number, version: string) => ({
		id,
		createdAt: at(minute),
		actorName: 'Сотрудник',
		action: 'content.update',
		details: { version, title: 'Раздел', fields: ['text'] },
	});

	it('собирает правки и снимки без автора, новые сверху', () => {
		const history = mergeHistory(
			[edit(2, 20, 'b'), edit(1, 10, 'a')],
			[{ version: 'b', createdAt: at(20) }, { version: 'a', createdAt: at(10) }, { version: 'start', createdAt: at(1) }],
			'b',
		);

		expect(history.map(entry => entry.version)).toEqual(['b', 'a', 'start']);
		expect(history[0]).toMatchObject({ actorName: 'Сотрудник', title: 'Раздел', fields: ['text'], current: true, restorable: false });
		expect(history[2]).toMatchObject({ actorName: null, current: false, restorable: true });
	});

	it('в истории видно, какие служебные тексты изменились', () => {
		const settingsEdit = { ...edit(1, 10, 'a'), action: 'settings.update', details: { version: 'a', title: 'Служебные тексты', keys: ['text.goodbye'] } };

		expect(mergeHistory([settingsEdit], [], 'a')[0].fields).toEqual(['text.goodbye']);
	});

	it('снимок до первой правки с тем же временем остается ниже нее', () => {
		const history = mergeHistory([edit(1, 10, 'a')], [{ version: 'start', createdAt: at(10) }, { version: 'a', createdAt: at(10) }], 'a');

		expect(history.map(entry => entry.version)).toEqual(['a', 'start']);
	});

	it('возврат к начальной версии не убирает ее строку из истории', () => {
		const history = mergeHistory([edit(2, 20, 'start'), edit(1, 10, 'a')], [{ version: 'a', createdAt: at(10) }, { version: 'start', createdAt: at(1) }], 'start');

		expect(history.map(entry => [entry.version, entry.actorName, entry.current])).toEqual([
			['start', 'Сотрудник', true],
			['a', 'Сотрудник', false],
			['start', null, false],
		]);
	});

	it('при возврате к старому состоянию текущей помечена только верхняя запись', () => {
		const history = mergeHistory([edit(3, 30, 'a'), edit(2, 20, 'b'), edit(1, 10, 'a')], [], 'a');

		expect(history.map(entry => entry.current)).toEqual([true, false, false]);
		expect(history.map(entry => entry.restorable)).toEqual([false, true, false]);
	});
});

describe('служебные тексты', () => {
	const nodes = [{ code: 'root', parentId: null }, { code: 'support', parentId: 1 }];

	it('все значения по умолчанию проходят проверку', () => {
		for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
			expect(settingError(key as SettingKey, value, nodes), key).toBeNull();
		}
	});

	it('текст не может быть пустым или с недопустимой разметкой', () => {
		expect(settingError('text.greeting', '  ', nodes)).not.toBeNull();
		expect(settingError('text.greeting', '<script>x</script>', nodes)).not.toBeNull();
		expect(settingError('text.greeting', '<b>Здравствуйте!</b>', nodes)).toBeNull();
	});

	it('пункт поддержки ведет в существующий раздел или выключен', () => {
		expect(settingError('search.handoff', '', nodes)).toBeNull();
		expect(settingError('search.handoff', 'support', nodes)).toBeNull();
		expect(settingError('search.handoff', 'нет-такого', nodes)).not.toBeNull();
		expect(settingError('search.handoff', 'root', nodes), 'корень').not.toBeNull();
	});
});
