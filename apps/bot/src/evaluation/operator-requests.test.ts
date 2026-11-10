import { describe, expect, it } from 'vitest';

import { notOperatorRequests, operatorRequests } from './operator-requests';

describe('operator request fixtures', () => {
	it('keeps both sides of the set and no phrase twice', () => {
		const texts = [...operatorRequests, ...notOperatorRequests].map(step => step.text.toLowerCase().trim());

		expect(operatorRequests.length).toBeGreaterThanOrEqual(10);
		expect(notOperatorRequests.length).toBeGreaterThanOrEqual(10);
		expect(new Set(texts).size).toBe(texts.length);
	});

	it('expects the operator only for the requests to call a person', () => {
		expect(operatorRequests.every(step => step.expected.join() === 'operator')).toBe(true);
		expect(notOperatorRequests.some(step => step.expected.includes('operator'))).toBe(false);
	});
});
