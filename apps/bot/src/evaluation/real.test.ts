import { describe, expect, it } from 'vitest';

import { createEvaluationTrees } from './fixtures';
import { realMaxExamples } from './real-max';
import { realTgExamples } from './real-tg';

describe('real production fixtures', () => {
	it('label only active railway sections', () => {
		const tree = createEvaluationTrees().railway;
		const labels = [...realMaxExamples, ...realTgExamples].flatMap(example => example.steps.flatMap(step => [...step.expected, ...step.clarification ?? []]));
		expect(labels.filter(code => code !== 'unrecognized' && !tree.getByCode(code))).toEqual([]);
	});

	it('use unique scenario names', () => {
		const names = [...realMaxExamples, ...realTgExamples].map(example => example.name);
		expect(new Set(names).size).toBe(names.length);
	});
});
