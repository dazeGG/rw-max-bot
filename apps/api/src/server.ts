import cookie from '@fastify/cookie';
import Fastify from 'fastify';

import { BOT_LEASE_TTL_SECONDS } from '@rw/core';
import { errorMessage } from '@rw/runtime';

import { BotLease } from './bot-lease';
import { RuleError } from './errors';
import { logger } from './logger';
import { adminRoutes } from './routes/admin';
import { internalRoutes } from './routes/internal';
import { startSilenceSweep } from './support';
import { closeStreams } from './support-hub';
import { startShiftDigest } from './support-notifications';

export const buildServer = () => {
	// Журнал пишет winston (logs/api*.log), встроенный логгер Fastify выключен
	const app = Fastify({ logger: false, trustProxy: true });
	const lease = new BotLease(BOT_LEASE_TTL_SECONDS * 1000);

	app.register(cookie);
	app.register(internalRoutes(lease), { prefix: '/internal' });
	app.register(adminRoutes, { prefix: '/api' });

	app.get('/health', async () => ({ ok: true }));

	const stopSweep = startSilenceSweep();
	const stopDigest = startShiftDigest();

	// Иначе открытые соединения чата не дадут серверу остановиться
	app.addHook('preClose', async () => {
		stopSweep();
		stopDigest();
		closeStreams();
	});

	app.setErrorHandler((error: { statusCode?: number; validation?: unknown; }, request, reply) => {
		if (error.validation) {
			return reply.code(400).send({ error: errorMessage(error) });
		}

		if (error instanceof RuleError) {
			return reply.code(error.statusCode).send({ error: error.message });
		}

		logger.error('Request failed', {
			method: request.method,
			url: request.url,
			error: errorMessage(error),
			stack: error instanceof Error ? error.stack : undefined,
		});

		return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({ error: 'Внутренняя ошибка сервера' });
	});

	return app;
};
