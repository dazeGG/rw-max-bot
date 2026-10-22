import '@rw/runtime/env';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL is required');
}

// Таймауты не дают зависшей БД остановить обработку запросов.
// Обработчик pool.on('error') вешает приложение: без него обрыв простаивающего соединения
// (перезапуск PostgreSQL) роняет процесс
export const pool = new pg.Pool({
	connectionString,
	connectionTimeoutMillis: 5_000,
	query_timeout: 10_000,
});

export const db = drizzle(pool, { schema });
