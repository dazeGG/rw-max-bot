import 'dotenv/config';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { logger } from '~/logger';

import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL is required');
}

// Таймауты не дают зависшей БД остановить обработку сообщений: бот ответит из кеша
export const pool = new pg.Pool({
	connectionString,
	connectionTimeoutMillis: 5_000,
	query_timeout: 10_000,
});

// Без обработчика обрыв простаивающего соединения (перезапуск PostgreSQL) роняет процесс
pool.on('error', error => {
	logger.error('PostgreSQL pool error', { error: error.message });
});

export const db = drizzle(pool, { schema });

export * from './schema';
