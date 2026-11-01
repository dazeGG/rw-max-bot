// Экран «Сотрудники» и журнал действий. Суперадмин управляет всеми, админ — только поддержкой

import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { AdminRole, AdminUser, AuditEntry, CreateStaffRequest, StaffInvite, StaffMember, UpdateStaffRequest } from '@rw/core';
import { adminInvites, adminSessions, admins, auditLog, db } from '@rw/db';

import { writeAudit } from '../audit';
import type { Tx } from '../audit';
import { requireAdmin, requireRole } from '../auth/guards';
import { issueInvite } from '../auth/invites';
import { canManageRole, STAFF_ROLES } from '../auth/permissions';
import { RuleError } from '../errors';

const AUDIT_LIMIT = 200;

const idParams = {
	type: 'object',
	required: ['id'],
	properties: { id: { type: 'integer' } },
} as const;

const fullName = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } as const;
const role = { type: 'string', enum: STAFF_ROLES } as const;

const createBody = {
	type: 'object',
	required: ['login', 'fullName', 'role'],
	properties: {
		// Без пробелов: логин вводят вручную при входе
		login: { type: 'string', minLength: 1, maxLength: 100, pattern: '^\\S+$' },
		fullName,
		role,
	},
} as const;

const updateBody = {
	type: 'object',
	minProperties: 1,
	properties: { fullName, role },
} as const;

const actorOf = (request: FastifyRequest): AdminUser => request.admin!;

// Чужого уровня для админа как будто нет: он не видит и админов, и суперадминов
const getManagedTarget = async (tx: Tx, actor: AdminUser, id: number) => {
	const [target] = await tx.select().from(admins).where(eq(admins.id, id));

	if (!target || !canManageRole(actor.role, target.role)) {
		throw new RuleError(404, 'Сотрудник не найден');
	}

	return target;
};

// Блокировка строк не даст двум суперадминам одновременно отключить друг друга
const assertNotLastSuperadmin = async (tx: Tx, target: { role: AdminRole; isActive: boolean; }) => {
	if (target.role !== 'superadmin' || !target.isActive) {
		return;
	}

	const rows = await tx.select({ id: admins.id })
		.from(admins)
		.where(and(eq(admins.role, 'superadmin'), eq(admins.isActive, true)))
		.for('update');

	if (rows.length <= 1) {
		throw new RuleError(409, 'Нельзя оставить систему без суперадмина');
	}
};

const assertNotSelf = (actor: AdminUser, targetId: number, message: string) => {
	if (actor.id === targetId) {
		throw new RuleError(409, message);
	}
};

const audit = (tx: Tx, actor: AdminUser, action: string, target: { id: number; login: string; }, details: Record<string, unknown> = {}) =>
	writeAudit(tx, actor, action, target.id, { login: target.login, ...details });

const endSessions = (tx: Tx, adminId: number) => tx.delete(adminSessions).where(eq(adminSessions.adminId, adminId));

