import { asc } from 'drizzle-orm';

import { contentNodes, db, settings } from '~/db';
import { logger } from '~/logger';

import { ContentTree } from './tree';
import { DEFAULT_SETTINGS } from './types';
import type { ContentNode, Settings } from './types';

export const loadContentFromDb = async (): Promise<ContentTree> => {
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

	return new ContentTree(nodes, merged);
};

// Контент перечитывается из БД по таймеру, чтобы правки из веб-панели применялись без перезапуска (ТЗ п. 4.3).
// Если БД недоступна, бот продолжает отвечать по последнему загруженному контенту (ТЗ п. 3.10).
export class ContentCache {
	private tree: ContentTree | null = null;
	private timer: NodeJS.Timeout | null = null;
	private refreshing = false;

	async init (refreshSeconds: number): Promise<void> {
		this.tree = await loadContentFromDb();
		logger.info('Content loaded', { nodes: this.tree.all().length });

		this.timer = setInterval(() => void this.refresh(), refreshSeconds * 1000);
		this.timer.unref();
	}

	async refresh (): Promise<void> {
		// Пока БД отвечает медленно, обновления не накапливаются и не забивают пул соединений
		if (this.refreshing) {
			return;
		}

		this.refreshing = true;

		try {
			this.tree = await loadContentFromDb();
		} catch (error) {
			logger.error('Content refresh failed, serving cached content', {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.refreshing = false;
		}
	}

	get (): ContentTree {
		if (!this.tree) {
			throw new Error('Content is not loaded');
		}

		return this.tree;
	}

	stop (): void {
		if (this.timer) {
			clearInterval(this.timer);
		}
	}
}
