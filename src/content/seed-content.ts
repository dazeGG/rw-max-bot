import { sql } from 'drizzle-orm';

import { contentNodes, db, sessions, settings } from '~/db';

import { flattenSeed, SEED_SETTINGS } from './seed-data';

// Заливает начальный контент из seed-data.ts. В непустую БД без force ничего не пишет,
// чтобы не затереть правки из веб-панели. Возвращает число залитых разделов (0 — контент уже был).
export const seedContent = async ({ force = false } = {}): Promise<number> => {
	const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(contentNodes);

	if (count > 0 && !force) {
		return 0;
	}

	const nodes = flattenSeed();

	await db.transaction(async tx => {
		await tx.execute(sql`TRUNCATE content_nodes RESTART IDENTITY CASCADE`);
		await tx.delete(settings);
		// id разделов меняются: старые сессии указывали бы не туда
		await tx.delete(sessions);

		// Сначала без target_id: цели goto могут идти позже по порядку
		await tx.insert(contentNodes).values(nodes.map(node => ({ ...node, targetId: null })));

		for (const node of nodes.filter(n => n.targetId !== null)) {
			await tx.update(contentNodes).set({ targetId: node.targetId }).where(sql`${contentNodes.id} = ${node.id}`);
		}

		await tx.execute(sql`SELECT setval(pg_get_serial_sequence('content_nodes', 'id'), (SELECT max(id) FROM content_nodes))`);
		await tx.insert(settings).values(Object.entries(SEED_SETTINGS).map(([key, value]) => ({ key, value })));
	});

	return nodes.length;
};
