// Текст сообщения хранится так, как уходит в MAX: строки через \n и HTML-теги из официального списка
// (https://dev.max.ru/docs-api/use-cases/sending-messages/text-formatting). <mark> и <code> там есть, но приложение MAX
// показывает их обычным текстом (проверено 2026-11-02), поэтому в редакторе их нет.
// В редакторе это блоки: одна строка — один абзац, пустая строка — пустой абзац

import type { JSONContent } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { Document } from '@tiptap/extension-document';
import { Heading } from '@tiptap/extension-heading';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { Text } from '@tiptap/extension-text';
import { Underline } from '@tiptap/extension-underline';

export const messageExtensions = [
	Document,
	Paragraph,
	Text,
	// MAX показывает все уровни заголовков одинаково, поэтому уровень один
	Heading.configure({ levels: [1] }),
	// В цитате только абзацы: заголовок в ней не из чего было бы сохранить
	Blockquote.extend({ content: 'paragraph+' }),
	Bold,
	Italic,
	Underline,
	Strike,
	Link.configure({
		autolink: false,
		openOnClick: false,
	}),
];

// Иначе пробелы по краям строк потеряются при разборе
export const messageParseOptions = { preserveWhitespace: 'full' } as const;

const TOKEN = /<\/?(?:a|b|i|u|s|h1|blockquote)(?: href="[^"]*")?>|\n|[^<\n]+/g;

const tagName = (tag: string) => /^<\/?([a-z0-9]+)/.exec(tag)![1];

// Абзац не может быть внутри тега, поэтому на переводе строки открытые теги закрываем и открываем заново.
// Перевод строки сразу за заголовком или цитатой только отделяет их от следующего блока
export const messageToEditorHtml = (text: string): string => {
	const inline: string[] = [];
	let html = '';
	let line = '';
	let wrapper = 'p';
	let afterBlock = false;

	const flushLine = () => {
		const closing = [...inline].reverse().map(tag => `</${tagName(tag)}>`).join('');
		html += `<${wrapper}>${line}${closing}</${wrapper}>`;
		line = inline.join('');
	};

	for (const [token] of text.matchAll(TOKEN)) {
		if (token === '\n') {
			if (!afterBlock) {
				flushLine();
			}

			afterBlock = false;
		} else if (token === '<h1>' || token === '<blockquote>') {
			if (line) {
				flushLine();
			}

			afterBlock = false;

			if (token === '<h1>') {
				wrapper = 'h1';
			} else {
				html += token;
			}
		} else if (token === '</h1>' || token === '</blockquote>') {
			flushLine();
			wrapper = 'p';
			afterBlock = true;

			if (token === '</blockquote>') {
				html += token;
			}
		} else {
			if (token.startsWith('</')) {
				inline.pop();
			} else if (token.startsWith('<')) {
				inline.push(token);
			}

			line += token;
			afterBlock = false;
		}
	}

	if (!afterBlock || line) {
		flushLine();
	}

	return html;
};

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Mark = NonNullable<JSONContent['marks']>[number];

const MARK_TAGS: Record<string, string> = {
	bold: 'b',
	italic: 'i',
	underline: 'u',
	strike: 's',
};

const MARK_ORDER = ['link', ...Object.keys(MARK_TAGS)];

const openTag = (mark: Mark) => mark.type === 'link'
	? `<a href="${escapeText(String(mark.attrs?.href)).replace(/"/g, '&quot;')}">`
	: `<${MARK_TAGS[mark.type]}>`;

const closeTag = (mark: Mark) => mark.type === 'link' ? '</a>' : `</${MARK_TAGS[mark.type]}>`;

const inlineToLine = (block: JSONContent) => {
	const open: Mark[] = [];
	let line = '';

	const closeDownTo = (depth: number) => {
		while (open.length > depth) {
			line += closeTag(open.pop()!);
		}
	};

	for (const node of block.content ?? []) {
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

const blockToMessage = (block: JSONContent) => {
	if (block.type === 'heading') {
		return `<h1>${inlineToLine(block)}</h1>`;
	}

	if (block.type === 'blockquote') {
		return `<blockquote>${(block.content ?? []).map(inlineToLine).join('\n')}</blockquote>`;
	}

	return inlineToLine(block);
};

export const editorDocToMessage = (doc: JSONContent): string => (doc.content ?? []).map(blockToMessage).join('\n');
