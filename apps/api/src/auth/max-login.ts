// Вход через MAX: страница входа показывает ссылку на бота, сотрудник подтверждает вход кнопкой, браузер узнает об этом опросом

import { and, count, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';

import type { MaxLoginInfo, MaxLoginPoll, StaffLoginAnswerRequest, StaffLoginAnswerResult, StaffLoginOpenRequest, StaffLoginOpenResult } from '@rw/core';
import { STAFF_LOGIN_PREFIX } from '@rw/core';
import { adminMaxLogins, admins, db } from '@rw/db';

import { config } from '../config';
import { RuleError } from '../errors';
import { generateToken, hashToken, toAdminUser } from './sessions';

const MAX_LOGIN_TTL_MS = 5 * 60 * 1000;
// Подтверждение в последнюю секунду не должно сгореть, пока браузер не успел спросить статус
const APPROVED_TTL_MS = 60 * 1000;
// Страница входа открыта без авторизации: запросы не должны копиться в БД без предела
const MAX_ACTIVE_LOGINS = 1000;

const liveLogin = (codeHash: string) => and(eq(adminMaxLogins.codeHash, codeHash), eq(adminMaxLogins.status, 'pending'), gt(adminMaxLogins.expiresAt, sql`now()`));

const staffByMax = (userId: number) => and(eq(admins.maxUserId, userId), eq(admins.isActive, true));

export const issueMaxLogin = async (): Promise<MaxLoginInfo> => {
	if (!config.botUsername) {
		throw new RuleError(503, 'Вход через MAX не настроен');
	}

	await db.delete(adminMaxLogins).where(lte(adminMaxLogins.expiresAt, sql`now()`));

	const [{ active }] = await db.select({ active: count() }).from(adminMaxLogins);

	if (active >= MAX_ACTIVE_LOGINS) {
		throw new RuleError(429, 'Слишком много попыток входа. Подождите несколько минут или войдите по паролю');
	}

	const code = generateToken();
	const token = generateToken();
	const expiresAt = new Date(Date.now() + MAX_LOGIN_TTL_MS);

	await db.insert(adminMaxLogins).values({ codeHash: hashToken(code), pollHash: hashToken(token), expiresAt });

	return { url: `https://max.ru/${config.botUsername}?start=${STAFF_LOGIN_PREFIX}${code}`, token, expiresAt: expiresAt.toISOString() };
};

export const openStaffLogin = async ({ code, userId }: StaffLoginOpenRequest): Promise<StaffLoginOpenResult> => {
	const [login] = await db.select({ status: adminMaxLogins.status }).from(adminMaxLogins).where(liveLogin(hashToken(code)));

	if (!login) {
		return { status: 'invalid' };
	}

	const [admin] = await db.select({ fullName: admins.fullName }).from(admins).where(staffByMax(userId));

	return admin ? { status: 'ask', fullName: admin.fullName } : { status: 'unknown' };
};

export const answerStaffLogin = ({ code, userId, approve }: StaffLoginAnswerRequest): Promise<StaffLoginAnswerResult> => db.transaction(async tx => {
	const codeHash = hashToken(code);
	// Блокировка строки: второе нажатие дождется конца транзакции и уже не найдет ожидающий запрос
	const [login] = await tx.select({ codeHash: adminMaxLogins.codeHash }).from(adminMaxLogins).where(liveLogin(codeHash)).for('update');

	if (!login) {
		return { status: 'invalid' };
	}

	const [admin] = await tx.select({ id: admins.id }).from(admins).where(staffByMax(userId));

	if (!admin) {
		return { status: 'unknown' };
	}

	await tx.update(adminMaxLogins)
		.set(approve ? { status: 'approved', adminId: admin.id, expiresAt: new Date(Date.now() + APPROVED_TTL_MS) } : { status: 'rejected' })
		.where(eq(adminMaxLogins.codeHash, codeHash));

	return { status: approve ? 'approved' : 'rejected' };
});

export const pollMaxLogin = async (token: string): Promise<MaxLoginPoll> => {
	const pollHash = hashToken(token);
	const [login] = await db.select({ status: adminMaxLogins.status }).from(adminMaxLogins)
		.where(and(eq(adminMaxLogins.pollHash, pollHash), gt(adminMaxLogins.expiresAt, sql`now()`)));

	if (!login) {
		return { status: 'expired' };
	}

	if (login.status !== 'approved') {
		return { status: login.status };
	}

	// Удаление и есть использование: сессию получит только один запрос
	const [used] = await db.delete(adminMaxLogins)
		.where(and(eq(adminMaxLogins.pollHash, pollHash), eq(adminMaxLogins.status, 'approved')))
		.returning({ adminId: adminMaxLogins.adminId });

	if (!used?.adminId) {
		return { status: 'expired' };
	}

	// За время после подтверждения сотрудника могли отключить или сбросить привязку
	const [admin] = await db
		.select({ id: admins.id, login: admins.login, fullName: admins.fullName, role: admins.role, maxUserId: admins.maxUserId, maxNotify: admins.maxNotify })
		.from(admins)
		.where(and(eq(admins.id, used.adminId), eq(admins.isActive, true), isNotNull(admins.maxUserId)));

	return admin ? { status: 'done', user: toAdminUser(admin) } : { status: 'expired' };
};
