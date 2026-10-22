import './tls';

import { config } from './config';
import { ContentCache } from './content/repository';
import { pool } from './db';
import { acquireInstanceLock } from './db/instance-lock';
import { setupDatabase } from './db/setup';
import { DialogEngine } from './dialog/engine';
import { markSubscriberBlocked, PgSessionStore, saveUnrecognized, touchSubscriber } from './dialog/pg-store';
import { logger } from './logger';
import { createMaxBot } from './transport/max';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const lock = await acquireInstanceLock();

if (!lock) {
	logger.error('Another bot instance is already running for this database, exiting');
	await pool.end();
	process.exit(1);
}

const seeded = await setupDatabase();

if (seeded > 0) {
	logger.info('Database was empty, initial content loaded', { nodes: seeded });
}

const content = new ContentCache();
await content.init(config.contentRefreshSeconds);

const engine = new DialogEngine(() => content.get(), new PgSessionStore(), {
	onUnrecognized: async event => {
		try {
			await saveUnrecognized(event);
		} catch (error) {
			logger.error('Failed to save unrecognized message', { error: error instanceof Error ? error.message : String(error) });
		}
	},
});

const { bot, drain } = createMaxBot(config.botToken, engine, {
	onUser: touchSubscriber,
	onBlocked: markSubscriberBlocked,
});

// Подписку на вебхук при остановке не снимаем: MAX придержит события на время перезапуска
const shutdown = async () => {
	logger.info('Shutting down');
	content.stop();

	if (config.mode === 'polling') {
		bot.stopPolling();
	}

	const timeout = new Promise(resolve => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref());
	await Promise.race([drain(), timeout]);
	lock.release();
	await pool.end();

	logger.on('finish', () => process.exit(0));
	logger.end();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

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
	logger.info('Starting bot in polling mode');
	await bot.start({ mode: 'polling' });
}
