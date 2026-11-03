// Вопросы пассажиров: что бот не понял и где пассажир выбрал «Нет подходящего варианта».
// Берутся из журнала диалогов, поэтому видны и вопросы, заданные до появления этого экрана

import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { stripGreetingRaw } from '@rw/core';
import type { PassengerQuestion, QuestionReviewStatus, QuestionSource, SearchCheckNode } from '@rw/core';
import { contentNodes, db, questionReviews } from '@rw/db';

const PERIOD_DAYS = 30;
const MAX_QUESTIONS = 500;
const MAX_SUGGESTIONS = 5;

export type AskedRow = {
	source: QuestionSource;
	userId: number;
	text: string;
	normalized: string;
	// Коды разделов: кого нашел поиск и что бот предложил пассажиру
	candidates: string[];
	offered: string[];
	createdAt: Date;
};

export type ReviewRow = {
	key: string;
	status: QuestionReviewStatus;
	reviewedAt: Date;
};

export type QuestionNode = SearchCheckNode & {
	code: string;
	isActive: boolean;
};

// Длинное сообщение не поместится в индекс БД, поэтому запись об обработке ссылается на хеш
export const questionKey = (normalized: string) => createHash('sha256').update(normalized).digest('hex');

// Объединяем только одинаковые вопросы: похожие по смыслу может объединить лишь человек.
// «Не вопрос» убирает фразу насовсем. Обработанная возвращается, если ее снова спросили: значит, правка не помогла
export const groupQuestions = (rows: AskedRow[], reviews: ReviewRow[], nodes: QuestionNode[]): PassengerQuestion[] => {
	const reviewed = new Map(reviews.map(review => [review.key, review]));
	const byCode = new Map(nodes.map(node => [node.code, node]));
	const groups = new Map<string, AskedRow[]>();

	for (const row of rows) {
		const key = questionKey(row.normalized);
		const review = reviewed.get(key);

		if (review?.status === 'dismissed' || (review && row.createdAt <= review.reviewedAt)) {
			continue;
		}

		groups.set(key, [...groups.get(key) ?? [], row]);
	}

	return [...groups].map(([key, group]) => {
		const latest = group.reduce((a, b) => b.createdAt > a.createdAt ? b : a);
		const noOption = group.find(row => row.source === 'noOption');
		const offered = noOption?.offered ?? [];
		const rejected = new Set(offered);

		return {
			key,
			text: latest.text,
			phrase: stripGreetingRaw(latest.text).rest.trim(),
			sources: {
				unrecognized: group.filter(row => row.source === 'unrecognized').length,
				noOption: group.filter(row => row.source === 'noOption').length,
			},
			count: group.length,
			people: new Set(group.map(row => row.userId)).size,
			lastAt: latest.createdAt.toISOString(),
			offered: offered.flatMap(code => byCode.get(code)?.title ?? []),
			// То, что пассажир уже отклонил, предлагать незачем: это можно выбрать и из общего списка
			suggestions: group.flatMap(row => row.candidates)
				.filter((code, index, all) => !rejected.has(code) && all.indexOf(code) === index)
				.flatMap(code => {
					const node = byCode.get(code);
					return node?.isActive ? [{ id: node.id, title: node.title }] : [];
				})
				.slice(0, MAX_SUGGESTIONS),
		};
	})
		.sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt))
		.slice(0, MAX_QUESTIONS);
};

type DbRow = Omit<AskedRow, 'createdAt' | 'userId' | 'candidates' | 'offered'> & {
	userId: string | number;
	createdAt: string | Date;
	candidates: { code: string; }[] | null;
	offered: string[] | null;
};

// Выбор «Нет подходящего варианта» — следующее сообщение после уточнения: номер последнего пункта
// или его название словами. Вопрос пассажира лежит в событии уточнения.
// Номер варианта, которого не было в списке, — это не вопрос
const askedRows = async (): Promise<AskedRow[]> => {
	const { rows } = await db.execute<DbRow>(sql`
		with messages as (
			select user_id, type, text, data, node_code, created_at,
				lag(type) over w as prev_type,
				lag(text) over w as prev_text,
				lag(data) over w as prev_data,
				lag(created_at) over w as prev_at
			from dialog_events
			where created_at >= now() - make_interval(days => ${PERIOD_DAYS})
				and type in ('start', 'answer', 'option', 'clarify', 'unrecognized', 'back', 'menu', 'more', 'goodbye')
			window w as (partition by user_id order by created_at, id)
		)
		select 'unrecognized' as source, user_id as "userId", text,
			coalesce(data->>'normalized', lower(trim(text))) as normalized,
			data->'candidates' as candidates, '[]'::jsonb as offered, created_at as "createdAt"
		from messages
		where type = 'unrecognized' and coalesce(trim(text), '') <> '' and not (data ? 'unmatchedOption')
		union all
		select 'noOption', user_id, prev_text,
			coalesce(prev_data->>'normalized', lower(trim(prev_text))),
			prev_data->'candidates', prev_data->'suggested', prev_at
		from messages
		where type = 'option' and prev_type = 'clarify' and prev_data ? 'handoff' and coalesce(trim(prev_text), '') <> ''
			and (
				(data->>'option')::int = jsonb_array_length(prev_data->'suggested') + 1
				or ((data->>'labelMatch')::boolean and node_code = prev_data->>'handoff')
			)
	`);

	return rows.map(row => ({
		...row,
		userId: Number(row.userId),
		candidates: (row.candidates ?? []).map(candidate => candidate.code),
		offered: row.offered ?? [],
		createdAt: new Date(row.createdAt),
	}));
};

export const loadQuestions = async (): Promise<PassengerQuestion[]> => {
	const [rows, reviews, nodes] = await Promise.all([
		askedRows(),
		db.select().from(questionReviews),
		db.select({ id: contentNodes.id, code: contentNodes.code, title: contentNodes.title, isActive: contentNodes.isActive }).from(contentNodes),
	]);

	return groupQuestions(rows, reviews as ReviewRow[], nodes);
};
