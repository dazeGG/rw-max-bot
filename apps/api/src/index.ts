import '@rw/runtime/env';

import { pool, setupDatabase } from '@rw/db';
import { errorMessage } from '@rw/runtime';

import { config } from './config';
import { logger } from './logger';
import { buildServer } from './server';

// Без обработчика обрыв простаивающего соединения (перезапуск PostgreSQL) роняет процесс
pool.on('error', error => {
	logger.error('PostgreSQL pool error', { error: error.message });
});

const seeded = await setupDatabase();

if (seeded > 0) {
	logger.info('Database was empty, initial content loaded', { nodes: seeded });
}

const app = buildServer();

const shutdown = async () => {
	logger.info('Shutting down');

	try {
		await app.close();
		await pool.end();
	} catch (error) {
		logger.error('Shutdown failed', { error: errorMessage(error) });
	}

	logger.on('finish', () => process.exit(0));
	logger.end();
};

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
logger.info('API started', { host: config.host, port: config.port });
