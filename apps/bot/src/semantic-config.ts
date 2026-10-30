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

// Weight of the E5 lag behind its leader in the final score; 0.5 was the best on the real questions
export const rerankE5Weight = (() => {
	const raw = process.env.RERANK_E5_WEIGHT?.trim();
	const value = raw === undefined || raw === '' ? 0.5 : Number(raw);
	if (!Number.isFinite(value) || value < 0 || value > 10) {
		throw new Error('RERANK_E5_WEIGHT must be from 0 to 10');
	}
	return value;
})();

// Global answers are judged on the reranker's sigmoid scale when it is on, on E5 cosine otherwise.
// Button labels are always matched by E5 and keep their own thresholds.
// Reranker defaults come from `pnpm calibrate:policy` on real MAX and Telegram questions (2026-10-30):
// a sure leader is answered, other leaders above 0.02 are offered as a choice, wrong answers are rare.
// With synonyms indexed the grid prefers 0.98/0.06: equally helpful on the held-out part, fewer direct answers, so kept.
const reranked = rerankDepth > 0;
export const semanticPolicy: SearchPolicy = {
	threshold: reranked ? score('RERANK_THRESHOLD', 0.9) : score('E5_THRESHOLD', DEFAULT_SEARCH_POLICY.threshold),
	ambiguityGap: reranked ? score('RERANK_AMBIGUITY_GAP', 0.15) : score('E5_AMBIGUITY_GAP', DEFAULT_SEARCH_POLICY.ambiguityGap),
	// Between this and the threshold the leaders are offered instead of answered
	...reranked ? { clarifyThreshold: score('RERANK_CLARIFY_THRESHOLD', 0.02) } : {},
	optionThreshold: score('E5_OPTION_THRESHOLD', reranked ? 0.91 : DEFAULT_SEARCH_POLICY.optionThreshold!),
	optionGap: score('E5_OPTION_GAP', reranked ? 0.002 : DEFAULT_SEARCH_POLICY.optionGap!),
};
