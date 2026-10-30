import '@rw/runtime/env';

import { DEFAULT_SEARCH_POLICY } from '@rw/core';
import type { SearchPolicy } from '@rw/core';

const score = (key: string, fallback: number): number => {
	const raw = process.env[key]?.trim();
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	if (!Number.isFinite(value) || value <= 0 || value > 1) {
		throw new Error(`${key} must be greater than 0 and at most 1`);
	}
	return value;
};

const count = (key: string, fallback: number): number => {
	const raw = process.env[key]?.trim();
	const value = raw === undefined || raw === '' ? fallback : Number(raw);
	if (!Number.isInteger(value) || value < 0 || value > 50) {
		throw new Error(`${key} must be an integer from 0 to 50`);
	}
	return value;
};

// How many E5 leaders the BGE reranker rescores; 0 keeps E5-only search
export const rerankDepth = count('RERANK_DEPTH', 10);

// Global answers are judged on the reranker's sigmoid scale when it is on, on E5 cosine otherwise.
// Button labels are always matched by E5 and keep their own thresholds.
export const semanticPolicy: SearchPolicy = {
	threshold: rerankDepth > 0 ? score('RERANK_THRESHOLD', 0.8) : score('E5_THRESHOLD', DEFAULT_SEARCH_POLICY.threshold),
	ambiguityGap: rerankDepth > 0 ? score('RERANK_AMBIGUITY_GAP', 0.01) : score('E5_AMBIGUITY_GAP', DEFAULT_SEARCH_POLICY.ambiguityGap),
	// Optional: between this and the threshold the leaders are offered instead of answered
	...process.env.RERANK_CLARIFY_THRESHOLD && rerankDepth > 0 ? { clarifyThreshold: score('RERANK_CLARIFY_THRESHOLD', 0) } : {},
	optionThreshold: score('E5_OPTION_THRESHOLD', DEFAULT_SEARCH_POLICY.optionThreshold!),
	optionGap: score('E5_OPTION_GAP', DEFAULT_SEARCH_POLICY.optionGap!),
};
