import { and, eq, gt, sql } from 'drizzle-orm';

import type { InviteInfo, StaffInvite } from '@rw/core';
import { adminInvites, admins, db } from '@rw/db';

import { generateToken, hashToken } from './sessions';

const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Новая ссылка заменяет прежнюю. В БД лежит только хеш: сама ссылка показывается один раз тому, кто ее выдал
export const issueInvite = async (tx: Tx, adminId: number): Promise<StaffInvite> => {
	const token = generateToken();
	const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
	const values = { tokenHash: hashToken(token), expiresAt };

	await tx.insert(adminInvites)
		.values({ adminId, ...values })
		.onConflictDoUpdate({ target: adminInvites.adminId, set: { ...values, createdAt: sql`now()` } });

	return { token, expiresAt: expiresAt.toISOString() };
};

export const findInvite = async (token: string): Promise<InviteInfo | null> => {
	const [row] = await db
		.select({ login: admins.login, fullName: admins.fullName })
		.from(adminInvites)
		.innerJoin(admins, eq(admins.id, adminInvites.adminId))
		.where(and(eq(adminInvites.tokenHash, hashToken(token)), gt(adminInvites.expiresAt, sql`now()`), eq(admins.isActive, true)));

	return row ?? null;
};
