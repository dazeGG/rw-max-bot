import './tls';

import { DialogEngine } from '@rw/core';
import { errorMessage } from '@rw/runtime';

import { ApiClient } from './api-client';
import { apiConfig } from './api-config';
import { ApiSessionStore } from './api-sessions';
import { config } from './config';
import { ContentCache } from './content-cache';
import { acquireInstanceLease } from './instance-lease';
import type { InstanceLease } from './instance-lease';
import { logger } from './logger';
import { createMaxBot } from './transport/max';

const SHUTDOWN_TIMEOUT_MS = 10_000;

if (!apiConfig.token) {
	throw new Error('INTERNAL_API_TOKEN is required (see .env.example)');
}

const api = new ApiClient(apiConfig.url, apiConfig.token);

const content = new ContentCache(api);
await content.init(config.contentRefreshSeconds);

let lease: InstanceLease | null = null;

const engine = new DialogEngine(() => content.get(), new ApiSessionStore(api), {
	onUnrecognized: async event => {
		try {
			await api.saveUnrecognized(event);
		} catch (error) {
			logger.error('Failed to save unrecognized message', { error: errorMessage(error) });
		}
	},
});

const { bot, drain } = createMaxBot(config.botToken, engine, {
	onUser: user => api.touchSubscriber(user),
	onBlocked: userId => api.markSubscriberBlocked(userId),
});

// Подписку на вебхук при остановке не снимаем: MAX придержит события на время перезапуска
const shutdown = async (exitCode = 0) => {
	logger.info('Shutting down');
	content.stop();

	if (config.mode === 'polling') {
		bot.stopPolling();
	}

	const timeout = new Promise(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref());
	await Promise.race([drain(), timeout]);
	await lease?.release();

	logger.on('finish', () => process.exit(exitCode));
	logger.end();
};

lease = await acquireInstanceLease(api, () => {
	logger.error('Another bot instance took over, exiting');
	void shutdown(1);
});

if (!lease) {
	logger.error('Another bot instance is already running, exiting');
	content.stop();
	logger.on('finish', () => process.exit(1));
	logger.end();
} else {
	process.once('SIGINT', () => void shutdown());
	process.once('SIGTERM', () => void shutdown());

	try {
		if (config.webhook) {
			logger.info('Starting bot in webhook mode', { domain: config.webhook.domain, port: config.webhook.port });
			await bot.start({
				mode: 'webhook',
				options: {
					domain: config.webhook.domain,
					path: config.webhook.path,
					secret: config.webhook.secret,
					port: config.webhook.port,
				},
			});
		} else {
			// Polling снимает все подписки на вебхук: с боевым токеном локально так запускать нельзя
			logger.info('Starting bot in polling mode');
			await bot.start({ mode: 'polling' });
		}
	} catch (error) {
		// Например, MAX не принял адрес вебхука. Аренду отпускаем сразу, чтобы перезапуск не ждал ее истечения
		logger.error('Bot start failed', { error: errorMessage(error) });
		await shutdown(1);
	}
}
