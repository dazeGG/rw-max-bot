// Вопросы пассажиров и проверка поиска. Их видят суперадмин и админ

import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { PassengerQuestion, QuestionReviewRequest, SearchCheckRequest, SearchCheckResult } from '@rw/core';
import { db, questionReviews } from '@rw/db';
import { errorMessage } from '@rw/runtime';

import { requireAdmin, requireRole } from '../auth/guards';
import { config } from '../config';
import { checkBotSearch } from '../content-notifier';
import { RuleError } from '../errors';
import { logger } from '../logger';
import { loadQuestions } from '../questions';

const key = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;

const reviewBody = {
	type: 'object',
	required: ['key', 'status'],
	properties: {
		key,
		status: { type: 'string', enum: ['dismissed', 'resolved'] },
	},
} as const;

const keyParams = {
	type: 'object',
	required: ['key'],
	properties: { key },
} as const;

const checkBody = {
	type: 'object',
	required: ['text'],
	properties: {
		text: { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' },
	},
} as const;

export const questionsRoutes: FastifyPluginAsync = async app => {
	app.addHook('preHandler', requireAdmin);
	app.addHook('preHandler', requireRole('superadmin', 'admin'));

	app.get('/', (): Promise<PassengerQuestion[]> => loadQuestions());

	app.post<{ Body: QuestionReviewRequest; }>('/reviews', { schema: { body: reviewBody } }, async (request, reply) => {
		const values = { ...request.body, adminId: request.admin!.id, reviewedAt: new Date() };

		await db.insert(questionReviews).values(values).onConflictDoUpdate({ target: questionReviews.key, set: values });

		return reply.code(204).send();
	});

	// Отмена ошибочного «Не вопрос»
	app.delete<{ Params: { key: string; }; }>('/reviews/:key', { schema: { params: keyParams } }, async (request, reply) => {
		await db.delete(questionReviews).where(eq(questionReviews.key, request.params.key));

		return reply.code(204).send();
	});

	// Поиск живет в боте: только там загружены модели и индекс
	app.post<{ Body: SearchCheckRequest; }>('/check', { schema: { body: checkBody } }, async (request): Promise<SearchCheckResult> => {
		try {
			return await checkBotSearch(config.botControlUrl, config.internalToken, request.body.text);
		} catch (error) {
			logger.warn('Bot did not answer search check', { error: errorMessage(error) });
			throw new RuleError(503, 'Бот сейчас недоступен, проверить поиск нельзя. Попробуйте позже');
		}
	});
};
