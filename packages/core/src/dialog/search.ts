import type { ContentTree } from '../content/tree';
import type { ContentNode } from '../content/types';

export type Candidate = {
	node: ContentNode;
	// Косинусное сходство семантической модели; не вероятность правильного ответа.
	score: number;
};

// Поиск внедряется транспортом: core не загружает модели и не обращается к сети.
export interface DialogSearch {
	rank (tree: ContentTree, nodes: ContentNode[], text: string, context?: ContentNode): Promise<Candidate[]>;
}

export type SearchPolicy = {
	threshold: number;
	ambiguityGap: number;
};

// Начальные пороги для E5; калибруются отдельно на реальных вопросах.
export const DEFAULT_SEARCH_POLICY: Readonly<SearchPolicy> = {
	threshold: 0.84,
	ambiguityGap: 0.025,
};
