import type pg from 'pg';

import { pool } from '.';

// Произвольная константа: номер блокировки бота в PostgreSQL
const LOCK_ID = 20_261_011;

// Два запущенных бота забирают одни и те же сообщения из MAX и отвечают дважды.
// Блокировка держится на отдельном соединении все время работы процесса и снимается при его завершении.
export const acquireInstanceLock = async (): Promise<pg.PoolClient | null> => {
	const client = await pool.connect();
	const { rows } = await client.query<{ locked: boolean; }>('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_ID]);

	if (!rows[0]?.locked) {
		client.release();
		return null;
	}

	return client;
};
