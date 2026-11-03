import { describe, expect, it } from 'vitest';

import { groupQuestions, questionKey } from './questions';
import type { AskedRow, QuestionNode, ReviewRow } from './questions';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 10, minute));

const row = (over: Partial<AskedRow> = {}): AskedRow => ({
	source: 'unrecognized',
	userId: 1,
	text: 'где забрать вещи',
	normalized: 'где забрать вещи',
	candidates: [],
	offered: [],
	createdAt: at(0),
	...over,
});

const nodes: QuestionNode[] = [
	{ id: 1, code: 'lost', title: 'Забытые вещи', isActive: true },
	{ id: 2, code: 'refund', title: 'Возврат билета', isActive: true },
	{ id: 3, code: 'off', title: 'Выключенный', isActive: false },
];

const group = (rows: AskedRow[], reviews: ReviewRow[] = []) => groupQuestions(rows, reviews, nodes);

describe('вопросы пассажиров', () => {
	it('объединяет одинаковые и считает людей и источники', () => {
		const [question, ...rest] = group([
			row({ text: 'Где забрать вещи?', userId: 1, createdAt: at(1) }),
			row({ text: 'где забрать ВЕЩИ', userId: 2, createdAt: at(3) }),
			row({ text: 'Где забрать вещи', userId: 2, createdAt: at(2), source: 'noOption' }),
		]);

		expect(rest).toEqual([]);
		expect(question).toMatchObject({
			text: 'где забрать ВЕЩИ',
			count: 3,
			people: 2,
			sources: { unrecognized: 2, noOption: 1 },
			lastAt: at(3).toISOString(),
			key: questionKey('где забрать вещи'),
		});
	});

	it('похожие, но разные фразы не объединяет', () => {
		expect(group([row(), row({ normalized: 'где найти вещи' })])).toHaveLength(2);
	});

	it('сначала самые частые, при равенстве самые свежие', () => {
		const list = group([
			row({ normalized: 'редкий', createdAt: at(9) }),
			row({ normalized: 'частый', createdAt: at(1) }),
			row({ normalized: 'частый', createdAt: at(2) }),
			row({ normalized: 'свежий', createdAt: at(10) }),
		]);

		expect(list.map(question => question.key)).toEqual(['частый', 'свежий', 'редкий'].map(questionKey));
	});

	it('фраза для поиска без приветствия', () => {
		expect(group([row({ text: 'Здравствуйте, где забрать вещи?' })])[0].phrase).toBe('где забрать вещи?');
	});

	it('«Не вопрос» убирает фразу насовсем', () => {
		const review: ReviewRow = { key: questionKey('где забрать вещи'), status: 'dismissed', reviewedAt: at(5) };

		expect(group([row({ createdAt: at(1) }), row({ createdAt: at(9) })], [review])).toEqual([]);
	});

	it('обработанная возвращается только с новыми вопросами', () => {
		const review: ReviewRow = { key: questionKey('где забрать вещи'), status: 'resolved', reviewedAt: at(5) };

		expect(group([row({ createdAt: at(1) }), row({ createdAt: at(5) })], [review])).toEqual([]);
		expect(group([row({ createdAt: at(1) }), row({ createdAt: at(9) })], [review])[0]).toMatchObject({ count: 1, lastAt: at(9).toISOString() });
	});

	it('подсказывает найденные разделы без дублей, выключенных и удаленных', () => {
		const [question] = group([
			row({ candidates: ['refund', 'lost', 'off', 'удален'] }),
			row({ candidates: ['lost'] }),
		]);

		expect(question.suggestions).toEqual([{ id: 2, title: 'Возврат билета' }, { id: 1, title: 'Забытые вещи' }]);
	});

	it('разделы, которые пассажир отклонил, показывает отдельно и не подсказывает', () => {
		const [question] = group([row({ source: 'noOption', offered: ['refund', 'удален'], candidates: ['refund', 'lost'] })]);

		expect(question.offered).toEqual(['Возврат билета']);
		expect(question.suggestions).toEqual([{ id: 1, title: 'Забытые вещи' }]);
	});
});
