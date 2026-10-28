// Offline experiment only. Does not change the bot's runtime model or send messages to MAX.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { AutoModelForSequenceClassification, AutoTokenizer, pipeline } from '@huggingface/transformers';

import { DialogEngine, MemorySessionStore, stripGreetingRaw } from '@rw/core';
import type { Candidate, ContentTree, SearchPolicy } from '@rw/core';
import { repoPath } from '@rw/runtime';

import { calibrate, summarize } from '../evaluation/benchmark-policy';
import { classify, createEvaluationTrees, examples, HELDOUT_SHA256, HELDOUT_VERSION, heldoutExamples } from '../evaluation/fixtures';
import type { Example, Step } from '../evaluation/fixtures';
import { buildPassages, E5_MODEL, E5_REVISION } from '../semantic-search';

const MODELS = {
	small: { name: E5_MODEL, revision: E5_REVISION, dimensions: 384 },
	base: { name: 'Xenova/multilingual-e5-base', revision: '1ec9243030a27d1a115d5c340572074c125b58b2', dimensions: 768 },
};
const RERANKER = { name: 'onnx-community/bge-reranker-v2-m3-ONNX', revision: '6f5ff65298512715a1e669753bc754d2bc8f367b' };
const SESSION_OPTIONS = { intraOpNumThreads: 2, interOpNumThreads: 1 };
const OUTPUT = repoPath('.cache/search-benchmark');
const CACHE = path.resolve(process.env.E5_CACHE_DIR ?? repoPath('.cache/e5'));
const REPEATS = 2;
const FROZEN_HELDOUT_HASH = '967f1d415912ff632f03fac5cee385da20d753f9766cfa1c2ff7b6d50bada382';
type Variant = 'small' | 'base' | 'rerank';
type Sample = { id: string; domain: Example['domain']; step: Step; };
type Index = { passages: ReturnType<typeof buildPassages>; vectors: number[][]; };
type Hit = Candidate & { passage: string; rawScore: number; };
type Scored = { sample: Sample; ranked: Hit[]; milliseconds: number; retrieverTop20: string[]; };

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const samples = (source: Example[]): Sample[] => source.map(example => ({ id: example.name, domain: example.domain, step: example.steps[0] }));
// Only first turns: never detach numeric or elliptical follow-ups from their preceding question.
const calibration = [...new Map(samples(examples).map(sample => [`${sample.domain}:${sample.step.text}`, sample])).values()];
const heldout = samples(heldoutExamples);

const ordered = (input: Sample[]): Sample[] => {
	const result = [...input];
	let state = 42;
	for (let i = result.length - 1; i > 0; i--) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		const j = state % (i + 1);
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
};
const percentile = (values: number[], p: number): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

const decide = async (trees: ReturnType<typeof createEvaluationTrees>, scored: Scored[], policy: SearchPolicy) => {
	const result = [];
	for (const row of scored) {
		const tree = trees[row.sample.domain];
		const engine = new DialogEngine(() => tree, new MemorySessionStore(), { rank: async () => row.ranked }, {}, policy);
		await engine.process({ id: 1 }, { type: 'start' });
		const response = await engine.process({ id: 1 }, { type: 'text', text: row.sample.step.text });
		result.push({ sample: row.sample, ...classify(response, row.sample.step, tree), responseType: response.event.type });
	}
	return result;
};

const retrievalMetrics = (rows: Scored[], trees: ReturnType<typeof createEvaluationTrees>) => {
	const eligible = rows.filter(row => row.sample.step.expected.length > 0 && !row.sample.step.expected.includes('unrecognized'));
	const counts = Object.fromEntries([1, 5, 20].map(k => [k, eligible.filter(row => row.ranked.slice(0, k)
		.some(hit => row.sample.step.expected.includes(trees[row.sample.domain].resolve(hit.node).code))).length]));
	return { denominator: eligible.length, hitAt1: counts[1], hitAt5: counts[5], hitAt20: counts[20] };
};

