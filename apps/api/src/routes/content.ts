// Редактор дерева. Контент правят суперадмин и админ; поддержке он недоступен

import { randomBytes } from 'node:crypto';

import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { DEFAULT_SETTINGS, ROOT_CODE } from '@rw/core';
import type { AdminContentNode, AdminUser, ContentApplied, CreateNodeRequest, MoveNodeRequest, UpdateNodeRequest } from '@rw/core';
import { contentNodes, db, settings } from '@rw/db';
import { errorMessage } from '@rw/runtime';

import { writeAudit } from '../audit';
import type { Tx } from '../audit';
import { requireAdmin, requireRole } from '../auth/guards';
import { config } from '../config';
import { loadAdminContent, toAdminNode } from '../content';
import { notifyBotContentChanged } from '../content-notifier';
import { linkUrlError, messageError, moveError, normalizeSynonyms, parentError, subtreeIds, targetError } from '../content-rules';
import { RuleError } from '../errors';
import { logger } from '../logger';

const SORT_STEP = 10;
// Ключ блокировки структуры дерева, значение произвольное
const TREE_LOCK = 7_204_001;

const idParams = {
	type: 'object',
	required: ['id'],
	properties: { id: { type: 'integer' } },
} as const;

const title = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' } as const;
const url = { type: ['string', 'null'], maxLength: 2000 } as const;

const createBody = {
	type: 'object',
	required: ['parentId', 'type', 'title'],
	properties: {
		parentId: { type: 'integer' },
		type: { type: 'string', enum: ['section', 'link', 'goto'] },
		title,
		url,
		targetId: { type: 'integer' },
	},
} as const;

const updateBody = {
	type: 'object',
	required: ['updatedAt'],
	properties: {
		updatedAt: { type: 'string' },
		title,
		text: { type: ['string', 'null'] },
		url,
		targetId: { type: ['integer', 'null'] },
		synonyms: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 300 } },
		imageText: { type: ['string', 'null'], maxLength: 10_000 },
		isActive: { type: 'boolean' },
		isHidden: { type: 'boolean' },
	},
} as const;

const moveBody = {
	type: 'object',
	required: ['parentId', 'index'],
	properties: {
		parentId: { type: 'integer' },
		index: { type: 'integer', minimum: 0 },
	},
} as const;

const assertRule = (error: string | null) => {
	if (error) {
		throw new RuleError(400, error);
	}
};

const allNodes = (tx: Tx) => tx.select().from(contentNodes);

const lockNode = async (tx: Tx, id: number) => {
	const [row] = await tx.select().from(contentNodes).where(eq(contentNodes.id, id)).for('update');

	if (!row) {
		throw new RuleError(404, 'Раздел не найден. Обновите страницу');
	}

	return row;
};

// Пустая строка из формы означает «нет значения»: у раздела без текста бот покажет название
const emptyToNull = (value: string | null | undefined) => value?.trim() ? value : null;

const fieldChanged = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

const handoffCode = async (tx: Tx) => {
	const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.key, 'search.handoff'));
	return (row?.value ?? DEFAULT_SETTINGS['search.handoff']).trim();
};

