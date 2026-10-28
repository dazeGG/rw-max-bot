import path from 'node:path';

import { pipeline } from '@huggingface/transformers';

import type { Candidate, ContentNode, ContentTree, DialogSearch } from '@rw/core';
import { repoPath } from '@rw/runtime';

export const E5_MODEL = 'Xenova/multilingual-e5-small';
export const E5_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';

export type Encoder = (texts: string[]) => Promise<number[][]>;
type Passage = { nodeId: number; text: string; };
type Index = { passages: Passage[]; vectors: number[][]; };

const plainText = (html: string) => html
	.replace(/<[^>]*>/g, ' ')
	.replace(/&nbsp;/g, ' ')
	.replace(/&amp;/g, '&')
	.replace(/&lt;/g, '<')
	.replace(/&gt;/g, '>')
	.replace(/&quot;/g, '"')
	.replace(/\s+/g, ' ').trim();

const nodePath = (tree: ContentTree, node: ContentNode): string => {
	const titles: string[] = [];
	for (let current: ContentNode | undefined = node; current && current.id !== tree.root.id; current = tree.parent(current)) {
		titles.unshift(current.title);
	}
	return titles.join(' — ');
};

// Short overlapping word chunks keep headings + text within E5's 512-token input.
// The tokenizer is the final authority and also truncates at its model limit.
const chunks = (text: string): string[] => {
	const words = text.split(/\s+/).filter(Boolean);
	const result: string[] = [];
	for (let start = 0; start < words.length;) {
		let end = start;
		let length = 0;
		while (end < words.length && (length < 650 || end === start)) {
			length += words[end++].length + 1;
		}
		result.push(words.slice(start, end).join(' '));
		if (end === words.length) {
			break;
		}
		start = Math.max(start + 1, end - 12);
	}
	return result;
};

export const buildPassages = (tree: ContentTree): Passage[] => tree.all()
	.filter(node => node.id !== tree.root.id)
	.flatMap(node => {
		const heading = nodePath(tree, node).slice(-350);
		const body = plainText(tree.resolve(node).text ?? '');
		// No synonyms, keywords, stems, exact-match boosts, or lexical fallback.
		return [...new Set([heading, ...chunks(body).map(chunk => `${heading}. ${chunk}`)])]
			.map(text => ({ nodeId: node.id, text: `passage: ${text}` }));
	});

const similarity = (a: number[], b: number[]): number => {
	if (a.length !== b.length || a.length === 0) {
		throw new Error('E5 embedding dimensions do not match');
	}
	return a.reduce((sum, value, i) => sum + value * b[i], 0);
};

export class E5Search implements DialogSearch {
	private readonly indexes = new WeakMap<ContentTree, Promise<Index>>();
	private queue: Promise<unknown> = Promise.resolve();

	constructor (private readonly encode: Encoder) {}

	private encodeSerial (texts: string[]): Promise<number[][]> {
		const task = this.queue.then(() => this.encode(texts)).then(vectors => {
			if (vectors.length !== texts.length || vectors.some(vector => vector.length !== 384 || vector.some(value => !Number.isFinite(value)))) {
				throw new Error('Invalid E5 embeddings');
			}
			return vectors;
		});
		this.queue = task.catch(() => undefined);
		return task;
	}

	private index (tree: ContentTree): Promise<Index> {
		let pending = this.indexes.get(tree);
		if (!pending) {
			pending = (async () => {
				const passages = buildPassages(tree);
				const vectors: number[][] = [];
				for (let start = 0; start < passages.length; start += 8) {
					vectors.push(...await this.encodeSerial(passages.slice(start, start + 8).map(passage => passage.text)));
				}
				return { passages, vectors };
			})().catch(error => {
				this.indexes.delete(tree);
				throw error;
			});
			this.indexes.set(tree, pending);
		}
		return pending;
	}

	async prepare (tree: ContentTree): Promise<void> {
		await this.index(tree);
	}

	async rank (tree: ContentTree, nodes: ContentNode[], text: string, context?: ContentNode): Promise<Candidate[]> {
		if (!text.trim() || nodes.length === 0) {
			return [];
		}
		const index = await this.index(tree);
		const queries = [`query: ${text}`];
		const useContext = context && context.id !== tree.root.id && text.trim().split(/\s+/).length <= 4;
		if (useContext) {
			queries.push(`query: ${nodePath(tree, context)}. ${text}`);
		}
		const queryVectors = await this.encodeSerial(queries);
		const allowed = new Map(nodes.map(node => [node.id, node]));
		const scores = new Map<number, number>();
		index.passages.forEach((passage, i) => {
			const node = allowed.get(passage.nodeId);
			if (!node) {
				return;
			}
			let score = similarity(queryVectors[0], index.vectors[i]);
			// Contextual question is only applicable inside the current branch.
			// An unrelated full question remains searchable across the entire tree.
			if (useContext && node.parentId === context.id) {
				score = Math.max(score, similarity(queryVectors[1], index.vectors[i]));
			}
			scores.set(node.id, Math.max(scores.get(node.id) ?? -1, score));
		});
		return [...scores].map(([id, score]) => ({ node: allowed.get(id)!, score }))
			.sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
	}
}

export const createE5Search = async (): Promise<E5Search> => {
	const extractor = await pipeline('feature-extraction', E5_MODEL, {
		revision: E5_REVISION,
		device: 'cpu',
		dtype: 'q8',
		cache_dir: path.resolve(process.env.E5_CACHE_DIR ?? repoPath('.cache/e5')),
		session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
	});
	return new E5Search(async texts => {
		const output = await extractor(texts, { pooling: 'mean', normalize: true });
		return output.tolist() as number[][];
	});
};
