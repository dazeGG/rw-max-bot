// Заливает начальный контент в пустую БД. Повторный запуск без --force ничего не меняет,
// чтобы не затереть правки из веб-панели.

import { sql } from 'drizzle-orm';

import { contentNodes, db, pool, sessions, settings } from '~/db';

import { flattenSeed, SEED_SETTINGS } from './seed-data';

const force = process.argv.includes('--force');

const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(contentNodes);

if (count > 0 && !force) {
	console.log(`Content already exists (${count} nodes). Use --force to replace it.`);
	await pool.end();
	process.exit(0);
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

console.log(`Seeded ${nodes.length} content nodes`);
await pool.end();
