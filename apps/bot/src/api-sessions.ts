import { MemorySessionStore } from '@rw/core';
import type { Session, SessionStore } from '@rw/core';
import { errorMessage } from '@rw/runtime';

import type { ApiClient } from './api-client';
import { logger } from './logger';

// Сессии хранятся через API. Если он недоступен, бот продолжает диалог по сессиям в памяти (ТЗ п. 3.10)
export class ApiSessionStore implements SessionStore {
	private readonly fallback = new MemorySessionStore();

	constructor (private readonly api: ApiClient) {}

	async get (userId: number): Promise<Session> {
		try {
			return await this.api.getSession(userId);
		} catch (error) {
			logger.error('Session read failed, using memory', { userId, error: errorMessage(error) });
			return this.fallback.get(userId);
		}
	}

	async set (userId: number, session: Session): Promise<void> {
		await this.fallback.set(userId, session);

		try {
			await this.api.setSession(userId, session);
		} catch (error) {
			logger.error('Session write failed', { userId, error: errorMessage(error) });
		}
	}
}
