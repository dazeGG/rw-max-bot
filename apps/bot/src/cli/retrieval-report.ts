// Retrieval-only diagnostics on the real production questions: where the expected section ranks
// in the global search, independently of the answer/clarify policy. Does not change runtime routing.
//
//   pnpm retrieval:report             # summary + misses outside top 3
//   pnpm retrieval:report --all       # every question
//   pnpm retrieval:report --rerank=0  # plain E5 without the reranker (default: RERANK_DEPTH)
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { repoPath } from '@rw/runtime';

import { createEvaluationTrees } from '../evaluation/fixtures';
import { realMaxExamples } from '../evaluation/real-max';
import { realTgExamples } from '../evaluation/real-tg';
import { rerankDepth, rerankE5Weight } from '../semantic-config';
import { createE5Search } from '../semantic-search';

// Same depth as the bot unless overridden; --rerank=0 shows plain E5
const depth = Number(process.argv.find(arg => arg.startsWith('--rerank='))?.split('=')[1] ?? rerankDepth);

const main = async () => {
	const tree = createEvaluationTrees().railway;
	const search = await createE5Search(depth, rerankE5Weight);
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
		const ranked = await search.explain(tree, nodes, step.text);
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
