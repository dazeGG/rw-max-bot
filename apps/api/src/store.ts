import { sql } from 'drizzle-orm';

import type { DialogEventRecord, DialogUser, Session, UnrecognizedEvent } from '@rw/core';
import { db, dialogEvents, sessions, subscribers, unrecognizedMessages } from '@rw/db';

// Данные диалогов, которые бот сохраняет через /internal/*

export const getSession = async (userId: number): Promise<Session> => {
	const [row] = await db.select().from(sessions).where(sql`${sessions.userId} = ${userId}`);
	return { nodeId: row?.nodeId ?? null, choices: row?.choices ?? [], misses: row?.misses ?? 0, updatedAt: row?.updatedAt.toISOString() };
};

export const setSession = async (userId: number, session: Session): Promise<void> => {
	const values = { nodeId: session.nodeId, choices: session.choices ?? [], misses: session.misses ?? 0 };

	await db.insert(sessions)
		.values({ userId, ...values })
		.onConflictDoUpdate({ target: sessions.userId, set: { ...values, updatedAt: sql`now()` } });
};

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

export const saveDialogEvent = async (event: DialogEventRecord): Promise<void> => {
	await db.insert(dialogEvents).values({ ...event, createdAt: new Date(event.createdAt) });
};
