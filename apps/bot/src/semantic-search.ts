import path from 'node:path';

import { pipeline } from '@huggingface/transformers';

import type { Candidate, ContentNode, ContentTree, DialogSearch } from '@rw/core';
import { repoPath } from '@rw/runtime';

export const E5_MODEL = 'Xenova/multilingual-e5-small';
export const E5_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';

export type Encoder = (texts: string[]) => Promise<number[][]>;
type Passage = { nodeId: number; kind: 'content' | 'label'; text: string; };
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

const paragraphs = (html: string): string[] => html
	.replace(/\r\n?/g, '\n')
	.replace(/<br\s*\/?\s*>/gi, '\n\n')
	.replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|blockquote|tr)(?:\s[^>]*)?>/gi, '\n\n')
	.split(/(?:\n\s*){2,}|[•●▪]|\n(?=\s*(?:[-*]|\d+[.)])\s+)/u)
	.map(block => plainText(block).replace(/^(?:[-*]|\d+[.)])\s+/, ''))
	.filter(Boolean);

export const buildPassages = (tree: ContentTree): Passage[] => tree.all()
	.filter(node => node.id !== tree.root.id)
	.flatMap(node => {
		const heading = nodePath(tree, node).slice(-350);
		// Text shown on the picture is plain text where every line is a separate fact (a table row)
		const pictured = (node.imageText ?? '').split(/\n+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
		const blocks = [...paragraphs(node.text ?? ''), ...pictured];
		// No synonyms, keywords, stems, exact-match boosts, or lexical fallback.
		const label: Passage = { nodeId: node.id, kind: 'label', text: `passage: ${plainText(node.title)}` };
		// Navigation-only links and goto aliases are selectable options, not knowledge answers.
		if (node.type === 'goto' || (node.type === 'link' && blocks.length === 0)) {
			return [label];
		}
		const content: Passage[] = [...new Set([heading, ...blocks.flatMap(chunks).map(chunk => `${heading}. ${chunk}`)])]
			.map(text => ({ nodeId: node.id, kind: 'content', text: `passage: ${text}` }));
		// Section titles are often phrased as the question itself («Сколько стоит детский билет?»):
		// E5's symmetric query-to-query mode compares them with the question better than as a passage.
		const asked: Passage = { nodeId: node.id, kind: 'content', text: `query: ${plainText(node.title)}` };
		return [label, ...content, asked];
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

	async rank (tree: ContentTree, nodes: ContentNode[], text: string, mode?: 'options'): Promise<Candidate[]> {
		return (await this.explain(tree, nodes, text, mode)).map(({ node, score }) => ({ node, score }));
	}

	// Same ranking with the best-matching passage of each node, for diagnostics.
	async explain (tree: ContentTree, nodes: ContentNode[], text: string, mode?: 'options'): Promise<(Candidate & { passage: string; })[]> {
		if (!text.trim() || nodes.length === 0) {
			return [];
		}
		const index = await this.index(tree);
		// The question never borrows text or a score from a previous topic.
		const [queryVector] = await this.encodeSerial([`query: ${text}`]);
		const allowed = new Map(nodes.map(node => [node.id, node]));
		const best = new Map<number, { score: number; passage: string; }>();
		index.passages.forEach((passage, i) => {
			const node = allowed.get(passage.nodeId);
			if (!node || passage.kind !== (mode === 'options' ? 'label' : 'content')) {
				return;
			}
			const score = similarity(queryVector, index.vectors[i]);
			if (score > (best.get(node.id)?.score ?? -1)) {
				best.set(node.id, { score, passage: passage.text });
			}
		});
		return [...best].map(([id, { score, passage }]) => ({ node: allowed.get(id)!, score, passage }))
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