export const staffRoutes: FastifyPluginAsync = async app => {
	app.addHook('preHandler', requireAdmin);

	const managers = requireRole('superadmin', 'admin');

	app.get('/staff', { preHandler: managers }, async (request): Promise<StaffMember[]> => {
		const rows = await db
			.select({
				id: admins.id,
				login: admins.login,
				fullName: admins.fullName,
				role: admins.role,
				isActive: admins.isActive,
				hasPassword: sql<boolean>`${admins.passwordHash} is not null`,
				lastLoginAt: admins.lastLoginAt,
				inviteExpiresAt: adminInvites.expiresAt,
			})
			.from(admins)
			.leftJoin(adminInvites, eq(adminInvites.adminId, admins.id))
			.where(actorOf(request).role === 'superadmin' ? undefined : eq(admins.role, 'support'))
			.orderBy(admins.fullName);

		return rows.map(row => ({
			...row,
			lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
			inviteExpiresAt: row.inviteExpiresAt?.toISOString() ?? null,
		}));
	});

	app.post<{ Body: CreateStaffRequest; }>('/staff', { preHandler: managers, schema: { body: createBody } }, async (request): Promise<StaffInvite> => {
		const actor = actorOf(request);
		const { login, role: newRole } = request.body;

		if (!canManageRole(actor.role, newRole)) {
			throw new RuleError(403, 'Недостаточно прав');
		}

		return db.transaction(async tx => {
			const [created] = await tx.insert(admins)
				.values({ login, fullName: request.body.fullName.trim(), role: newRole })
				.onConflictDoNothing({ target: admins.login })
				.returning();

			if (!created) {
				throw new RuleError(409, 'Сотрудник с таким логином уже есть');
			}

			await audit(tx, actor, 'staff.create', created, { fullName: created.fullName, role: created.role });
			return issueInvite(tx, created.id);
		});
	});

	app.patch<{ Params: { id: number; }; Body: UpdateStaffRequest; }>('/staff/:id', { preHandler: managers, schema: { params: idParams, body: updateBody } }, async (request, reply) => {
		const actor = actorOf(request);

		await db.transaction(async tx => {
			const target = await getManagedTarget(tx, actor, request.params.id);
			const newRole = request.body.role ?? target.role;
			const newName = request.body.fullName?.trim() ?? target.fullName;

			if (newRole === target.role && newName === target.fullName) {
				return;
			}

			if (newRole !== target.role) {
				assertNotSelf(actor, target.id, 'Нельзя сменить роль самому себе');

				if (!canManageRole(actor.role, newRole)) {
					throw new RuleError(403, 'Недостаточно прав');
				}

				await assertNotLastSuperadmin(tx, target);
			}

			await tx.update(admins).set({ role: newRole, fullName: newName }).where(eq(admins.id, target.id));
			await audit(tx, actor, 'staff.update', target, {
				...newRole !== target.role && { fromRole: target.role, toRole: newRole },
				...newName !== target.fullName && { fromName: target.fullName, toName: newName },
			});
		});

		return reply.code(204).send();
	});

	// Новая ссылка: и для тех, кто не успел задать пароль, и для сброса забытого
	app.post<{ Params: { id: number; }; }>('/staff/:id/invite', { preHandler: managers, schema: { params: idParams } }, async (request): Promise<StaffInvite> => {
		const actor = actorOf(request);

		return db.transaction(async tx => {
			const target = await getManagedTarget(tx, actor, request.params.id);

			assertNotSelf(actor, target.id, 'Свой пароль можно сменить в профиле');

			if (!target.isActive) {
				throw new RuleError(409, 'Сначала включите сотрудника');
			}

			await tx.update(admins).set({ passwordHash: null }).where(eq(admins.id, target.id));
			await endSessions(tx, target.id);
			await audit(tx, actor, 'staff.reset_password', target);

			return issueInvite(tx, target.id);
		});
	});

	app.post<{ Params: { id: number; }; }>('/staff/:id/disable', { preHandler: managers, schema: { params: idParams } }, async (request, reply) => {
		const actor = actorOf(request);

		await db.transaction(async tx => {
			const target = await getManagedTarget(tx, actor, request.params.id);

			assertNotSelf(actor, target.id, 'Нельзя отключить самого себя');
			await assertNotLastSuperadmin(tx, target);

			await tx.update(admins).set({ isActive: false }).where(eq(admins.id, target.id));
			await endSessions(tx, target.id);
			await tx.delete(adminInvites).where(eq(adminInvites.adminId, target.id));
			await audit(tx, actor, 'staff.disable', target);
		});

		return reply.code(204).send();
	});

	app.post<{ Params: { id: number; }; }>('/staff/:id/enable', { preHandler: managers, schema: { params: idParams } }, async (request, reply) => {
		const actor = actorOf(request);

		await db.transaction(async tx => {
			const target = await getManagedTarget(tx, actor, request.params.id);

			await tx.update(admins).set({ isActive: true }).where(eq(admins.id, target.id));
			await audit(tx, actor, 'staff.enable', target);
		});

		return reply.code(204).send();
	});

	app.get('/audit-log', { preHandler: requireRole('superadmin') }, async (): Promise<AuditEntry[]> => {
		const rows = await db
			.select({
				id: auditLog.id,
				actorName: admins.fullName,
				action: auditLog.action,
				details: auditLog.details,
				createdAt: auditLog.createdAt,
			})
			.from(auditLog)
			.innerJoin(admins, eq(admins.id, auditLog.actorId))
			.orderBy(desc(auditLog.id))
			.limit(AUDIT_LIMIT);

		return rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
	});
};
