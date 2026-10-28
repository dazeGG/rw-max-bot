// Opt-in real-model evaluation. Fixtures never affect runtime routing.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { DialogEngine, MemorySessionStore } from '@rw/core';
import type { DialogResult } from '@rw/core';
import { repoPath } from '@rw/runtime';

import { classify, createEvaluationTrees, examples } from '../evaluation/fixtures';
import type { Example, Outcome, Step } from '../evaluation/fixtures';
import { semanticPolicy } from '../semantic-config';
import { createE5Search, E5_MODEL, E5_REVISION } from '../semantic-search';

type EvaluationRow = Step & {
	scenario: string;
	domain: Example['domain'];
	step: number;
	outcome: Outcome;
	pass: boolean;
	actual: string[];
	type: DialogResult['event']['type'];
	from: string | undefined;
	milliseconds: number;
	candidates: DialogResult['event']['details']['candidates'];
};

const main = async () => {
	const sources = await Promise.all(['packages/core/src/dialog/engine.ts', 'apps/bot/src/semantic-search.ts'].map(file => fs.readFile(repoPath(file))));
	const runtimeFingerprint = createHash('sha256').update(Buffer.concat(sources)).digest('hex');
	const trees = createEvaluationTrees();
	const search = await createE5Search();
	await Promise.all(Object.values(trees).map(tree => search.prepare(tree)));
	const results: EvaluationRow[] = [];
	for (const example of examples) {
		const tree = trees[example.domain];
		const engine = new DialogEngine(() => tree, new MemorySessionStore(), search, {}, semanticPolicy);
		await engine.process({ id: 1 }, { type: 'start' });
		for (const [index, step] of example.steps.entries()) {
			const started = performance.now();
			const result = await engine.process({ id: 1 }, { type: 'text', text: step.text });
			const row = { scenario: example.name, domain: example.domain, step: index + 1, ...step, ...classify(result, step, tree), type: result.event.type, from: result.event.details.fromNodeCode, milliseconds: Math.round(performance.now() - started), candidates: result.event.details.candidates };
			results.push(row);
			console.log(`${row.pass ? 'OK  ' : 'MISS'} [${row.outcome}] ${example.domain}: ${step.text} => ${row.actual.join(', ')}; expected ${step.expected.join(', ') || 'relevant clarification'}`);
		}
	}
	const passed = results.filter(row => row.pass).length;
	const outcomes = Object.fromEntries([...new Set(results.map(row => row.outcome))].map(outcome => [outcome, results.filter(row => row.outcome === outcome).length]));
	const report = { createdAt: new Date().toISOString(), runtimeFingerprint, model: E5_MODEL, revision: E5_REVISION, policy: semanticPolicy, passed, total: results.length, outcomes, results };
	const filename = process.argv.includes('--baseline') ? '.cache/e5-before-context.json' : '.cache/e5-evaluation.json';
	await fs.mkdir(repoPath('.cache'), { recursive: true });
	await fs.writeFile(repoPath(filename), JSON.stringify(report, null, 2));
	console.log(`\n${passed}/${results.length} strict outcomes. ${JSON.stringify(outcomes)}\nReport: ${filename}`);
	if (process.argv.includes('--strict') && passed !== results.length) {
		process.exitCode = 1;
	}
};

void main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
