import { describe, expect, it, vi } from 'vitest';

import type { SearchPolicy } from '@rw/core';

import { calibrate, candidatePolicies, summarize } from './benchmark-policy';
import type { BenchmarkOutcomeRow } from './benchmark-policy';
import type { Outcome } from './fixtures';

const row = (outcome: Outcome): BenchmarkOutcomeRow => ({
	outcome,
	pass: ['direct-correct', 'relevant-clarification', 'correct-rejection'].includes(outcome),
});

describe('benchmark outcome metrics', () => {
	it('keeps direct-answer precision and coverage denominators distinct', () => {
		const metrics = summarize([
			row('direct-correct'), row('direct-correct'), row('wrong-answer'),
			row('no-answer'), row('correct-rejection'), row('relevant-clarification'),
		]);

		expect(metrics).toMatchObject({ total: 6, passed: 4, directCorrect: 2, wrongAnswers: 1, accepted: 3 });
		expect(metrics.precisionAccepted).toBeCloseTo(2 / 3);
		expect(metrics.coverage).toBe(0.5);
	});

	it('does not disguise all-abstention as perfect precision', () => {
		const metrics = summarize([row('no-answer'), row('correct-rejection')]);
		expect(metrics).toMatchObject({ total: 2, passed: 1, accepted: 0, precisionAccepted: null, coverage: 0, cost: 1 });
	});

	it('has defined empty-set metrics without dividing by zero', () => {
		expect(summarize([])).toMatchObject({ total: 0, passed: 0, directCorrect: 0, wrongAnswers: 0, accepted: 0, precisionAccepted: null, coverage: 0, cost: 0 });
	});

	it('charges every mistake category its declared cost', () => {
		const metrics = summarize([
			row('direct-correct'), row('relevant-clarification'), row('correct-rejection'),
			row('wrong-answer'), row('no-answer'), row('irrelevant-clarification'), row('unnecessary-clarification'),
		]);
		expect(metrics.cost).toBe(4 + 1 + 1.5 + 0.75);
		expect(metrics.outcomes).toEqual({
			'direct-correct': 1,
			'relevant-clarification': 1,
			'correct-rejection': 1,
			'wrong-answer': 1,
			'no-answer': 1,
			'irrelevant-clarification': 1,
			'unnecessary-clarification': 1,
		});
	});
});

describe('frozen policy candidate grids', () => {
	it('enumerates the embedding grid without floating-point drift', () => {
		const policies = candidatePolicies('embedding');
		expect(policies).toHaveLength(80);
		expect([...new Set(policies.map(policy => policy.threshold))]).toEqual([
			0.7, 0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98, 1.001,
		]);
		expect([...new Set(policies.map(policy => policy.ambiguityGap))]).toEqual([0.005, 0.01, 0.02, 0.04, 0.08]);
	});

	it('enumerates the sigmoid reranker grid', () => {
		const policies = candidatePolicies('reranker');
		expect(policies).toHaveLength(84);
		expect([...new Set(policies.map(policy => policy.threshold))]).toEqual([
			0.001, 0.01, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 0.95, 0.99, 0.999, 1.001,
		]);
		expect([...new Set(policies.map(policy => policy.ambiguityGap))]).toEqual([0.01, 0.025, 0.05, 0.1, 0.2, 0.4]);
	});

	it.each(['embedding', 'reranker'] as const)('retains an actual all-reject baseline for %s', kind => {
		const rejecting = candidatePolicies(kind).filter(policy => policy.threshold > 1);
		expect(rejecting.length).toBeGreaterThan(0);
		expect(rejecting.every(policy => policy.optionThreshold === 1.001)).toBe(true);
	});

	it('returns fresh policy objects rather than shared mutable state', () => {
		const first = candidatePolicies('embedding');
		first[0].threshold = -1;
		expect(candidatePolicies('embedding')[0].threshold).toBe(0.7);
	});
});

describe('calibration selection', () => {
	it('evaluates the entire grid, including all-reject, using only the supplied callback', async () => {
		const evaluate = vi.fn<(policy: SearchPolicy) => Promise<BenchmarkOutcomeRow[]>>(async () => [row('no-answer')]);
		const result = await calibrate('embedding', evaluate);
		expect(evaluate).toHaveBeenCalledTimes(80);
		expect(evaluate.mock.calls.some(([policy]) => policy.threshold === 1.001)).toBe(true);
		expect(result.policy).toMatchObject({ threshold: 1.001, ambiguityGap: 0.005 });
		expect(result.metrics.cost).toBe(1);
	});

	it('minimizes weighted cost before considering the number of direct answers', async () => {
		const result = await calibrate('embedding', async policy => policy.threshold === 0.8
			? [row('no-answer'), row('direct-correct')]
			: [row('wrong-answer'), row('direct-correct')]);
		expect(result.policy.threshold).toBe(0.8);
		expect(result.metrics.cost).toBe(1);
	});

	it('breaks equal cost in favor of fewer wrong answers', async () => {
		const result = await calibrate('embedding', async policy => policy.threshold === 0.8
			? [row('no-answer'), row('no-answer'), row('no-answer'), row('no-answer')]
			: [row('wrong-answer'), row('direct-correct'), row('direct-correct'), row('direct-correct')]);
		expect(result.policy.threshold).toBe(0.8);
		expect(result.metrics).toMatchObject({ cost: 4, wrongAnswers: 0 });
	});

	it('then favors more direct correct answers and a smaller ambiguity gap', async () => {
		const result = await calibrate('embedding', async policy => policy.threshold === 0.8
			? [row('direct-correct')]
			: [row('relevant-clarification')]);
		expect(result.policy).toMatchObject({ threshold: 0.8, ambiguityGap: 0.005 });
		expect(result.metrics.directCorrect).toBe(1);
	});

	it('uses the higher threshold as the final deterministic tie-break', async () => {
		const result = await calibrate('reranker', async () => [row('direct-correct')]);
		expect(result.policy).toMatchObject({ threshold: 1.001, ambiguityGap: 0.01 });
	});

	it('propagates evaluation errors rather than selecting from a partial grid', async () => {
		await expect(calibrate('embedding', async () => {
			throw new Error('missing cached scores');
		})).rejects.toThrow('missing cached scores');
	});
});
