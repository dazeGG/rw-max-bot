// Retrieval-only diagnostics on the real production questions: where the expected section ranks
// in the global search, independently of the answer/clarify policy. Does not change runtime routing.
//
//   pnpm retrieval:report             # summary + misses outside top 3
//   pnpm retrieval:report --all       # every question
//   pnpm retrieval:report --rerank=10 # experiment: BGE reranker over the first N nodes
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';

import { repoPath } from '@rw/runtime';

import { createEvaluationTrees } from '../evaluation/fixtures';
import { realMaxExamples } from '../evaluation/real-max';
import { realTgExamples } from '../evaluation/real-tg';
import { createE5Search } from '../semantic-search';

const RERANKER = { name: 'onnx-community/bge-reranker-v2-m3-ONNX', revision: '6f5ff65298512715a1e669753bc754d2bc8f367b' };
const rerankDepth = Number(process.argv.find(arg => arg.startsWith('--rerank='))?.split('=')[1] ?? 0);

const createReranker = async () => {
	const options = { revision: RERANKER.revision, cache_dir: path.resolve(process.env.E5_CACHE_DIR ?? repoPath('.cache/e5')) };
	const tokenizer = await AutoTokenizer.from_pretrained(RERANKER.name, options);
	const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER.name, {
		...options, device: 'cpu', dtype: 'q8', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
	});
	return async (query: string, passages: string[]): Promise<number[]> => {
		const scores: number[] = [];
		for (let i = 0; i < passages.length; i += 2) {
			const batch = passages.slice(i, i + 2);
			const inputs = tokenizer(batch.map(() => query), { text_pair: batch, padding: true, truncation: true, max_length: 512 });
			scores.push(...((await model(inputs)).logits.tolist() as number[][]).map(row => row[0]));
		}
		return scores;
	};
};

const main = async () => {
	const tree = createEvaluationTrees().railway;
	const search = await createE5Search();
	const rerank = rerankDepth > 0 ? await createReranker() : null;
	await search.prepare(tree);
	const nodes = tree.all().filter(node => node.id !== tree.root.id);
	// Global search sees only the question, so standalone steps with a known target are enough.
	const steps = [...realMaxExamples, ...realTgExamples].flatMap(example => example.steps.map(step => ({ source: example.name.split(':')[0], ...step })))
		.filter(step => !/^\d+$/.test(step.text.trim()))
		.map(step => ({ ...step, targets: [...step.expected, ...step.clarification ?? []].filter(code => code !== 'unrecognized') }))
		.filter(step => step.targets.length > 0);
	const unique = [...new Map(steps.map(step => [step.text.toLowerCase().trim(), step])).values()];
	const rows: (typeof unique[number] & { rank: number; top: { code: string; score: number; passage: string; }[]; })[] = [];
	const timings: number[] = [];
	for (const step of unique) {
		const started = performance.now();
		let ranked = await search.explain(tree, nodes, step.text);
		if (rerank) {
			const head = ranked.slice(0, rerankDepth);
			const scores = await rerank(step.text, head.map(candidate => candidate.passage.replace(/^(passage|query): /, '')));
			ranked = [...head.map((candidate, i) => ({ ...candidate, score: scores[i] })).sort((a, b) => b.score - a.score), ...ranked.slice(rerankDepth)];
		}
		timings.push(performance.now() - started);
		const rank = ranked.findIndex(candidate => step.targets.includes(candidate.node.code)) + 1;
		rows.push({ ...step, rank, top: ranked.slice(0, 10).map(({ node, score, passage }) => ({ code: node.code, score: Number(score.toFixed(3)), passage: passage.replace(/^(passage|query): /, '') })) });
	}
	const at = (k: number, source?: string) => {
		const scope = rows.filter(row => !source || row.source === source);
		return `${scope.filter(row => row.rank > 0 && row.rank <= k).length}/${scope.length}`;
	};
	for (const row of rows.filter(row => process.argv.includes('--all') || row.rank === 0 || row.rank > 3)) {
		console.log(`#${row.rank || '-'} ${row.source} «${row.text.slice(0, 80)}» → ${row.targets.join(', ')}`);
		for (const { code, score, passage } of row.top.slice(0, 3)) {
			console.log(`     ${score} ${code}: ${passage.slice(0, 120)}`);
		}
	}
	const mrr = rows.reduce((sum, row) => sum + (row.rank ? 1 / row.rank : 0), 0) / rows.length;
	timings.sort((a, b) => a - b);
	console.log(`\nquery p50 ${Math.round(timings[timings.length >> 1])} ms, p95 ${Math.round(timings[Math.floor(timings.length * 0.95)])} ms`);
	console.log(`hit@1 ${at(1)}  hit@3 ${at(3)}  hit@5 ${at(5)}  MRR ${mrr.toFixed(3)}`);
	for (const source of ['max', 'tg']) {
		console.log(`  ${source}: hit@1 ${at(1, source)}  hit@3 ${at(3, source)}  hit@5 ${at(5, source)}`);
	}
	await fs.writeFile(repoPath('.cache/retrieval-report.json'), JSON.stringify(rows, null, 2));
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
