// Запросы бота. Доступ по общему секрету INTERNAL_API_TOKEN, снаружи (через nginx) не публикуются

import { createHash, timingSafeEqual } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';

import type { BotLeaseRequest, DialogEventRecord, DialogUser, Session, UnrecognizedEvent } from '@rw/core';

import type { BotLease } from '../bot-lease';
import { config } from '../config';
import { loadContent } from '../content';
import { notifyBotContentChanged } from '../content-notifier';
import { getSession, markSubscriberBlocked, saveDialogEvent, saveUnrecognized, setSession, touchSubscriber } from '../store';

const digest = (value: string) => createHash('sha256').update(value).digest();
const expectedToken = digest(`Bearer ${config.internalToken}`);

const userIdParams = {
	type: 'object',
	required: ['userId'],
	properties: { userId: { type: 'integer' } },
} as const;

const sessionBody = {
	type: 'object',
	required: ['nodeId'],
	properties: {
		nodeId: { type: ['integer', 'null'] },
		choices: { type: 'array', items: { type: 'integer' } },
	},
} as const;

const subscriberBody = {
	type: 'object',
	required: ['id'],
	properties: {
		id: { type: 'integer' },
		firstName: { type: 'string' },
		lastName: { type: ['string', 'null'] },
		username: { type: ['string', 'null'] },
	},
} as const;

const unrecognizedBody = {
	type: 'object',
	required: ['userId', 'text', 'nodeId'],
	properties: {
		userId: { type: 'integer' },
		text: { type: 'string', maxLength: 4000 },
		nodeId: { type: ['integer', 'null'] },
	},
} as const;

// Тип события не ограничен списком, data и raw — любые объекты: журнал расширяется без правок API
const dialogEventBody = {
	type: 'object',
	required: ['userId', 'type', 'createdAt'],
	properties: {
		userId: { type: 'integer' },
		type: { type: 'string', minLength: 1, maxLength: 50 },
		nodeId: { type: ['integer', 'null'] },
		nodeCode: { type: ['string', 'null'], maxLength: 100 },
		contentVersion: { type: ['string', 'null'], maxLength: 64 },
		text: { type: ['string', 'null'] },
		data: { type: 'object' },
		raw: {},
		createdAt: { type: 'string', format: 'date-time' },
	},
} as const;

const leaseBody = {
	type: 'object',
	required: ['instanceId'],
	properties: { instanceId: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

export const internalRoutes = (lease: BotLease): FastifyPluginAsync => async app => {
	app.addHook('onRequest', async (request, reply) => {
		const actual = digest(request.headers.authorization ?? '');

		if (!timingSafeEqual(actual, expectedToken)) {
			return reply.code(401).send({ error: 'Unauthorized' });
		}
	});

	app.get('/content', async (request, reply) => {
		const snapshot = await loadContent();
		const etag = `"${snapshot.version}"`;

		reply.header('etag', etag);

		if (request.headers['if-none-match'] === etag) {
			return reply.code(304).send();
		}

		return snapshot;
	});

	// Для обслуживания после прямой правки БД; notifier также можно вызвать после сохранения из админки.
	app.post('/content/refresh', async (request, reply) => {
		try {
			return await notifyBotContentChanged(config.botControlUrl, config.internalToken);
		} catch {
			return reply.code(503).send({
				error: 'Не удалось подтвердить обновление контента бота. Повторите запрос или дождитесь резервного опроса.',
			});
		}
	});

	app.get<{ Params: { userId: number; }; }>('/sessions/:userId', { schema: { params: userIdParams } }, async request =>
		getSession(request.params.userId));

	app.put<{ Params: { userId: number; }; Body: Session; }>('/sessions/:userId', { schema: { params: userIdParams, body: sessionBody } }, async (request, reply) => {
		await setSession(request.params.userId, request.body);
		return reply.code(204).send();
	});

	app.post<{ Body: DialogUser; }>('/subscribers', { schema: { body: subscriberBody } }, async (request, reply) => {
		await touchSubscriber(request.body);
		return reply.code(204).send();
	});

	app.post<{ Params: { userId: number; }; }>('/subscribers/:userId/blocked', { schema: { params: userIdParams } }, async (request, reply) => {
		await markSubscriberBlocked(request.params.userId);
		return reply.code(204).send();
	});

	app.post<{ Body: UnrecognizedEvent; }>('/unrecognized', { schema: { body: unrecognizedBody } }, async (request, reply) => {
		await saveUnrecognized(request.body);
		return reply.code(204).send();
	});

	app.post<{ Body: DialogEventRecord; }>('/events', { schema: { body: dialogEventBody } }, async (request, reply) => {
		await saveDialogEvent(request.body);
		return reply.code(204).send();
	});

	app.post<{ Body: BotLeaseRequest; }>('/bot/lease', { schema: { body: leaseBody } }, async (request, reply) =>
		reply.code(lease.acquire(request.body.instanceId) ? 204 : 409).send());

	app.delete<{ Params: BotLeaseRequest; }>('/bot/lease/:instanceId', async (request, reply) => {
		lease.release(request.params.instanceId);
		return reply.code(204).send();
	});
};
