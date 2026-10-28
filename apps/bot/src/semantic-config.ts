import '@rw/runtime/env';

import { DEFAULT_SEARCH_POLICY } from '@rw/core';
import type { SearchPolicy } from '@rw/core';

const score = (key: string, fallback: number): number => {
	const value = process.env[key] === undefined ? fallback : Number(process.env[key]);
	if (!Number.isFinite(value) || value <= 0 || value > 1) {
		throw new Error(`${key} must be greater than 0 and at most 1`);
	}
	return value;
};

export const semanticPolicy: SearchPolicy = {
	threshold: score('E5_THRESHOLD', DEFAULT_SEARCH_POLICY.threshold),
	ambiguityGap: score('E5_AMBIGUITY_GAP', DEFAULT_SEARCH_POLICY.ambiguityGap),
	optionThreshold: score('E5_OPTION_THRESHOLD', DEFAULT_SEARCH_POLICY.optionThreshold!),
	optionGap: score('E5_OPTION_GAP', DEFAULT_SEARCH_POLICY.optionGap!),
};
