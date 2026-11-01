import type { AdminContentNode, ContentNode, Settings } from '@rw/core';
import { ContentTree, nodeReplies } from '@rw/core/render';

export type Tree = {
	root: AdminContentNode | undefined;
	byId: Map<number, AdminContentNode>;
	children: Map<number, AdminContentNode[]>;
};

export const buildTree = (nodes: AdminContentNode[]): Tree => {
	const byId = new Map(nodes.map(node => [node.id, node]));
	const children = new Map<number, AdminContentNode[]>();

	for (const node of nodes) {
		if (node.parentId !== null) {
			children.set(node.parentId, [...children.get(node.parentId) ?? [], node]);
		}
	}

	for (const list of children.values()) {
		list.sort((a, b) => a.sort - b.sort || a.id - b.id);
	}

	return {
		root: nodes.find(node => node.parentId === null),
		byId,
		children,
	};
};

// От корня до раздела. Защита от цикла: БД могли поправить вручную
export const ancestorsOf = (tree: Tree, id: number): AdminContentNode[] => {
	const chain: AdminContentNode[] = [];
	const seen = new Set<number>();

	for (let current = tree.byId.get(tree.byId.get(id)?.parentId ?? -1); current && !seen.has(current.id); current = tree.byId.get(current.parentId ?? -1)) {
		seen.add(current.id);
		chain.unshift(current);
	}

	return chain;
};

export const pathOf = (tree: Tree, node: AdminContentNode): string =>
	[...ancestorsOf(tree, node.id).filter(item => item.parentId !== null), node].map(item => item.title).join(' / ');

export const subtreeOf = (tree: Tree, id: number): Set<number> => {
	const ids = new Set<number>();
	const queue = [id];

	for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
		if (!ids.has(current)) {
			ids.add(current);
			queue.push(...(tree.children.get(current) ?? []).map(child => child.id));
		}
	}

	return ids;
};

// Разделы, подходящие под поиск, и их родители: без родителей раздел некуда показать в дереве
export const matchingIds = (tree: Tree, query: string): Set<number> => {
	const needle = query.trim().toLowerCase();
	const ids = new Set<number>();

	for (const node of tree.byId.values()) {
		if (`${node.title} ${node.synonyms.join(' ')}`.toLowerCase().includes(needle)) {
			ids.add(node.id);
			ancestorsOf(tree, node.id).forEach(ancestor => ids.add(ancestor.id));
		}
	}

	return ids;
};

// Куда встанет перетаскиваемый раздел. side — с какой стороны от node: -1 выше, 1 ниже.
// index — место среди соседей без учета самого раздела, так его ждет API
export const dropPlace = (tree: Tree, dragId: number, nodeId: number, dropToGap: boolean, side: number) => {
	if (!dropToGap) {
		return {
			parentId: nodeId,
			index: 0,
		};
	}

	const parentId = tree.byId.get(nodeId)?.parentId ?? nodeId;
	const siblings = (tree.children.get(parentId) ?? []).filter(child => child.id !== dragId);

	return {
		parentId,
		index: siblings.findIndex(child => child.id === nodeId) + (side > 0 ? 1 : 0),
	};
};

export const isSamePlace = (tree: Tree, dragId: number, place: { parentId: number; index: number; }) =>
	(tree.children.get(place.parentId) ?? []).findIndex(child => child.id === dragId) === place.index;

// Что покажет бот, если сохранить черновик. Сам раздел и его родители считаются включенными, чтобы готовый текст
// можно было посмотреть до включения. Пустой список — бот отбросит пункт: у перехода нет работающей цели
export const previewReplies = (tree: Tree, settings: Settings, draft: ContentNode) => {
	const chain = new Set(ancestorsOf(tree, draft.id).map(node => node.id));

	const nodes = [...tree.byId.values()].map(node => {
		if (node.id === draft.id) {
			return { ...draft, isActive: true };
		}

		return chain.has(node.id) ? { ...node, isActive: true } : node;
	});

	const preview = new ContentTree(nodes, settings);
	const node = preview.get(draft.id);

	return node ? nodeReplies(preview, node) : [];
};
