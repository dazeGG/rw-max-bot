// Статистика. Ее видят суперадмин и админ

import type { FastifyPluginAsync } from 'fastify';

import type { StatsPeriod } from '@rw/core';

import { requireAdmin, requireRole } from '../auth/guards';
import { loadStats } from '../stats';

const statsQuery = {
	type: 'object',
	required: ['days'],
	properties: { days: { type: 'integer', enum: [7, 30, 90] } },
} as const;

export const statsRoutes: FastifyPluginAsync = async app => {
	app.addHook('preHandler', requireAdmin);
	app.addHook('preHandler', requireRole('superadmin', 'admin'));

	app.get<{ Querystring: { days: StatsPeriod; }; }>('/', { schema: { querystring: statsQuery } }, request => loadStats(request.query.days));
};
