import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';

import type { AdminUser } from '@rw/core';
import { adminSessions, admins, db } from '@rw/db';

import { requiresMaxLink } from './permissions';

export const SESSION_COOKIE = 'rw_admin_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export const generateToken = () => randomBytes(32).toString('base64url');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const createSession = async (adminId: number): Promise<string> => {
	const token = generateToken();

	// Заодно чистим истекшие сессии этого пользователя
	await db.delete(adminSessions).where(and(eq(adminSessions.adminId, adminId), lt(adminSessions.expiresAt, sql`now()`)));
	await db.insert(adminSessions).values({
		tokenHash: hashToken(token),
		adminId,
		expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
	});

	return token;
};

export const toAdminUser = ({ id, login, fullName, role, maxUserId, maxNotify }: Pick<AdminUser, 'id' | 'login' | 'fullName' | 'role' | 'maxNotify'> & { maxUserId: number | null; }): AdminUser => {
	const maxLinked = maxUserId !== null;
	return { id, login, fullName, role, maxLinked, maxNotify, maxLinkRequired: requiresMaxLink(role, maxLinked) };
};

export const findSessionAdmin = async (token: string): Promise<AdminUser | null> => {
	const [row] = await db
		.select({ id: admins.id, login: admins.login, fullName: admins.fullName, role: admins.role, maxUserId: admins.maxUserId, maxNotify: admins.maxNotify })
		.from(adminSessions)
		.innerJoin(admins, eq(admins.id, adminSessions.adminId))
		.where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, sql`now()`), eq(admins.isActive, true)));

	return row ? toAdminUser(row) : null;
};

export const deleteSession = async (token: string): Promise<void> => {
	await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
};

export const deleteOtherSessions = async (adminId: number, keepToken: string): Promise<void> => {
	await db.delete(adminSessions).where(and(eq(adminSessions.adminId, adminId), ne(adminSessions.tokenHash, hashToken(keepToken))));
};
