import { setTimeout as sleep } from 'node:timers/promises';

import { ContentTree } from '@rw/core';
import { errorMessage } from '@rw/runtime';

import type { ApiClient } from './api-client';
import { logger } from './logger';

const INIT_RETRY_MS = 5_000;

// Контент перечитывается из API по таймеру, чтобы правки из админки применялись без перезапуска (ТЗ п. 4.3).
// Если API или БД недоступны, бот продолжает отвечать по последнему загруженному контенту (ТЗ п. 3.10).
export class ContentCache {
	private tree: ContentTree | null = null;
	private version: string | undefined;
	private timer: NodeJS.Timeout | null = null;
	private refreshing = false;

	constructor (private readonly api: ApiClient) {}

	// Без контента отвечать нечем: при старте ждем, пока API станет доступен
	async init (refreshSeconds: number): Promise<void> {
		for (;;) {
			try {
				await this.load();
				break;
			} catch (error) {
				logger.warn('Content is not available yet, retrying', { error: errorMessage(error) });
				await sleep(INIT_RETRY_MS);
			}
		}

		logger.info('Content loaded', { nodes: this.get().all().length, version: this.version });

		this.timer = setInterval(() => void this.refresh(), refreshSeconds * 1000);
		this.timer.unref();
	}

	private async load (): Promise<void> {
		const snapshot = await this.api.getContent(this.tree ? this.version : undefined);

		if (snapshot) {
			this.tree = new ContentTree(snapshot.nodes, snapshot.settings);
			this.version = snapshot.version;
		}
	}

	async refresh (): Promise<void> {
		// Пока API отвечает медленно, обновления не накапливаются
		if (this.refreshing) {
			return;
		}

		this.refreshing = true;

		try {
			await this.load();
		} catch (error) {
			logger.error('Content refresh failed, serving cached content', { error: errorMessage(error) });
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
