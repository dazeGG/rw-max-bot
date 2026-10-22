import { phraseKey, stems } from '../dialog/text';

import { ROOT_CODE } from './types';
import type { ContentNode, Settings } from './types';

export type IndexedPhrase = {
	stems: string[];
	key: string;
};

// Снимок контента: дерево разделов и настройки. Неизменяемый, пересобирается при обновлении из БД.
export class ContentTree {
	readonly root: ContentNode;
	readonly settings: Settings;

	private readonly byId = new Map<number, ContentNode>();
	private readonly byCode = new Map<string, ContentNode>();
	private readonly childrenByParent = new Map<number, ContentNode[]>();
	private readonly phrases = new Map<number, IndexedPhrase[]>();
	private readonly nodeStems = new Map<number, Set<string>>();
	private readonly depths = new Map<number, number>();
	// В скольких разделах встречается основа слова: частые слова («билет») весят меньше редких («ребенок»)
	private readonly docFreq = new Map<string, number>();

	constructor (nodes: ContentNode[], settings: Settings) {
		// Узел показывается, только если активны все его предки, а goto ведет в существующий раздел.
		// Удаление узла может сделать недостижимыми другие, поэтому чистим до неподвижной точки.
		let reachable = nodes
			.filter(node => node.isActive)
			.map(node => ({ ...node, synonyms: node.synonyms.filter(Boolean) }));

		for (;;) {
			this.byId.clear();
			reachable.forEach(node => this.byId.set(node.id, node));

			const kept = reachable.filter(node => this.isReachable(node) && this.gotoResolves(node));

			if (kept.length === reachable.length) {
				break;
			}

			reachable = kept;
		}

		this.byId.clear();

		for (const node of reachable) {
			this.byId.set(node.id, node);
			this.byCode.set(node.code, node);

			if (node.parentId !== null) {
				const siblings = this.childrenByParent.get(node.parentId) ?? [];
				siblings.push(node);
				this.childrenByParent.set(node.parentId, siblings);
			}

			const phrases = [node.title, ...node.synonyms].map(phrase => ({
				stems: stems(phrase),
				key: phraseKey(phrase),
			}));
			const unique = new Set(phrases.flatMap(phrase => phrase.stems));

			this.phrases.set(node.id, phrases);
			this.nodeStems.set(node.id, unique);

			for (const stem of unique) {
				this.docFreq.set(stem, (this.docFreq.get(stem) ?? 0) + 1);
			}
		}

		for (const node of reachable) {
			let depth = 0;

			for (let current = node; current.parentId !== null; current = this.byId.get(current.parentId)!) {
				depth++;
			}

			this.depths.set(node.id, depth);
		}

		for (const children of this.childrenByParent.values()) {
			children.sort((a, b) => a.sort - b.sort || a.id - b.id);
		}

		const root = this.byCode.get(ROOT_CODE);

		if (!root) {
			throw new Error(`Content tree has no active node with code "${ROOT_CODE}"`);
		}

		this.root = root;
		this.settings = settings;
	}

	private isReachable (node: ContentNode): boolean {
		let current: ContentNode | undefined = node;
		const seen = new Set<number>();

		while (current && current.parentId !== null) {
			if (seen.has(current.id)) {
				return false;
			}

			seen.add(current.id);
			current = this.byId.get(current.parentId);
		}

		return current?.code === ROOT_CODE;
	}

	private gotoResolves (node: ContentNode): boolean {
		let current: ContentNode | undefined = node;
		const seen = new Set<number>();

		while (current?.type === 'goto') {
			if (seen.has(current.id)) {
				return false;
			}

			seen.add(current.id);
			current = this.get(current.targetId);
		}

		return current !== undefined;
	}

	get (id: number | null | undefined): ContentNode | undefined {
		return id === null || id === undefined ? undefined : this.byId.get(id);
	}

	getByCode (code: string): ContentNode | undefined {
		return this.byCode.get(code);
	}

	children (node: ContentNode): ContentNode[] {
		return this.childrenByParent.get(node.id) ?? [];
	}

	visibleChildren (node: ContentNode): ContentNode[] {
		return this.children(node).filter(child => !child.isHidden);
	}

	parent (node: ContentNode): ContentNode | undefined {
		return this.get(node.parentId);
	}

	all (): ContentNode[] {
		return [...this.byId.values()];
	}

	phrasesOf (node: ContentNode): IndexedPhrase[] {
		return this.phrases.get(node.id) ?? [];
	}

	stemsOf (node: ContentNode): Set<string> {
		return this.nodeStems.get(node.id) ?? new Set();
	}

	depth (node: ContentNode): number {
		return this.depths.get(node.id) ?? 0;
	}

	// Вес основы слова (IDF). Незнакомые слова весят как слово из одного раздела.
	weight (stem: string): number {
		const df = this.docFreq.get(stem) ?? 1;
		return 1 / (1 + Math.log(1 + df));
	}

	// goto-узел ведет в целевой раздел; цепочки goto разворачиваются, циклы обрываются
	resolve (node: ContentNode): ContentNode {
		let current = node;
		const seen = new Set<number>();

		while (current.type === 'goto' && !seen.has(current.id)) {
			seen.add(current.id);
			const target = this.get(current.targetId);

			if (!target) {
				return current;
			}

			current = target;
		}

		return current;
	}
}
