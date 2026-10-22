// Запросы админки. Доступ по cookie сессии после входа по логину и паролю

import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import type { AdminUser, LoginRequest } from '@rw/core';
import { admins, db } from '@rw/db';

import { verifyPassword } from '../auth/password';
import { createSession, deleteSession, findSessionAdmin, SESSION_COOKIE, SESSION_TTL_SECONDS } from '../auth/sessions';
import { config } from '../config';
import { loadContent } from '../content';

declare module 'fastify' {
	interface FastifyRequest {
		admin: AdminUser | null;
	}
}

const loginBody = {
	type: 'object',
	required: ['login', 'password'],
	properties: {
		login: { type: 'string', minLength: 1, maxLength: 100 },
		password: { type: 'string', minLength: 1, maxLength: 200 },
	},
} as const;

const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
	const token = request.cookies[SESSION_COOKIE];
	request.admin = token ? await findSessionAdmin(token) : null;

	if (!request.admin) {
		return reply.code(401).send({ error: 'Требуется вход' });
	}
};

export const adminRoutes: FastifyPluginAsync = async app => {
	app.decorateRequest('admin', null);

	app.post<{ Body: LoginRequest; }>('/auth/login', { schema: { body: loginBody } }, async (request, reply) => {
		const [admin] = await db.select().from(admins).where(eq(admins.login, request.body.login.trim()));

		if (!admin || !admin.isActive || !await verifyPassword(request.body.password, admin.passwordHash)) {
			return reply.code(401).send({ error: 'Неверный логин или пароль' });
		}

		const token = await createSession(admin.id);
		await db.update(admins).set({ lastLoginAt: sql`now()` }).where(eq(admins.id, admin.id));

		reply.setCookie(SESSION_COOKIE, token, {
			path: '/api',
			httpOnly: true,
			sameSite: 'strict',
			secure: config.secureCookies,
			maxAge: SESSION_TTL_SECONDS,
		});

		const user: AdminUser = { id: admin.id, login: admin.login, role: admin.role };
		return user;
	});

	app.post('/auth/logout', async (request, reply) => {
		const token = request.cookies[SESSION_COOKIE];

		if (token) {
			await deleteSession(token);
		}

		return reply.clearCookie(SESSION_COOKIE, { path: '/api' }).code(204).send();
	});

	app.get('/auth/me', { preHandler: requireAdmin }, async request => request.admin);

	app.get('/content', { preHandler: requireAdmin }, async () => {
		const { nodes, settings } = await loadContent();
		return { nodes, settings };
	});
};
