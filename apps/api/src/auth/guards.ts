import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AdminRole, AdminUser } from '@rw/core';

import { findSessionAdmin, SESSION_COOKIE } from './sessions';

declare module 'fastify' {
	interface FastifyRequest {
		admin: AdminUser | null;
	}
}

// Роль читается из БД на каждый запрос: смена роли, отключение и сброс привязки MAX действуют сразу
const loadAdmin = async (request: FastifyRequest) => {
	const token = request.cookies[SESSION_COOKIE];
	request.admin = token ? await findSessionAdmin(token) : null;
};

// Только для того, что нужно до привязки MAX: кто вошел и сама привязка
export const requireSession = async (request: FastifyRequest, reply: FastifyReply) => {
	await loadAdmin(request);

	if (!request.admin) {
		return reply.code(401).send({ error: 'Требуется вход' });
	}
};

export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
	await loadAdmin(request);

	if (!request.admin) {
		return reply.code(401).send({ error: 'Требуется вход' });
	}

	if (request.admin.maxLinkRequired) {
		return reply.code(403).send({ error: 'Сначала привяжите профиль MAX', code: 'max_link_required' });
	}
};

// Ставится после requireAdmin
export const requireRole = (...roles: AdminRole[]) => async (request: FastifyRequest, reply: FastifyReply) => {
	if (!request.admin || !roles.includes(request.admin.role)) {
		return reply.code(403).send({ error: 'Недостаточно прав' });
	}
};