export const contentRoutes: FastifyPluginAsync = async app => {
	app.addHook('preHandler', requireAdmin);
	app.addHook('preHandler', requireRole('superadmin', 'admin'));

	const actorOf = (request: FastifyRequest): AdminUser => request.admin!;

	app.get('/', loadAdminContent);

	// Отдельно от сохранения: бот перестраивает индекс поиска несколько секунд, форма столько ждать не должна.
	// Если бот не ответил, правка уже в БД и применится при резервной проверке
	app.post('/apply', async (_request, reply): Promise<ContentApplied> => {
		try {
			const { version } = await notifyBotContentChanged(config.botControlUrl, config.internalToken);
			return { version };
		} catch (error) {
			logger.warn('Bot did not confirm content refresh', { error: errorMessage(error) });
			return reply.code(503).send({ error: 'Бот не подтвердил обновление' });
		}
	});

	app.post<{ Body: CreateNodeRequest; }>('/nodes', { schema: { body: createBody } }, async (request): Promise<AdminContentNode> => {
		const { parentId, type, url: nodeUrl, targetId } = request.body;
		const actor = actorOf(request);

		return db.transaction(async tx => {
			const nodes = await allNodes(tx);

			assertRule(parentError(nodes, parentId));
			assertRule(type === 'link' ? linkUrlError(nodeUrl) : null);
			assertRule(type === 'goto' ? targetError(nodes, null, targetId) : null);

			const siblings = nodes.filter(node => node.parentId === parentId);

			// Новый пункт выключен: его можно спокойно заполнить, и только потом его увидят пассажиры
			const [created] = await tx.insert(contentNodes).values({
				parentId,
				code: `node-${randomBytes(4).toString('hex')}`,
				type,
				title: request.body.title.trim(),
				url: type === 'link' ? nodeUrl : null,
				targetId: type === 'goto' ? targetId : null,
				sort: Math.max(0, ...siblings.map(node => node.sort)) + SORT_STEP,
				isActive: false,
				updatedBy: actor.login,
			}).returning();

			await writeAudit(tx, actor, 'content.create', created.id, { title: created.title, type });
			return toAdminNode(created);
		});
	});

	app.patch<{ Params: { id: number; }; Body: UpdateNodeRequest; }>('/nodes/:id', { schema: { params: idParams, body: updateBody } }, async (request): Promise<AdminContentNode> => {
		const { body } = request;
		const actor = actorOf(request);

		return db.transaction(async tx => {
			const row = await lockNode(tx, request.params.id);

			if (row.updatedAt.toISOString() !== body.updatedAt) {
				throw new RuleError(409, `Раздел уже изменил другой сотрудник${row.updatedBy ? ` (${row.updatedBy})` : ''}. Обновите страницу`);
			}

			const next = {
				title: body.title?.trim() ?? row.title,
				text: body.text === undefined ? row.text : emptyToNull(body.text),
				url: body.url === undefined ? row.url : emptyToNull(body.url),
				targetId: body.targetId === undefined ? row.targetId : body.targetId,
				synonyms: body.synonyms ? normalizeSynonyms(body.synonyms) : row.synonyms,
				imageText: body.imageText === undefined ? row.imageText : emptyToNull(body.imageText),
				isActive: body.isActive ?? row.isActive,
				isHidden: body.isHidden ?? row.isHidden,
			};

			const changed = (Object.keys(next) as (keyof typeof next)[]).filter(field => fieldChanged(next[field], row[field]));

			if (changed.length === 0) {
				return toAdminNode(row);
			}

			if (changed.includes('imageText') && actor.role !== 'superadmin') {
				throw new RuleError(403, 'Текст с картинки может менять только суперадмин');
			}

			if (row.code === ROOT_CODE && (!next.isActive || next.isHidden)) {
				throw new RuleError(400, 'Корень нельзя выключить или скрыть: без него бот перестанет отвечать');
			}

			if (changed.includes('text') && next.text !== null) {
				assertRule(messageError(next.text));
			}

			assertRule(row.type === 'link' ? linkUrlError(next.url) : null);
			assertRule(row.type === 'goto' ? targetError(await allNodes(tx), row.id, next.targetId) : null);

			const [updated] = await tx.update(contentNodes)
				.set({ ...next, updatedAt: sql`now()`, updatedBy: actor.login })
				.where(eq(contentNodes.id, row.id))
				.returning();

			await writeAudit(tx, actor, 'content.update', row.id, { title: updated.title, fields: changed });
			return toAdminNode(updated);
		});
	});

	// updatedAt не трогаем: он защищает поля формы, а перенос их не меняет и не должен мешать чужой правке
	app.post<{ Params: { id: number; }; Body: MoveNodeRequest; }>('/nodes/:id/move', { schema: { params: idParams, body: moveBody } }, async (request, reply) => {
		const { id } = request.params;
		const { parentId, index } = request.body;
		const actor = actorOf(request);

		await db.transaction(async tx => {
			// Иначе два встречных переноса создадут цикл, и бот молча скроет всю ветку
			await tx.execute(sql`select pg_advisory_xact_lock(${TREE_LOCK})`);

			const row = await lockNode(tx, id);

			assertRule(moveError(await allNodes(tx), id, parentId));

			const siblings = await tx.select({ id: contentNodes.id, sort: contentNodes.sort })
				.from(contentNodes)
				.where(and(eq(contentNodes.parentId, parentId), ne(contentNodes.id, id)))
				.orderBy(asc(contentNodes.sort), asc(contentNodes.id));

			const ordered = siblings.map(sibling => sibling.id);
			ordered.splice(Math.min(index, ordered.length), 0, id);

			await tx.update(contentNodes).set({ parentId }).where(eq(contentNodes.id, id));

			for (const [position, nodeId] of ordered.entries()) {
				await tx.update(contentNodes).set({ sort: (position + 1) * SORT_STEP }).where(eq(contentNodes.id, nodeId));
			}

			await writeAudit(tx, actor, 'content.move', id, { title: row.title, fromParentId: row.parentId, toParentId: parentId });
		});

		return reply.code(204).send();
	});

	app.delete<{ Params: { id: number; }; }>('/nodes/:id', { schema: { params: idParams } }, async (request, reply) => {
		const { id } = request.params;

		await db.transaction(async tx => {
			const row = await lockNode(tx, id);

			if (row.parentId === null) {
				throw new RuleError(409, 'Корень удалить нельзя');
			}

			const nodes = await allNodes(tx);
			const removed = subtreeIds(nodes, id);
			const handoff = await handoffCode(tx);

			if (nodes.some(node => removed.has(node.id) && node.code === handoff)) {
				throw new RuleError(409, 'На этот раздел ведет пункт «Нет подходящего варианта». Сначала смените его в настройках или выключите раздел');
			}

			// Вложенные удалит каскад, у переходов сюда цель обнулится: без нее бот их не показывает
			await tx.delete(contentNodes).where(eq(contentNodes.id, id));
			await writeAudit(tx, actorOf(request), 'content.delete', id, { title: row.title, removed: removed.size });
		});

		return reply.code(204).send();
	});
};
