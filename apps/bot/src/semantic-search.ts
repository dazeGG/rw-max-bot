import path from 'node:path';

import { AutoModelForSequenceClassification, AutoTokenizer, pipeline } from '@huggingface/transformers';

import type { Candidate, ContentNode, ContentTree, DialogSearch } from '@rw/core';
import { repoPath } from '@rw/runtime';

export const E5_MODEL = 'Xenova/multilingual-e5-small';
export const E5_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78';
export const RERANKER_MODEL = 'onnx-community/bge-reranker-v2-m3-ONNX';
export const RERANKER_REVISION = '6f5ff65298512715a1e669753bc754d2bc8f367b';

export type Encoder = (texts: string[]) => Promise<number[][]>;
// Raw relevance logits of a cross-encoder for (question, passage) pairs
export type Reranker = (query: string, passages: string[]) => Promise<number[]>;
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

	// rerankDepth: how many E5 leaders the cross-encoder rescores in the global search; 0 disables it
	constructor (private readonly encode: Encoder, private readonly reranker?: Reranker, private readonly rerankDepth = 0) {}

	// One inference job at a time: both models share the same two CPU threads
	private serial<T> (job: () => Promise<T>): Promise<T> {
		const task = this.queue.then(job);
		this.queue = task.catch(() => undefined);
		return task;
	}

	private async encodeSerial (texts: string[]): Promise<number[][]> {
		const vectors = await this.serial(() => this.encode(texts));
		if (vectors.length !== texts.length || vectors.some(vector => vector.length !== 384 || vector.some(value => !Number.isFinite(value)))) {
			throw new Error('Invalid E5 embeddings');
		}
		return vectors;
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
		const ranked = [...best].map(([id, { score, passage }]) => ({ node: allowed.get(id)!, score, passage }))
			.sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
		// Button labels keep E5 label scores; the reranker reads question + answer text
		if (!this.reranker || this.rerankDepth <= 0 || mode === 'options') {
			return ranked;
		}
		return this.rerank(tree, text, ranked.slice(0, this.rerankDepth));
	}

	// Candidates beyond the depth are dropped: E5 cosine and reranker scores are different scales.
	private async rerank (tree: ContentTree, text: string, leaders: (Candidate & { passage: string; })[]): Promise<(Candidate & { passage: string; })[]> {
		if (leaders.length === 0) {
			return [];
		}
		const reranker = this.reranker!;
		const logits = await this.serial(() => reranker(text, leaders.map(leader => leader.passage.replace(/^(?:passage|query): /, ''))));
		if (logits.length !== leaders.length || logits.some(logit => !Number.isFinite(logit))) {
			throw new Error('Invalid reranker scores');
		}
		// Sigmoid keeps scores in 0…1 for the thresholds; it is not a calibrated probability
		return leaders.map((leader, i) => ({ ...leader, score: 1 / (1 + Math.exp(-logits[i])) }))
			.sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
	}
}

const cacheDir = () => path.resolve(process.env.E5_CACHE_DIR ?? repoPath('.cache/e5'));
const sessionOptions = { intraOpNumThreads: 2, interOpNumThreads: 1 };

export const createReranker = async (): Promise<Reranker> => {
	const options = { revision: RERANKER_REVISION, cache_dir: cacheDir() };
	const tokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL, options);
	const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
		...options, device: 'cpu', dtype: 'q8', session_options: sessionOptions,
	});
	return async (query, passages) => {
		const logits: number[] = [];
		// Pairs of two were the fastest batch on the 2-vCPU server
		for (let start = 0; start < passages.length; start += 2) {
			const batch = passages.slice(start, start + 2);
			const inputs = tokenizer(batch.map(() => query), { text_pair: batch, padding: true, truncation: true, max_length: 512 });
			logits.push(...((await model(inputs)).logits.tolist() as number[][]).map(row => row[0]));
		}
		return logits;
	};
};

export const createE5Search = async (rerankDepth = 0): Promise<E5Search> => {
	const extractor = await pipeline('feature-extraction', E5_MODEL, {
		revision: E5_REVISION,
		device: 'cpu',
		dtype: 'q8',
		cache_dir: cacheDir(),
		session_options: sessionOptions,
	});
	const encode: Encoder = async texts => {
		const output = await extractor(texts, { pooling: 'mean', normalize: true });
		return output.tolist() as number[][];
	};
	return rerankDepth > 0 ? new E5Search(encode, await createReranker(), rerankDepth) : new E5Search(encode);
};
