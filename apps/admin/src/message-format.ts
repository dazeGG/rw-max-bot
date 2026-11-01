// Текст сообщения хранится так, как уходит в MAX: строки через \n и теги <b>, <i>, <a href>.
// В редакторе это абзацы: одна строка — один абзац, пустая строка — пустой абзац

import type { JSONContent } from '@tiptap/core';
import { Bold } from '@tiptap/extension-bold';
import { Document } from '@tiptap/extension-document';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';

export const messageExtensions = [
	Document,
	Paragraph,
	Text,
	Bold,
	Italic,
	Link.configure({
		autolink: false,
		openOnClick: false,
	}),
];

// Иначе пробелы по краям строк потеряются при разборе
export const messageParseOptions = { preserveWhitespace: 'full' } as const;

const TOKEN = /<\/?[abi](?: href="[^"]*")?>|\n|[^<\n]+/g;

// Абзац не может быть внутри тега, поэтому на переводе строки открытые теги закрываем и открываем заново
export const messageToEditorHtml = (text: string): string => {
	const open: string[] = [];
	let html = '<p>';

	for (const [token] of text.matchAll(TOKEN)) {
		if (token === '\n') {
			html += `${[...open].reverse().map(tag => `</${tag[1]}>`).join('')}</p><p>${open.join('')}`;
		} else {
			if (token.startsWith('</')) {
				open.pop();
			} else if (token.startsWith('<')) {
				open.push(token);
			}

			html += token;
		}
	}

	return `${html}</p>`;
};

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Mark = NonNullable<JSONContent['marks']>[number];

const MARK_ORDER = ['link', 'bold', 'italic'];

const openTag = (mark: Mark) => {
	if (mark.type === 'link') {
		return `<a href="${escapeText(String(mark.attrs?.href)).replace(/"/g, '&quot;')}">`;
	}

	return mark.type === 'bold' ? '<b>' : '<i>';
};

const closeTag = (mark: Mark) => {
	if (mark.type === 'link') {
		return '</a>';
	}

	return mark.type === 'bold' ? '</b>' : '</i>';
};

const paragraphToLine = (paragraph: JSONContent) => {
	const open: Mark[] = [];
	let line = '';

	const closeDownTo = (depth: number) => {
		while (open.length > depth) {
			line += closeTag(open.pop()!);
		}
	};

	for (const node of paragraph.content ?? []) {
		const marks = [...node.marks ?? []].sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type));
		let common = 0;

		// Соседние куски с общей разметкой остаются внутри одного тега
		while (common < open.length && common < marks.length && openTag(open[common]) === openTag(marks[common])) {
			common++;
		}

		closeDownTo(common);

		for (const mark of marks.slice(common)) {
			line += openTag(mark);
			open.push(mark);
		}

		line += escapeText(node.text ?? '');
	}

	closeDownTo(0);

	return line;
};

export const editorDocToMessage = (doc: JSONContent): string => (doc.content ?? []).map(paragraphToLine).join('\n');
