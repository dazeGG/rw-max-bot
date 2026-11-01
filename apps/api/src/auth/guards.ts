import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AdminRole, AdminUser } from '@rw/core';

import { findSessionAdmin, SESSION_COOKIE } from './sessions';

declare module 'fastify' {
	interface FastifyRequest {
		admin: AdminUser | null;
	}
}

// Роль читается из БД на каждый запрос: смена роли и отключение действуют сразу
export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
	const token = request.cookies[SESSION_COOKIE];
	request.admin = token ? await findSessionAdmin(token) : null;

	if (!request.admin) {
		return reply.code(401).send({ error: 'Требуется вход' });
	}
};

// Ставится после requireAdmin
export const requireRole = (...roles: AdminRole[]) => async (request: FastifyRequest, reply: FastifyReply) => {
	if (!request.admin || !roles.includes(request.admin.role)) {
		return reply.code(403).send({ error: 'Недостаточно прав' });
	}
};
