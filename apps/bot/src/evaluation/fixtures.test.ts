import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createEvaluationTrees, examples, HELDOUT_SHA256, HELDOUT_VERSION, heldoutExamples } from './fixtures';

const frozenHash = '967f1d415912ff632f03fac5cee385da20d753f9766cfa1c2ff7b6d50bada382';
// Preserve punctuation and symbols: only presentation case/whitespace are ignored here.
const questionKey = (text: string): string => text.toLowerCase().replace(/\s+/gu, ' ').trim();

describe('frozen standalone heldout fixtures', () => {
	it('retains the exact version, contents and expected labels fixed before inference', () => {
		expect(HELDOUT_VERSION).toBe('2026-10-28-v1');
		expect(HELDOUT_SHA256).toBe(frozenHash);
		const actual = createHash('sha256').update(JSON.stringify({ version: HELDOUT_VERSION, examples: heldoutExamples })).digest('hex');
		expect(actual).toBe(frozenHash);
	});

	it('contains 48 standalone questions across both domains', () => {
		expect(heldoutExamples).toHaveLength(48);
		expect(heldoutExamples.filter(example => example.domain === 'railway')).toHaveLength(34);
		expect(heldoutExamples.filter(example => example.domain === 'library')).toHaveLength(14);
		expect(new Set(heldoutExamples.map(example => example.domain))).toEqual(new Set(['railway', 'library']));
	});

	it('keeps the intended direct, ambiguous and unsupported composition', () => {
		for (const [domain, counts] of [
			['railway', { direct: 28, ambiguous: 2, unsupported: 4 }],
			['library', { direct: 10, ambiguous: 2, unsupported: 2 }],
		] as const) {
			const steps = heldoutExamples.filter(example => example.domain === domain).map(example => example.steps[0]);
			expect({
				direct: steps.filter(step => !step.clarification && !step.expected.includes('unrecognized')).length,
				ambiguous: steps.filter(step => step.clarification !== undefined).length,
				unsupported: steps.filter(step => step.expected.includes('unrecognized')).length,
			}).toEqual(counts);
		}
	});

	it('uses unique stable example IDs and unique questions', () => {
		expect(new Set(heldoutExamples.map(example => example.name)).size).toBe(heldoutExamples.length);
		expect(new Set(heldoutExamples.map(example => questionKey(example.steps[0].text))).size).toBe(heldoutExamples.length);
		for (const example of heldoutExamples) {
			expect(example.name).toMatch(/^heldout-[rl]\d{2}$/);
		}
	});

	it('does not reuse any old first-turn calibration question', () => {
		const oldQuestions = new Set(examples.map(example => questionKey(example.steps[0].text)));
		for (const example of heldoutExamples) {
			expect(oldQuestions.has(questionKey(example.steps[0].text)), example.name).toBe(false);
		}
	});

	it('has one nonempty independently labelled first step per example', () => {
		for (const example of heldoutExamples) {
			expect(example.steps, example.name).toHaveLength(1);
			const step = example.steps[0];
			expect(step.text.trim().length, example.name).toBeGreaterThan(0);
			expect(step.expected.length > 0 || (step.clarification?.length ?? 0) > 1, example.name).toBe(true);
			expect(new Set(step.expected).size, example.name).toBe(step.expected.length);
			if (step.clarification) {
				expect(step.clarification.length, example.name).toBeGreaterThan(1);
				expect(new Set(step.clarification).size, example.name).toBe(step.clarification.length);
			}
		}
	});

	it('resolves every positive and clarification label against its active domain corpus', () => {
		const trees = createEvaluationTrees();
		for (const example of heldoutExamples) {
			const step = example.steps[0];
			for (const code of [...step.expected, ...step.clarification ?? []]) {
				if (code === 'unrecognized') {
					continue;
				}
				const node = trees[example.domain].getByCode(code);
				expect(node, `${example.name}: ${code}`).toBeDefined();
				expect(node?.isActive, `${example.name}: ${code}`).toBe(true);
			}
		}
	});

	it('treats unsupported questions as rejection only, not an invented corpus node', () => {
		const trees = createEvaluationTrees();
		for (const tree of Object.values(trees)) {
			expect(tree.getByCode('unrecognized')).toBeUndefined();
		}
		for (const example of heldoutExamples.filter(item => item.steps[0].expected.includes('unrecognized'))) {
			expect(example.steps[0].expected).toEqual(['unrecognized']);
			expect(example.steps[0].clarification).toBeUndefined();
		}
	});
});
