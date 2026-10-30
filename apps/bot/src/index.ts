import './tls';

import { DialogEngine } from '@rw/core';
import { errorMessage } from '@rw/runtime';

import { ApiClient } from './api-client';
import { apiConfig } from './api-config';
import { ApiSessionStore } from './api-sessions';
import { config } from './config';
import { ContentCache } from './content-cache';
import { createControlServer } from './control-server';
import { acquireInstanceLease } from './instance-lease';
import type { InstanceLease } from './instance-lease';
import { logger } from './logger';
import { rerankDepth, semanticPolicy } from './semantic-config';
import { createE5Search, E5_MODEL, E5_REVISION, RERANKER_MODEL, RERANKER_REVISION } from './semantic-search';
import { createMaxBot } from './transport/max';

const SHUTDOWN_TIMEOUT_MS = 10_000;

if (!apiConfig.token) {
	throw new Error('INTERNAL_API_TOKEN is required (see .env.example)');
}

const api = new ApiClient(apiConfig.url, apiConfig.token);

// Recorded with every dialog event: which models and thresholds produced the answer
const searchInfo = {
	model: E5_MODEL,
	revision: E5_REVISION,
	...rerankDepth > 0 ? { reranker: RERANKER_MODEL, rerankerRevision: RERANKER_REVISION, rerankDepth } : {},
	...semanticPolicy,
};
logger.info('Loading semantic search', searchInfo);
const search = await createE5Search(rerankDepth);
const content = new ContentCache(api, tree => search.prepare(tree));
await content.init(config.contentRefreshSeconds);
logger.info('Semantic search ready', { nodes: content.get().all().length });

let lease: InstanceLease | null = null;
const control = createControlServer(apiConfig.token, async () => {
	await content.reload();
	logger.info('Content refreshed by internal signal', { version: content.currentVersion() });
	return content.currentVersion();
});

const engine = new DialogEngine(() => content.get(), new ApiSessionStore(api), search, {
	onUnrecognized: async event => {
		try {
			await api.saveUnrecognized(event);
		} catch (error) {
			logger.error('Failed to save unrecognized message', { error: errorMessage(error) });
		}
	},
}, semanticPolicy);

const { bot, drain } = createMaxBot(config.botToken, engine, {
	getContentVersion: () => content.currentVersion(),
	onUser: user => api.touchSubscriber(user),
	onBlocked: userId => api.markSubscriberBlocked(userId),
	// Статистика не должна задерживать ответ: запись уходит в фоне
	onEvent: event => {
		void api.saveDialogEvent({
			...event,
			data: { ...event.data, search: searchInfo },
		}).catch(error =>
			logger.error('Failed to save dialog event', { type: event.type, error: errorMessage(error) }));
	},
	revision: config.revision,
});

// Подписку на вебхук при остановке не снимаем: MAX придержит события на время перезапуска
const shutdown = async (exitCode = 0) => {
	logger.info('Shutting down');
	content.stop();
	control.close();
	control.closeIdleConnections();

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
		await new Promise<void>((resolve, reject) => {
			control.once('error', reject);
			control.listen(config.controlPort, config.controlHost, () => {
				control.removeListener('error', reject);
				resolve();
			});
		});
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
