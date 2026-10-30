// Answer/clarify/reject thresholds calibrated on real production dialogs.
// Models run once: search results are memoized and the dialog engine is replayed for every candidate policy.
// Dialogs are split by a hash of their name; the held-out part is scored only for the chosen policy.
//
//   pnpm calibrate:policy
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

import { DialogEngine, MemorySessionStore } from '@rw/core';
import type { Candidate, ContentNode, ContentTree, DialogResult, DialogSearch, SearchPolicy } from '@rw/core';
import { repoPath } from '@rw/runtime';

import { classify, createEvaluationTrees, examples as legacyExamples } from '../evaluation/fixtures';
import type { Example, Outcome, Step } from '../evaluation/fixtures';
import { realMaxExamples } from '../evaluation/real-max';
import { realTgExamples } from '../evaluation/real-tg';
import { rerankDepth, rerankE5Weight, semanticPolicy } from '../semantic-config';
import { createE5Search } from '../semantic-search';

class MemoSearch implements DialogSearch {
	private readonly cache = new Map<string, Promise<Candidate[]>>();

	constructor (private readonly inner: DialogSearch) {}

	rank (tree: ContentTree, nodes: ContentNode[], text: string, mode?: 'options'): Promise<Candidate[]> {
		const key = `${mode ?? 'global'}\u0000${text}\u0000${nodes.map(node => node.id).join(',')}`;
		let ranked = this.cache.get(key);
		if (!ranked) {
			ranked = this.inner.rank(tree, nodes, text, mode);
			this.cache.set(key, ranked);
		}
		return ranked;
	}
}

type Row = { outcome: Outcome; pass: boolean; helpful: boolean; };
export type Score = { total: number; strict: number; helpful: number; wrong: number; noAnswer: number; loss: number; outcomes: Partial<Record<Outcome, number>>; };

// A clarification that lists the right section among its options still lets the passenger finish in one tap.
// So does its last option to people, when the question needs them or has no answer in the content
const isHelpful = (result: DialogResult, step: Step, row: { outcome: Outcome; pass: boolean; actual: string[]; }) => {
	if (row.pass) {
		return true;
	}
	if (result.event.type !== 'clarify') {
		return false;
	}
	const handoff = result.event.details.handoff;
	return row.actual.some(code => step.expected.includes(code) || step.clarification?.includes(code)) ||
		(handoff !== undefined && (step.expected.includes(handoff) || step.expected.includes('unrecognized')));
};

// Wrong direct answers are the worst outcome; a useful clarification costs a little more than a direct answer
const COST: Record<Outcome, number> = {
	'direct-correct': 0,
	'relevant-clarification': 0,
	'correct-rejection': 0,
	'unnecessary-clarification': 0.3,
	'irrelevant-clarification': 1,
	'no-answer': 1,
	'wrong-answer': 3,
};

const replay = async (search: DialogSearch, trees: Record<Example['domain'], ContentTree>, examples: Example[], policy: SearchPolicy): Promise<Row[]> => {
	const rows: Row[] = [];
	for (const example of examples) {
		const tree = trees[example.domain];
		const engine = new DialogEngine(() => tree, new MemorySessionStore(), search, {}, policy);
		await engine.process({ id: 1 }, { type: 'start' });
		for (const step of example.steps) {
			const result = await engine.process({ id: 1 }, { type: 'text', text: step.text });
			const row = classify(result, step, tree);
			const helpful = isHelpful(result, step, row);
			rows.push({ outcome: row.outcome, pass: row.pass, helpful });
		}
	}
	return rows;
};

const score = (rows: Row[]): Score => {
	const outcomes: Partial<Record<Outcome, number>> = {};
	for (const row of rows) {
		outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
	}
	return {
		total: rows.length,
		strict: rows.filter(row => row.pass).length,
		helpful: rows.filter(row => row.helpful).length,
		wrong: outcomes['wrong-answer'] ?? 0,
		noAnswer: outcomes['no-answer'] ?? 0,
		// A useful clarification is charged like an unnecessary one instead of a full miss
		loss: rows.reduce((sum, row) => sum + (row.helpful && !row.pass ? COST['unnecessary-clarification'] : COST[row.outcome]), 0),
		outcomes,
	};
};

const percent = (part: number, total: number) => `${(100 * part / total).toFixed(1)}%`;
const describe = (name: string, s: Score) =>
	`${name.padEnd(12)} strict ${s.strict}/${s.total} (${percent(s.strict, s.total)})  helpful ${s.helpful}/${s.total} (${percent(s.helpful, s.total)})  wrong ${s.wrong}  no-answer ${s.noAnswer}  loss ${s.loss.toFixed(1)}`;

const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Number((from + i * step).toFixed(4)));

