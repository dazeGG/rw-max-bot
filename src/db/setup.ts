import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { seedContent } from '~/content/seed-content';

import { db } from '.';

// Бот сам готовит БД при запуске: создает таблицы и заливает начальный контент, если его еще нет.
// Возвращает число залитых разделов (0 — контент уже был).
export const setupDatabase = async (): Promise<number> => {
	await migrate(db, { migrationsFolder: './drizzle' });
	return seedContent();
};
