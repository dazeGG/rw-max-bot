import type { SearchPolicy } from '@rw/core';

import type { Outcome } from './fixtures';

export type BenchmarkOutcomeRow = { outcome: Outcome; pass: boolean; };
export type BenchmarkOutcomeRows = readonly BenchmarkOutcomeRow[];
export type BenchmarkKind = 'embedding' | 'reranker';

export type BenchmarkMetrics = {
	total: number;
	passed: number;
	outcomes: Record<Outcome, number>;
	directCorrect: number;
	wrongAnswers: number;
	accepted: number;
	precisionAccepted: number | null;
	coverage: number;
	cost: number;
};

const costs: Readonly<Record<Outcome, number>> = {
	'direct-correct': 0,
	'relevant-clarification': 0,
	'correct-rejection': 0,
	'wrong-answer': 4,
	'no-answer': 1,
	'irrelevant-clarification': 1.5,
	'unnecessary-clarification': 0.75,
};

export const summarize = (rows: BenchmarkOutcomeRows): BenchmarkMetrics => {
	const outcomes: Record<Outcome, number> = {
		'direct-correct': 0,
		'relevant-clarification': 0,
		'correct-rejection': 0,
		'wrong-answer': 0,
		'no-answer': 0,
		'irrelevant-clarification': 0,
		'unnecessary-clarification': 0,
	};
	let passed = 0;
	let cost = 0;
	for (const row of rows) {
		outcomes[row.outcome]++;
		passed += Number(row.pass);
		cost += costs[row.outcome];
	}
	const directCorrect = outcomes['direct-correct'];
	const wrongAnswers = outcomes['wrong-answer'];
	const accepted = directCorrect + wrongAnswers;
	return {
		total: rows.length,
		passed,
		outcomes,
		directCorrect,
		wrongAnswers,
		accepted,
		precisionAccepted: accepted === 0 ? null : directCorrect / accepted,
		coverage: rows.length === 0 ? 0 : accepted / rows.length,
		cost,
	};
};

export const candidatePolicies = (kind: BenchmarkKind): SearchPolicy[] => {
	const thresholds = kind === 'embedding'
		? [...Array.from({ length: 15 }, (_, index) => (70 + index * 2) / 100), 1.001]
		: [0.001, 0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95, 0.99, 0.999, 1.001];
	const gaps = kind === 'embedding' ? [0.005, 0.01, 0.02, 0.04, 0.08] : [0.01, 0.025, 0.05, 0.1, 0.2, 0.4];
	return thresholds.flatMap(threshold => gaps.map(ambiguityGap => ({
		threshold,
		ambiguityGap,
		// Disabling global acceptance alone must not leave scoped option acceptance enabled.
		...threshold > 1 ? { optionThreshold: threshold } : {},
	})));
};

type Calibration = { policy: SearchPolicy; metrics: BenchmarkMetrics; };

const compare = (a: Calibration, b: Calibration): number => a.metrics.cost - b.metrics.cost ||
	a.metrics.wrongAnswers - b.metrics.wrongAnswers ||
	b.metrics.directCorrect - a.metrics.directCorrect ||
	a.policy.ambiguityGap - b.policy.ambiguityGap ||
	b.policy.threshold - a.policy.threshold;

// The caller supplies calibration rows only. This helper cannot select or read a heldout dataset.
export const calibrate = async (
	kind: BenchmarkKind,
	evaluate: (policy: SearchPolicy) => Promise<BenchmarkOutcomeRows>,
): Promise<Calibration> => {
	let best: Calibration | undefined;
	for (const policy of candidatePolicies(kind)) {
		const candidate = { policy, metrics: summarize(await evaluate(policy)) };
		if (!best || compare(candidate, best) < 0) {
			best = candidate;
		}
	}
	return best!;
};