const main = async () => {
	const trees = createEvaluationTrees();
	const search = new MemoSearch(await createE5Search(rerankDepth, rerankE5Weight));
	const real = [...realMaxExamples, ...realTgExamples];
	const heldout = (example: Example) => createHash('sha256').update(example.name).digest()[0] < 0.4 * 256;
	const calibration = real.filter(example => !heldout(example));
	const test = real.filter(heldout);
	console.log(`Real dialogs: calibration ${calibration.length}, held out ${test.length}. Reranker depth ${rerankDepth}.`);

	// Warm the memo with every text once so the grid only replays the engine
	await replay(search, trees, real, semanticPolicy);
	await replay(search, trees, legacyExamples, semanticPolicy);

	const pickBest = async (grid: SearchPolicy[]) => {
		let best: { policy: SearchPolicy; score: Score; } | null = null;
		for (const policy of grid) {
			const result = score(await replay(search, trees, calibration, policy));
			// Ties: fewer wrong answers, then more strict successes
			if (!best || result.loss < best.score.loss - 1e-9 ||
				(Math.abs(result.loss - best.score.loss) < 1e-9 && (result.wrong < best.score.wrong || (result.wrong === best.score.wrong && result.strict > best.score.strict)))) {
				best = { policy, score: result };
			}
		}
		return best!;
	};

	// Stage 1: global answer/clarify/reject thresholds with the current option thresholds
	const globalGrid: SearchPolicy[] = [];
	const globalThresholds = rerankDepth > 0 ? range(0.02, 0.98, 0.04) : range(0.8, 0.9, 0.005);
	const globalGaps = rerankDepth > 0 ? [0.001, 0.01, 0.03, 0.06, 0.1, 0.15, 0.2, 0.3] : range(0.005, 0.05, 0.005);
	const options = { optionThreshold: semanticPolicy.optionThreshold, optionGap: semanticPolicy.optionGap };
	for (const threshold of globalThresholds) {
		for (const ambiguityGap of globalGaps) {
			globalGrid.push({ threshold, ambiguityGap, ...options });
			for (const clarifyThreshold of rerankDepth > 0 ? globalThresholds.filter(value => value < threshold) : []) {
				globalGrid.push({ threshold, ambiguityGap, clarifyThreshold, ...options });
			}
		}
	}
	const global = await pickBest(globalGrid);
	console.log(`Stage 1: ${globalGrid.length} global policies → ${JSON.stringify(global.policy)}`);

	// Stage 2: thresholds for words matched against displayed options
	const optionGrid: SearchPolicy[] = [];
	for (const optionThreshold of range(0.8, 0.94, 0.01)) {
		for (const optionGap of [0.002, 0.005, 0.01, 0.015, 0.02, 0.03, 0.05]) {
			optionGrid.push({ ...global.policy, optionThreshold, optionGap });
		}
	}
	const chosen = await pickBest(optionGrid);
	console.log(`Stage 2: ${optionGrid.length} option policies → ${JSON.stringify(chosen.policy)}`);
	const current = semanticPolicy;
	const report = {
		createdAt: new Date().toISOString(),
		rerankDepth,
		chosen: chosen.policy,
		current,
		calibration: { chosen: chosen.score, current: score(await replay(search, trees, calibration, current)) },
		heldout: { chosen: score(await replay(search, trees, test, chosen.policy)), current: score(await replay(search, trees, test, current)) },
		legacy: { chosen: score(await replay(search, trees, legacyExamples, chosen.policy)), current: score(await replay(search, trees, legacyExamples, current)) },
	};
	console.log(`\nChosen policy: ${JSON.stringify(chosen.policy)}`);
	console.log(`Current policy: ${JSON.stringify(current)}\n`);
	for (const part of ['calibration', 'heldout', 'legacy'] as const) {
		console.log(describe(`${part}*`, report[part].chosen));
		console.log(describe(`${part}`, report[part].current));
	}
	console.log('\n* = chosen policy');

	// How many clarifications a stricter clarify band costs: irrelevant offers versus helpful ones
	if (chosen.policy.clarifyThreshold !== undefined) {
		console.log('\nclarifyThreshold trade-off (other values as chosen):');
		for (const clarifyThreshold of [chosen.policy.clarifyThreshold, 0.1, 0.2, 0.3, 0.5].filter(value => value < chosen.policy.threshold)) {
			const policy = { ...chosen.policy, clarifyThreshold };
			for (const [name, part] of [['calibration', calibration], ['heldout', test]] as const) {
				const s = score(await replay(search, trees, part, policy));
				console.log(`${String(clarifyThreshold).padEnd(5)} ${describe(name, s)}  irrelevant ${s.outcomes['irrelevant-clarification'] ?? 0}`);
			}
		}
	}
	await fs.writeFile(repoPath('.cache/policy-calibration.json'), JSON.stringify(report, null, 2));
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
