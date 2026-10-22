import path from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db } from './client';
import { seedContent } from './seed-content';

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../drizzle');

// API сам готовит БД при запуске: создает таблицы и заливает начальный контент, если его еще нет.
// Возвращает число залитых разделов (0 — контент уже был).
export const setupDatabase = async (): Promise<number> => {
	await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
	return seedContent();
};
