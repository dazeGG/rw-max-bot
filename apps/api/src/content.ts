import { createHash } from 'node:crypto';

import { asc } from 'drizzle-orm';

import { DEFAULT_SETTINGS } from '@rw/core';
import type { AdminContentNode, ContentResponse, ContentSnapshot, Settings } from '@rw/core';
import { admins, contentNodes, contentVersions, db, settings } from '@rw/db';
import { errorMessage } from '@rw/runtime';

import type { Tx } from './audit';
import { toContentNode } from './content-rules';
import { logger } from './logger';

// Для админки: updatedAt — версия полей формы, с ней сравнивается сохранение (кто-то мог изменить раздел раньше)
export const toAdminNode = (row: typeof contentNodes.$inferSelect): AdminContentNode => ({
	...toContentNode(row),
	updatedAt: row.updatedAt.toISOString(),
	updatedBy: row.updatedBy,
});

type Reader = Pick<typeof db, 'select'>;

export const loadSettings = async (reader: Reader = db): Promise<Settings> => {
	const merged: Settings = { ...DEFAULT_SETTINGS };

	for (const row of await reader.select().from(settings)) {
		if (row.key in merged) {
			merged[row.key as keyof Settings] = row.value;
		}
	}

	return merged;
};

const selectNodes = (reader: Reader = db) => reader.select().from(contentNodes).orderBy(asc(contentNodes.sort), asc(contentNodes.id));

export const loadAdminContent = async (): Promise<ContentResponse> => {
	const [rows, merged, staff] = await Promise.all([
		selectNodes(),
		loadSettings(),
		db.select({ login: admins.login, fullName: admins.fullName }).from(admins),
	]);
	const names = new Map(staff.map(({ login, fullName }) => [login, fullName]));

	// В базе хранится логин, а в шапке раздела показывается ФИО
	return {
		nodes: rows.map(row => ({ ...toAdminNode(row), updatedBy: row.updatedBy && (names.get(row.updatedBy) ?? row.updatedBy) })),
		settings: merged,
	};
};

// version — хеш содержимого: бот перекачивает контент, только если он изменился (ТЗ п. 4.3).
// Запросы по очереди: в транзакции они идут через одно соединение
const buildSnapshot = async (reader: Reader = db): Promise<ContentSnapshot> => {
	const rows = await selectNodes(reader);
	const merged = await loadSettings(reader);
	const nodes = rows.map(toContentNode);
	const version = createHash('sha256').update(JSON.stringify({ nodes, settings: merged })).digest('hex').slice(0, 16);

	return { version, nodes, settings: merged };
};

// Весь контент, включая выключенные разделы: дерево для бота собирает ContentTree, админке нужны все
export const loadContent = async (): Promise<ContentSnapshot> => {
	const snapshot = await buildSnapshot();

	await rememberVersion(snapshot);

	return snapshot;
};

// В той же транзакции, что и правка: если она откатится, снимка не останется
export const storeSnapshot = async (tx: Tx): Promise<ContentSnapshot> => {
	const snapshot = await buildSnapshot(tx);

	await tx.insert(contentVersions)
		.values({ version: snapshot.version, nodes: snapshot.nodes, settings: snapshot.settings })
		.onConflictDoNothing();

	return snapshot;
};

let rememberedVersion: string | null = null;

// Снимок версии контента для статистики: события ссылаются на нее, и видно меню, которое видел пользователь,
// даже если раздел потом изменили или удалили. Ошибка записи не мешает отдавать контент
const rememberVersion = async (snapshot: ContentSnapshot): Promise<void> => {
	if (snapshot.version === rememberedVersion) {
		return;
	}

	try {
		await db.insert(contentVersions)
			.values({ version: snapshot.version, nodes: snapshot.nodes, settings: snapshot.settings })
			.onConflictDoNothing();
		rememberedVersion = snapshot.version;
	} catch (error) {
		logger.error('Content version snapshot failed', { version: snapshot.version, error: errorMessage(error) });
	}
};
