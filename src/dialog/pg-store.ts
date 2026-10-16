import { sql } from 'drizzle-orm';

import { db, sessions, subscribers, unrecognizedMessages } from '~/db';
import { logger } from '~/logger';

import { MemorySessionStore } from './memory-sessions';
import type { DialogUser, Session, SessionStore, UnrecognizedEvent } from './types';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

// Сессии в PostgreSQL. Если БД недоступна, бот продолжает диалог по сессиям в памяти (ТЗ п. 3.10)
export class PgSessionStore implements SessionStore {
	private readonly fallback = new MemorySessionStore();

	async get (userId: number): Promise<Session> {
		try {
			const [row] = await db.select().from(sessions).where(sql`${sessions.userId} = ${userId}`);
			return { nodeId: row?.nodeId ?? null, choices: row?.choices ?? [] };
		} catch (error) {
			logger.error('Session read failed, using memory', { userId, error: errorMessage(error) });
			return this.fallback.get(userId);
		}
	}

	async set (userId: number, session: Session): Promise<void> {
		await this.fallback.set(userId, session);

		const values = { nodeId: session.nodeId, choices: session.choices ?? [] };

		try {
			await db.insert(sessions)
				.values({ userId, ...values })
				.onConflictDoUpdate({ target: sessions.userId, set: { ...values, updatedAt: sql`now()` } });
		} catch (error) {
			logger.error('Session write failed', { userId, error: errorMessage(error) });
		}
	}
}

export const touchSubscriber = async (user: DialogUser): Promise<void> => {
	await db.insert(subscribers)
		.values({
			userId: user.id,
			firstName: user.firstName ?? null,
			lastName: user.lastName ?? null,
			username: user.username ?? null,
		})
		.onConflictDoUpdate({
			target: subscribers.userId,
			set: {
				firstName: user.firstName ?? null,
				lastName: user.lastName ?? null,
				username: user.username ?? null,
				lastSeenAt: sql`now()`,
				isBlocked: false,
			},
		});
};

export const markSubscriberBlocked = async (userId: number): Promise<void> => {
	await db.update(subscribers).set({ isBlocked: true }).where(sql`${subscribers.userId} = ${userId}`);
};

export const saveUnrecognized = async (event: UnrecognizedEvent): Promise<void> => {
	await db.insert(unrecognizedMessages).values(event);
};
