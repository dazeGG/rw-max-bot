import { createHash } from 'node:crypto';

import { asc } from 'drizzle-orm';

import { DEFAULT_SETTINGS } from '@rw/core';
import type { ContentNode, ContentSnapshot, Settings } from '@rw/core';
import { contentNodes, contentVersions, db, settings } from '@rw/db';
import { errorMessage } from '@rw/runtime';

import { logger } from './logger';

// Весь контент, включая выключенные разделы: дерево для бота собирает ContentTree, админке нужны все.
// version — хеш содержимого: бот перекачивает контент, только если он изменился (ТЗ п. 4.3)
export const loadContent = async (): Promise<ContentSnapshot> => {
	const [rows, settingRows] = await Promise.all([
		db.select().from(contentNodes).orderBy(asc(contentNodes.sort), asc(contentNodes.id)),
		db.select().from(settings),
	]);

	const nodes: ContentNode[] = rows.map(row => ({
		id: row.id,
		parentId: row.parentId,
		code: row.code,
		type: row.type,
		title: row.title,
		text: row.text,
		url: row.url,
		targetId: row.targetId,
		image: row.image,
		file: row.file,
		fileName: row.fileName,
		synonyms: row.synonyms,
		sort: row.sort,
		isActive: row.isActive,
		isHidden: row.isHidden,
	}));

	const merged: Settings = { ...DEFAULT_SETTINGS };

	for (const row of settingRows) {
		if (row.key in merged) {
			merged[row.key as keyof Settings] = row.value;
		}
	}

	const version = createHash('sha256').update(JSON.stringify({ nodes, settings: merged })).digest('hex').slice(0, 16);
	const snapshot = { version, nodes, settings: merged };

	await rememberVersion(snapshot);

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
