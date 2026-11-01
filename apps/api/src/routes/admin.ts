// Запросы админки. Доступ по cookie сессии после входа по логину и паролю

import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import type { AcceptInviteRequest, AdminUser, ChangePasswordRequest, LoginRequest } from '@rw/core';
import { adminInvites, adminSessions, admins, db } from '@rw/db';

import { requireAdmin, requireRole } from '../auth/guards';
import { findInvite } from '../auth/invites';
import { hashPassword, verifyPassword } from '../auth/password';
import { MIN_PASSWORD_LENGTH } from '../auth/permissions';
import { createSession, deleteOtherSessions, deleteSession, hashToken, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../auth/sessions';
import { config } from '../config';
import { loadContent } from '../content';
import { staffRoutes } from './staff';

const loginBody = {
	type: 'object',
	required: ['login', 'password'],
	properties: {
		login: { type: 'string', minLength: 1, maxLength: 100 },
		password: { type: 'string', minLength: 1, maxLength: 200 },
	},
} as const;

const newPassword = { type: 'string', minLength: MIN_PASSWORD_LENGTH, maxLength: 200 } as const;

const changePasswordBody = {
	type: 'object',
	required: ['currentPassword', 'newPassword'],
	properties: {
		currentPassword: { type: 'string', minLength: 1, maxLength: 200 },
		newPassword,
	},
} as const;

const acceptInviteBody = {
	type: 'object',
	required: ['password'],
	properties: { password: newPassword },
} as const;

const tokenParams = {
	type: 'object',
	required: ['token'],
	properties: { token: { type: 'string', minLength: 1, maxLength: 100 } },
} as const;

const INVALID_INVITE = 'Ссылка недействительна или устарела. Попросите выдать новую';

const signIn = async (reply: FastifyReply, adminId: number) => {
	reply.setCookie(SESSION_COOKIE, await createSession(adminId), {
		path: '/api',
		httpOnly: true,
		sameSite: 'strict',
		secure: config.secureCookies,
		maxAge: SESSION_TTL_SECONDS,
	});
	await db.update(admins).set({ lastLoginAt: sql`now()` }).where(eq(admins.id, adminId));
};

export const adminRoutes: FastifyPluginAsync = async app => {
	app.decorateRequest('admin', null);

	app.post<{ Body: LoginRequest; }>('/auth/login', { schema: { body: loginBody } }, async (request, reply) => {
		const [admin] = await db.select().from(admins).where(eq(admins.login, request.body.login.trim()));

		if (!admin?.passwordHash || !admin.isActive || !await verifyPassword(request.body.password, admin.passwordHash)) {
			return reply.code(401).send({ error: 'Неверный логин или пароль' });
		}

		await signIn(reply, admin.id);

		const user: AdminUser = { id: admin.id, login: admin.login, fullName: admin.fullName, role: admin.role };
		return user;
	});

	app.post('/auth/logout', async (request, reply) => {
		const token = request.cookies[SESSION_COOKIE];

		if (token) {
			await deleteSession(token);
		}

		return reply.clearCookie(SESSION_COOKIE, { path: '/api' }).code(204).send();
	});

	app.post('/auth/logout-all', { preHandler: requireAdmin }, async (request, reply) => {
		await db.delete(adminSessions).where(eq(adminSessions.adminId, request.admin!.id));
		return reply.clearCookie(SESSION_COOKIE, { path: '/api' }).code(204).send();
	});

	app.get('/auth/me', { preHandler: requireAdmin }, async request => request.admin);

	app.post<{ Body: ChangePasswordRequest; }>('/auth/password', { preHandler: requireAdmin, schema: { body: changePasswordBody } }, async (request, reply) => {
		const adminId = request.admin!.id;
		const [admin] = await db.select().from(admins).where(eq(admins.id, adminId));

		if (!admin?.passwordHash || !await verifyPassword(request.body.currentPassword, admin.passwordHash)) {
			return reply.code(400).send({ error: 'Неверный текущий пароль' });
		}

		await db.update(admins).set({ passwordHash: await hashPassword(request.body.newPassword) }).where(eq(admins.id, adminId));
		await deleteOtherSessions(adminId, request.cookies[SESSION_COOKIE]!);

		return reply.code(204).send();
	});

	// Ссылку открывает еще не вошедший сотрудник: доступ дает сам токен
	app.get<{ Params: { token: string; }; }>('/invites/:token', { schema: { params: tokenParams } }, async (request, reply) => {
		const invite = await findInvite(request.params.token);
		return invite ?? reply.code(404).send({ error: INVALID_INVITE });
	});

	app.post<{ Params: { token: string; }; Body: AcceptInviteRequest; }>('/invites/:token', { schema: { params: tokenParams, body: acceptInviteBody } }, async (request, reply) => {
		const passwordHash = await hashPassword(request.body.password);

		const admin = await db.transaction(async tx => {
			// Удаление забирает ссылку атомарно: второй запрос с тем же токеном ничего не найдет
			const [invite] = await tx.delete(adminInvites)
				.where(and(eq(adminInvites.tokenHash, hashToken(request.params.token)), gt(adminInvites.expiresAt, sql`now()`)))
				.returning({ adminId: adminInvites.adminId });

			if (!invite) {
				return null;
			}

			const [row] = await tx.update(admins)
				.set({ passwordHash })
				.where(and(eq(admins.id, invite.adminId), eq(admins.isActive, true)))
				.returning({ id: admins.id, login: admins.login, fullName: admins.fullName, role: admins.role });

			return row ?? null;
		});

		if (!admin) {
			return reply.code(404).send({ error: INVALID_INVITE });
		}

		await signIn(reply, admin.id);

		const user: AdminUser = admin;
		return user;
	});

	app.get('/content', { preHandler: [requireAdmin, requireRole('superadmin', 'admin')] }, async () => {
		const { nodes, settings } = await loadContent();
		return { nodes, settings };
	});

	app.register(staffRoutes);
};
