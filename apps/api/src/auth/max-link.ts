// Привязка профиля MAX: админка выдает ссылку на бота с одноразовым кодом, бот сообщает, кто ее открыл

import { and, eq, gt, ne, sql } from 'drizzle-orm';

import type { MaxLinkInfo, MaxLinkStatus, StaffMaxLinkRequest, StaffMaxLinkResult } from '@rw/core';
import { STAFF_LINK_PREFIX } from '@rw/core';
import { adminMaxLinks, admins, db } from '@rw/db';

import { writeAudit } from '../audit';
import { config } from '../config';
import { RuleError } from '../errors';
import { generateToken, hashToken, toAdminUser } from './sessions';

const MAX_LINK_TTL_MS = 15 * 60 * 1000;

// Новый код заменяет прежний. В БД лежит только хеш
export const issueMaxLink = async (adminId: number): Promise<MaxLinkInfo> => {
	if (!config.botUsername) {
		throw new RuleError(503, 'Привязка MAX не настроена');
	}

	const token = generateToken();
	const expiresAt = new Date(Date.now() + MAX_LINK_TTL_MS);
	const values = { tokenHash: hashToken(token), expiresAt };

	await db.insert(adminMaxLinks)
		.values({ adminId, ...values })
		.onConflictDoUpdate({ target: adminMaxLinks.adminId, set: { ...values, createdAt: sql`now()` } });

	return { url: `https://max.ru/${config.botUsername}?start=${STAFF_LINK_PREFIX}${token}`, expiresAt: expiresAt.toISOString() };
};

export const maxLinkStatus = async (adminId: number): Promise<MaxLinkStatus> => {
	const [link] = await db.select({ expiresAt: adminMaxLinks.expiresAt }).from(adminMaxLinks).where(eq(adminMaxLinks.adminId, adminId));

	if (!link) {
		return { status: 'done' };
	}

	return { status: link.expiresAt > new Date() ? 'pending' : 'expired' };
};

export const consumeMaxLink = ({ code, userId }: StaffMaxLinkRequest): Promise<StaffMaxLinkResult> => db.transaction(async tx => {
	// Блокировка строки: второй запрос с тем же кодом дождется конца транзакции и уже ничего не найдет
	const [admin] = await tx
		.select({ id: admins.id, login: admins.login, fullName: admins.fullName, role: admins.role, maxUserId: admins.maxUserId, maxNotify: admins.maxNotify })
		.from(adminMaxLinks)
		.innerJoin(admins, eq(admins.id, adminMaxLinks.adminId))
		.where(and(eq(adminMaxLinks.tokenHash, hashToken(code)), gt(adminMaxLinks.expiresAt, sql`now()`), eq(admins.isActive, true)))
		.for('update');

	if (!admin) {
		return { status: 'invalid' };
	}

	const [other] = await tx.select({ id: admins.id }).from(admins).where(and(eq(admins.maxUserId, userId), ne(admins.id, admin.id)));

	if (other) {
		return { status: 'taken' };
	}

	await tx.update(admins).set({ maxUserId: userId }).where(eq(admins.id, admin.id));
	await tx.delete(adminMaxLinks).where(eq(adminMaxLinks.adminId, admin.id));
	await writeAudit(tx, toAdminUser(admin), 'staff.max_linked', admin.id, { login: admin.login, rebound: admin.maxUserId !== null });

	return { status: 'linked', fullName: admin.fullName };
});