const main = async () => {
	if (HELDOUT_SHA256 !== FROZEN_HELDOUT_HASH) {
		throw new Error('Heldout fixture changed after protocol freeze');
	}
	if (process.argv.includes('--report')) {
		const reports = await Promise.all(['small', 'base', 'rerank'].map(async name => JSON.parse(await fs.readFile(path.join(OUTPUT, `${name}.json`), 'utf8'))));
		for (const key of ['sourceHash', 'datasetHash', 'corpusHash', 'heldoutHash']) {
			if (new Set(reports.map(report => report[key])).size !== 1) {
				throw new Error(`Incomparable experiment reports: ${key} differs`);
			}
		}
		console.log(JSON.stringify(reports.map(report => ({
			variant: report.variant,
			heldout: report.heldout,
			resources: report.resources,
			policy: report.calibration.policy,
			calibration: report.calibration.metrics,
		})), null, 2));
		return;
	}
	const variant = process.argv.find(arg => arg.startsWith('--variant='))?.split('=')[1] as Variant | undefined;
	if (!variant || !['small', 'base', 'rerank'].includes(variant)) {
		throw new Error('Use --variant=small|base|rerank. Run each in a fresh process.');
	}
	await fs.mkdir(OUTPUT, { recursive: true });
	const sources = await Promise.all([
		'apps/bot/src/cli/benchmark-search.ts', 'apps/bot/src/evaluation/benchmark-policy.ts',
		'packages/core/src/dialog/engine.ts', 'packages/core/src/dialog/text.ts', 'packages/core/src/dialog/search.ts',
		'apps/bot/src/semantic-search.ts',
	].map(file => fs.readFile(repoPath(file))));
	const sourceHash = createHash('sha256').update(Buffer.concat(sources)).digest('hex');
	const datasetHash = createHash('sha256').update(JSON.stringify({ calibration, heldout })).digest('hex');
	const corpusHash = createHash('sha256');
	const trees = createEvaluationTrees();
	for (const tree of Object.values(trees)) {
		corpusHash.update(JSON.stringify(buildPassages(tree)));
	}
	const embedding = variant === 'base' ? MODELS.base : MODELS.small;
	const started = performance.now();
	let peakSampledRss = process.memoryUsage().rss;
	const monitor = setInterval(() => {
		peakSampledRss = Math.max(peakSampledRss, process.memoryUsage().rss);
	}, 25);
	monitor.unref();
	console.log(`Loading ${variant}: ${embedding.name}${variant === 'rerank' ? ` + ${RERANKER.name}` : ''} (CPU/q8, 2 threads)`);
	const extractor = await pipeline('feature-extraction', embedding.name, {
		revision: embedding.revision, device: 'cpu', dtype: 'q8', cache_dir: CACHE, session_options: SESSION_OPTIONS,
	});
	const encode = async (texts: string[]): Promise<number[][]> => {
		const output = await extractor(texts, { pooling: 'mean', normalize: true });
		const vectors = output.tolist() as number[][];
		if (vectors.length !== texts.length || vectors.some(vector => vector.length !== embedding.dimensions || vector.some(value => !Number.isFinite(value)))) {
			throw new Error('Invalid embedding tensor');
		}
		return vectors;
	};
	const tokenizer = variant === 'rerank' ? await AutoTokenizer.from_pretrained(RERANKER.name, { revision: RERANKER.revision, cache_dir: CACHE }) : null;
	const reranker = variant === 'rerank'
		? await AutoModelForSequenceClassification.from_pretrained(RERANKER.name, {
			revision: RERANKER.revision, device: 'cpu', dtype: 'q8', cache_dir: CACHE, session_options: SESSION_OPTIONS,
		})
		: null;
	const loadMilliseconds = performance.now() - started;
	const indexes = new Map<ContentTree, Index>();
	const indexStarted = performance.now();
	for (const tree of Object.values(trees)) {
		const passages = buildPassages(tree);
		const vectors: number[][] = [];
		// Same batches and complete passage list as the current E5 runtime.
		for (let i = 0; i < passages.length; i += 8) {
			vectors.push(...await encode(passages.slice(i, i + 8).map(passage => passage.text)));
		}
		indexes.set(tree, { passages, vectors });
	}
	const indexMilliseconds = performance.now() - indexStarted;
	const infer = async (sample: Sample): Promise<Scored> => {
		const before = performance.now();
		const tree = trees[sample.domain];
		const query = stripGreetingRaw(sample.step.text).rest;
		const [queryVector] = await encode([`query: ${query}`]);
		const index = indexes.get(tree)!;
		const byNode = new Map<number, Hit>();
		index.passages.forEach((passage, i) => {
			if (passage.kind !== 'content') {
				return;
			}
			const node = tree.get(passage.nodeId)!;
			const score = dot(queryVector, index.vectors[i]);
			if (!byNode.has(node.id) || byNode.get(node.id)!.score < score) {
				byNode.set(node.id, { node, score, rawScore: score, passage: passage.text.replace(/^passage: /, '') });
			}
		});
		let ranked = [...byNode.values()].sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
		const retrieverTop20 = ranked.slice(0, 20).map(hit => hit.node.code);
		if (reranker && tokenizer) {
			ranked = ranked.slice(0, 20);
			for (let i = 0; i < ranked.length; i += 2) {
				const batch = ranked.slice(i, i + 2);
				const inputs = tokenizer(batch.map(() => query), {
					text_pair: batch.map(hit => hit.passage), padding: true, truncation: true, max_length: 512,
				});
				const output = await reranker(inputs);
				const logits = output.logits.tolist() as number[][];
				if (logits.length !== batch.length || logits.some(row => row.length !== 1 || !Number.isFinite(row[0]))) {
					throw new Error('Expected reranker logits shape [N,1]');
				}
				batch.forEach((hit, j) => {
					hit.rawScore = logits[j][0];
					hit.score = sigmoid(hit.rawScore); // Monotonic score transform, NOT a calibrated probability.
				});
			}
			ranked.sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
		}
		return { sample, ranked, retrieverTop20, milliseconds: performance.now() - before };
	};
	await infer(calibration[0]);
	await infer(calibration.find(sample => sample.domain === 'library')!);
	console.log(`Loaded/indexed ${variant}. Collecting ${calibration.length} calibration queries; heldout remains sealed.`);
	const calibrationRows: Scored[] = [];
	for (const [i, sample] of calibration.entries()) {
		calibrationRows.push(await infer(sample));
		if ((i + 1) % 10 === 0) {
			console.log(`Calibration ${i + 1}/${calibration.length}`);
		}
	}
	const selected = await calibrate(variant === 'rerank' ? 'reranker' : 'embedding', async policy => decide(trees, calibrationRows, policy));
	// Persist the selected policy BEFORE running heldout queries, with fixture/source hashes.
	await fs.writeFile(path.join(OUTPUT, `${variant}-policy.json`), JSON.stringify({ ...selected, datasetHash, heldoutHash: HELDOUT_SHA256, sourceHash }, null, 2));
	console.log(`Policy frozen for ${variant}: ${JSON.stringify(selected.policy)}; calibration cost ${selected.metrics.cost}`);
	let queryPeakRss = process.memoryUsage().rss;
	const queryMonitor = setInterval(() => {
		queryPeakRss = Math.max(queryPeakRss, process.memoryUsage().rss);
	}, 25);
	queryMonitor.unref();
	const queryTimes: number[] = [];
	const heldoutRows: Scored[] = [];
	let repeatedTop1Changes = 0;
	for (let repeat = 0; repeat < REPEATS; repeat++) {
		for (const [i, sample] of ordered(heldout).entries()) {
			const row = await infer(sample);
			queryTimes.push(row.milliseconds);
			if (repeat === 0) {
				heldoutRows.push(row);
			} else if (row.ranked[0]?.node.id !== heldoutRows[i].ranked[0]?.node.id) {
				repeatedTop1Changes++;
			}
		}
		console.log(`Heldout timing pass ${repeat + 1}/${REPEATS} complete; quality not printed until all variants finish.`);
	}
	clearInterval(queryMonitor);
	clearInterval(monitor);
	const decisions = await decide(trees, heldoutRows, selected.policy);
	const rejectionRows = decisions.filter(row => row.sample.step.expected.includes('unrecognized'));
	const report = {
		variant,
		createdAt: new Date().toISOString(),
		sourceHash,
		datasetHash,
		corpusHash: corpusHash.digest('hex'),
		heldoutVersion: HELDOUT_VERSION,
		heldoutHash: HELDOUT_SHA256,
		embedding,
		reranker: variant === 'rerank' ? RERANKER : null,
		protocol: { threads: 2, embeddingBatch: 8, rerankerBatch: 2, tokenLimit: 512, candidates: 20, repeats: REPEATS, seed: 42, freshProcess: true, devBotRunningInBackground: true },
		host: { cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalRamMiB: os.totalmem() / 1048576, platform: os.platform(), node: process.version },
		resources: {
			loadMilliseconds,
			indexMilliseconds,
			p50Milliseconds: percentile(queryTimes, 0.5),
			p95Milliseconds: percentile(queryTimes, 0.95),
			peakSampledRssMiB: peakSampledRss / 1048576,
			queryPeakSampledRssMiB: queryPeakRss / 1048576,
			osPeakRssMiB: process.resourceUsage().maxRSS ? process.resourceUsage().maxRSS / 1024 : null,
			repeatedTop1Changes,
		},
		calibration: { count: calibration.length, ...selected, retrieval: retrievalMetrics(calibrationRows, trees) },
		heldout: {
			metrics: summarize(decisions),
			retrieval: retrievalMetrics(heldoutRows, trees),
			unsupportedQuestions: rejectionRows.length,
			falseAcceptedUnsupported: rejectionRows.filter(row => row.responseType !== 'clarify' && row.responseType !== 'unrecognized').length,
			byDomain: Object.fromEntries(Object.keys(trees).map(domain => [domain, summarize(decisions.filter(row => row.sample.domain === domain))])),
		},
		rows: heldoutRows.map((row, i) => ({
			...decisions[i],
			milliseconds: row.milliseconds,
			retrieverTop20: row.retrieverTop20,
			ranked: row.ranked.map(hit => ({ code: hit.node.code, score: hit.score, rawScore: hit.rawScore, passage: hit.passage })),
		})),
	};
	await fs.writeFile(path.join(OUTPUT, `${variant}.json`), JSON.stringify(report, null, 2));
	console.log(`Saved ${variant} report. p50=${Math.round(report.resources.p50Milliseconds)}ms; query RSS sample peak=${Math.round(report.resources.queryPeakSampledRssMiB)}MiB.`);
	await extractor.dispose();
	await reranker?.dispose();
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
