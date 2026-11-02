// Правила редактора дерева: без БД, чтобы их можно было проверить на начальном контенте

import type { NodeType } from '@rw/core';

// Лимит текста сообщения в API MAX
export const MAX_MESSAGE_LENGTH = 4000;

const MESSAGE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'tel:', 'mailto:']);
const LINK_NODE_PROTOCOLS = new Set(['http:', 'https:']);
const INLINE_TAGS = new Set(['b', 'i', 'u', 's']);
const BLOCK_TAGS = new Set(['h1', 'blockquote']);

type TreeNode = {
	id: number;
	parentId: number | null;
	type: NodeType;
	targetId: number | null;
};

const hasProtocol = (url: string, protocols: Set<string>) => {
	try {
		return protocols.has(new URL(url).protocol);
	} catch {
		return false;
	}
};

// Текст уходит в MAX как HTML: разрешена только разметка, которую умеет редактор
export const messageError = (text: string): string | null => {
	if (text.length > MAX_MESSAGE_LENGTH) {
		return `Текст длиннее ${MAX_MESSAGE_LENGTH} символов`;
	}

	const open: string[] = [];

	for (const [tag] of text.matchAll(/<[^>]*>?/g)) {
		const link = /^<a href="([^"]*)">$/.exec(tag);
		const plain = /^<(\/?)([a-z0-9]+)>$/.exec(tag);

		if (link) {
			if (!hasProtocol(link[1], MESSAGE_LINK_PROTOCOLS)) {
				return `Недопустимая ссылка в тексте: ${link[1]}`;
			}

			open.push('a');
		} else if (plain?.[1] === '/' && open.at(-1) === plain[2]) {
			open.pop();
		} else if (plain?.[1] === '' && (INLINE_TAGS.has(plain[2]) || (BLOCK_TAGS.has(plain[2]) && open.length === 0))) {
			// Заголовок и цитата — отдельные блоки: внутрь другой разметки они не вкладываются
			open.push(plain[2]);
		} else {
			return `Недопустимая разметка в тексте: ${tag}`;
		}
	}

	return open.length > 0 ? `Незакрытая разметка в тексте: <${open.at(-1)}>` : null;
};

export const linkUrlError = (url: string | null | undefined): string | null =>
	url && hasProtocol(url, LINK_NODE_PROTOCOLS) ? null : 'Ссылка должна начинаться с http:// или https://';

export const subtreeIds = (nodes: TreeNode[], id: number): Set<number> => {
	const ids = new Set([id]);

	// Дерево могли поправить напрямую в БД, поэтому без рекурсии: цикл здесь не зависнет
	for (let grew = true; grew;) {
		grew = false;

		for (const node of nodes) {
			if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) {
				ids.add(node.id);
				grew = true;
			}
		}
	}

	return ids;
};

// Вариант ответа может быть только у раздела: у ссылки и перехода вложенные пункты бот не показывает
export const parentError = (nodes: TreeNode[], parentId: number): string | null =>
	nodes.find(node => node.id === parentId)?.type === 'section' ? null : 'Вложенные пункты могут быть только у раздела';

export const moveError = (nodes: TreeNode[], id: number, parentId: number): string | null => {
	if (nodes.find(node => node.id === id)?.parentId === null) {
		return 'Корень перенести нельзя';
	}

	return subtreeIds(nodes, id).has(parentId) ? 'Нельзя перенести раздел внутрь него самого' : parentError(nodes, parentId);
};

// id — переход, которому задают цель; null, если он еще не создан
export const targetError = (nodes: TreeNode[], id: number | null, targetId: number | null | undefined): string | null => {
	const byId = new Map(nodes.map(node => [node.id, node]));
	const seen = new Set<number>();

	if (targetId === null || targetId === undefined || !byId.has(targetId)) {
		return 'Выберите раздел, куда ведет переход';
	}

	for (let current = byId.get(targetId); current?.type === 'goto' || current?.id === id; current = byId.get(current.targetId ?? -1)) {
		if (current.id === id || seen.has(current.id)) {
			return 'Переход не может вести сам в себя';
		}

		seen.add(current.id);
	}

	return null;
};

export const normalizeSynonyms = (synonyms: string[]): string[] =>
	[...new Set(synonyms.map(synonym => synonym.trim()).filter(Boolean))];
