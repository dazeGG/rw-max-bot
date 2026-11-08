// Правила редактора дерева: без БД, чтобы их можно было проверить на начальном контенте

import { supportDaysError, supportTimeError } from '@rw/core';
import type { ContentNode, ContentVersionEntry, NodeType, SettingKey } from '@rw/core';

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

// Поля раздела в постоянном порядке: по этому виду считается хеш версии и сравниваются снимки.
// В старых снимках новых полей может не быть, а JSONB не хранит порядок ключей
export const toContentNode = (node: ContentNode): ContentNode => ({
	id: node.id,
	parentId: node.parentId,
	code: node.code,
	type: node.type,
	title: node.title,
	text: node.text ?? null,
	url: node.url ?? null,
	targetId: node.targetId ?? null,
	image: node.image ?? null,
	imageText: node.imageText ?? null,
	tables: node.tables ?? null,
	file: node.file ?? null,
	fileName: node.fileName ?? null,
	synonyms: node.synonyms ?? [],
	sort: node.sort,
	isActive: node.isActive,
	isHidden: node.isHidden,
});

export const diffContent = (current: ContentNode[], target: ContentNode[]) => {
	const currentById = new Map(current.map(node => [node.id, node]));
	const targetIds = new Set(target.map(node => node.id));

	return {
		changed: target.filter(node => currentById.has(node.id) && JSON.stringify(node) !== JSON.stringify(currentById.get(node.id))),
		returned: target.filter(node => !currentById.has(node.id)),
		removed: current.filter(node => !targetIds.has(node.id)),
	};
};

// Разделы снимка без ключа tables: старый снимок про таблицы не знает, и это не то же самое, что null
export const legacyTableIds = (raw: Partial<ContentNode>[]): Set<number> => new Set(raw.filter(node => !('tables' in node)).map(node => node.id!));

// Если картинка раздела та же, она по-прежнему нарисована по текущей таблице: возврат к старому снимку не должен ее стирать
export const keepTables = (current: ContentNode[], target: ContentNode[], legacy: Set<number>): ContentNode[] => {
	const currentById = new Map(current.map(node => [node.id, node]));

	return target.map(node => {
		const now = currentById.get(node.id);

		return now?.tables && legacy.has(node.id) && node.image === now.image ? { ...node, tables: now.tables, imageText: now.imageText } : node;
	});
};

// Картинки и текст с картинки меняет только суперадмин, в том числе возвратом версии.
// Исключение: админ возвращает раздел, у которого таблицы есть и сейчас, и в целевой версии, — картинка вернется вместе с таблицей.
// Раздел, вернувшийся или исчезнувший целиком, не считается: удалять разделы с картинками админу можно
export const imagesChanged = (current: ContentNode[], changed: ContentNode[]): boolean => {
	const currentById = new Map(current.map(node => [node.id, node]));

	return changed.some(node => {
		const now = currentById.get(node.id);

		if (now?.tables && node.tables) {
			return false;
		}

		// Снятие таблицы превращает раздел в обычную картинку: это тоже только суперадмин
		return node.image !== now?.image || node.imageText !== now?.imageText || (now?.tables != null) !== (node.tables != null);
	});
};

export const settingError = (key: SettingKey, value: string, nodes: Pick<ContentNode, 'code' | 'parentId'>[]): string | null => {
	if (key === 'search.handoff') {
		return value === '' || nodes.some(node => node.code === value && node.parentId !== null) ? null : 'Раздел для пункта «Нет подходящего варианта» не найден';
	}

	if (key === 'support.open' || key === 'support.close') {
		return supportTimeError(value);
	}

	if (key === 'support.days') {
		return supportDaysError(value);
	}

	if (key === 'text.supportOffHours' && !value.includes('{next}')) {
		return 'В тексте должно быть {next}: на это место бот подставит, когда ответят';
	}

	return value.trim() ? messageError(value) : 'Служебный текст не может быть пустым';
};

type HistoryEdit = {
	id: number;
	createdAt: Date;
	actorName: string;
	action: string;
	details: Record<string, unknown>;
};

type HistorySnapshot = {
	version: string;
	createdAt: Date;
};

export const HISTORY_LIMIT = 100;

// Правки из журнала и снимки, появившиеся без правки: начальное состояние и изменения через SQL.
// Снимок правки записан в той же транзакции и с тем же временем: при сортировке правка остается выше снимка до нее.
// Более поздняя правка с той же версией — это возврат к снимку, сам снимок при этом остается в истории
export const mergeHistory = (edits: HistoryEdit[], snapshots: HistorySnapshot[], currentVersion: string): ContentVersionEntry[] => {
	const firstEdit = new Map<string, number>();

	for (const edit of edits) {
		const version = String(edit.details.version);
		firstEdit.set(version, Math.min(edit.createdAt.getTime(), firstEdit.get(version) ?? Infinity));
	}

	const entries = [
		...edits.map(edit => ({
			id: `edit-${edit.id}`,
			version: String(edit.details.version),
			time: edit.createdAt,
			actorName: edit.actorName as string | null,
			action: edit.action as string | null,
			title: typeof edit.details.title === 'string' ? edit.details.title : null,
			fields: [edit.details.fields, edit.details.keys].flatMap(list => Array.isArray(list) ? list.map(String) : []),
		})),
		...snapshots.filter(snapshot => snapshot.createdAt.getTime() < (firstEdit.get(snapshot.version) ?? Infinity)).map(snapshot => ({
			id: `version-${snapshot.version}`,
			version: snapshot.version,
			time: snapshot.createdAt,
			actorName: null,
			action: null,
			title: null,
			fields: [],
		})),
	].sort((a, b) => b.time.getTime() - a.time.getTime()).slice(0, HISTORY_LIMIT);

	const currentId = entries.find(entry => entry.version === currentVersion)?.id;

	return entries.map(({ time, ...entry }) => ({
		...entry,
		createdAt: time.toISOString(),
		current: entry.id === currentId,
		restorable: entry.version !== currentVersion,
	}));
};
