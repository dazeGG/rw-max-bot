// Как раздел выглядит в сообщении. Правила общие: по ним отвечает бот и строит предпросмотр админка

import type { ContentTree } from '../content/tree';
import type { ContentNode } from '../content/types';

import { escapeHtml } from './text';
import type { Reply } from './types';

export const optionLine = (tree: ContentTree, node: ContentNode, qualify = false): string => {
	const target = tree.resolve(node);
	const parents: string[] = [];

	if (qualify) {
		for (let parent = tree.parent(node); parent && parent.id !== tree.root.id; parent = tree.parent(parent)) {
			parents.unshift(parent.title);
		}
	}

	const title = escapeHtml(parents.length > 0 ? `${node.title} (${parents.join(' / ')})` : node.title);

	return target.type === 'link' && target.url ? `<a href="${escapeHtml(target.url)}">${title}</a>` : title;
};

// Варианты ответа перечисляются в тексте сообщения: пользователь отвечает своими словами или номером.
// Вопрос («…интересует?», «…по темам:») и его варианты — один блок, без пустой строки между ними;
// после адреса или примечания список ссылок отделяется пустой строкой
export const withOptions = (tree: ContentTree, text: string, options: ContentNode[], distinguishBranches = false): string => {
	if (options.length === 0) {
		return text;
	}

	const separator = /[?:]\s*$/.test(text) ? '\n' : '\n\n';
	const qualify = distinguishBranches && new Set(options.map(node => node.parentId)).size > 1;

	return `${text}${separator}${options.map((option, i) => `${i + 1}. ${optionLine(tree, option, qualify)}`).join('\n')}`;
};

// Конечный ответ — раздел без вариантов ответа или ссылка
export const isFinal = (tree: ContentTree, node: ContentNode): boolean =>
	node.id !== tree.root.id && (node.type === 'link' || tree.visibleChildren(node).every(child => tree.resolve(child).type === 'link'));

export const renderNode = (tree: ContentTree, node: ContentNode): Reply => {
	const text = node.text ?? `<b>${escapeHtml(node.title)}</b>`;

	return {
		text: withOptions(tree, text, tree.visibleChildren(node)),
		...node.image ? { image: node.image } : {},
		...node.file ? { file: { path: node.file, name: node.fileName ?? node.file } } : {},
	};
};

// Что пассажир получит, открыв пункт
export const nodeReplies = (tree: ContentTree, node: ContentNode): Reply[] => {
	const target = tree.resolve(node);
	// Конец цепочки: отдельным сообщением бот спрашивает, нужно ли что-то еще
	const anythingElse: Reply[] = isFinal(tree, target) ? [{ text: tree.settings['text.anythingElse'] }] : [];

	return target.type === 'link'
		? [{ text: target.text ?? optionLine(tree, node) }, ...anythingElse]
		: [renderNode(tree, target), ...anythingElse];
};
