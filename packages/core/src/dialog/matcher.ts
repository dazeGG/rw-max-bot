import type { ContentNode } from '../content/types';
import type { ContentTree, IndexedPhrase } from '../content/tree';

import { phraseKey, stems } from './text';

export type Candidate = {
	node: ContentNode;
	score: number;
};

// Расстояние Дамерау — Левенштейна, ограниченное сверху: нужно только «0, 1 или больше»
const withinOneEdit = (a: string, b: string): boolean => {
	if (a === b) {
		return true;
	}

	if (Math.abs(a.length - b.length) > 1) {
		return false;
	}

	let i = 0;

	while (i < a.length && i < b.length && a[i] === b[i]) {
		i++;
	}

	// Перестановка соседних букв: «билте» → «билет»
	if (a.length === b.length && i + 1 < a.length && a[i] === b[i + 1] && a[i + 1] === b[i]) {
		return a.slice(i + 2) === b.slice(i + 2);
	}

	if (a.length === b.length) {
		return a.slice(i + 1) === b.slice(i + 1);
	}

	return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
};

const stemsMatch = (query: string, phrase: string): boolean => {
	if (query === phrase) {
		return true;
	}

	const shorter = query.length < phrase.length ? query : phrase;
	const longer = shorter === query ? phrase : query;

	// Разные формы, которые стеммер не свел к одной основе: «дальн» / «дальнего»
	if (shorter.length >= 4 && longer.startsWith(shorter)) {
		return true;
	}

	// Опечатка в одну букву: «билт» → «билет». В коротких словах не проверяем, слишком много ложных совпадений
	return shorter.length >= 4 && longer.length >= 5 && withinOneEdit(query, phrase);
};

const sumWeights = (tree: ContentTree, list: string[]): number =>
	list.reduce((sum, stem) => sum + tree.weight(stem), 0);

// Какая доля фразы раздела найдена в вопросе (с учетом веса слов)
const phraseRecall = (tree: ContentTree, queryStems: string[], phrase: IndexedPhrase): number => {
	if (phrase.stems.length === 0) {
		return 0;
	}

	const matched = phrase.stems.filter(p => queryStems.some(q => stemsMatch(q, p)));

	return sumWeights(tree, matched) / sumWeights(tree, phrase.stems);
};

// Точное совпадение с названием или синонимом весит больше любого частичного (максимум частичного — 1)
export const EXACT_SCORE = 1.2;

// Вопрос вместе с контекстом дает фразу целиком: в разделе «Трансфер» «расписание» — это «Расписание трансфера».
// Вопрос должен назвать то, чего в контексте нет, иначе «трансфер» в «Трансфере» совпал бы с любым пунктом
const completesPhrase = (phrase: IndexedPhrase, queryStems: string[], context: Set<string>): boolean => {
	const missing = phrase.stems.filter(p => !context.has(p));

	return missing.length > 0 &&
		missing.every(p => queryStems.some(q => stemsMatch(q, p))) &&
		queryStems.every(q => phrase.stems.some(p => stemsMatch(q, p)));
};

// context — основы слов раздела, в котором идет разговор (для его пунктов)
export const scoreNode = (tree: ContentTree, node: ContentNode, key: string, queryStems: string[], context?: Set<string>): number => {
	const phrases = tree.phrasesOf(node);

	if (key !== '' && phrases.some(phrase => phrase.key === key)) {
		return EXACT_SCORE;
	}

	if (context && queryStems.length > 0 && phrases.some(phrase => completesPhrase(phrase, queryStems, context))) {
		return EXACT_SCORE;
	}

	if (queryStems.length === 0) {
		return 0;
	}

	const recall = Math.max(0, ...phrases.map(phrase => phraseRecall(tree, queryStems, phrase)));

	if (recall === 0) {
		return 0;
	}

	// Какая доля вопроса объяснена словами раздела: штрафует разделы, которые покрывают только часть вопроса
	const nodeStems = [...tree.stemsOf(node)];
	const explained = queryStems.filter(q => nodeStems.some(p => stemsMatch(q, p)));
	const precision = sumWeights(tree, explained) / sumWeights(tree, queryStems);

	return recall * 0.6 + precision * 0.4;
};

// bonus — прибавка за контекст: пункты текущего раздела вероятнее, чем раздел из другой ветки.
// contextOf — основы слов раздела, которые дополняют короткий вопрос к пункту (см. completesPhrase)
export const rank = (
	tree: ContentTree,
	nodes: ContentNode[],
	text: string,
	bonus: (node: ContentNode) => number = () => 0,
	contextOf: (node: ContentNode) => Set<string> | undefined = () => undefined,
): Candidate[] => {
	const queryStems = stems(text);
	const key = phraseKey(text);

	return nodes
		.map(node => ({ node, score: scoreNode(tree, node, key, queryStems, contextOf(node)) }))
		.filter(candidate => candidate.score > 0)
		.map(candidate => ({ ...candidate, score: candidate.score + bonus(candidate.node) }))
		// При равных баллах выигрывает более общий раздел
		.sort((a, b) => b.score - a.score || tree.depth(a.node) - tree.depth(b.node));
};
