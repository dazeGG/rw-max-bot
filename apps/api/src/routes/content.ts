// Редактор дерева. Контент правят суперадмин и админ; поддержке он недоступен

import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { DEFAULT_SETTINGS, OPERATOR_CODE, OPERATOR_MENU_CODE, ROOT_CODE, supportHoursError } from '@rw/core';
import type { AdminContentNode, AdminUser, ContentApplied, ContentNode, ContentVersionDiff, ContentVersionEntry, CreateNodeRequest, MoveNodeRequest, Settings, UpdateNodeRequest, UpdateSettingsRequest, UploadKind, UploadResult } from '@rw/core';
import { admins, auditLog, contentNodes, contentVersions, db, settings } from '@rw/db';
import { tablesError, tablesSearchText } from '@rw/core/tables';
import { errorMessage } from '@rw/runtime';

import { writeAudit } from '../audit';
import type { Tx } from '../audit';
import { requireAdmin, requireRole } from '../auth/guards';
import { config } from '../config';
import { loadAdminContent, loadContent, loadSettings, storeSnapshot, toAdminNode } from '../content';
import { notifyBotContentChanged } from '../content-notifier';
import { diffContent, HISTORY_LIMIT, imagesChanged, keepTables, legacyTableIds, linkUrlError, mergeHistory, messageError, moveError, normalizeSynonyms, parentError, settingError, subtreeIds, targetError, toContentNode } from '../content-rules';
import { RuleError } from '../errors';
import { logger } from '../logger';
import { assertUploadSize, fileNameError, mediaFile, saveUpload, uploadedPathError } from '../uploads';

const SORT_STEP = 10;
// Ключ блокировки записи контента, значение произвольное
const CONTENT_LOCK = 7_204_001;

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

const tableBody = {
	type: 'object',
	required: ['title', 'rows', 'searchable'],
	properties: {
		title: { type: 'string' },
		description: { type: 'string' },
		rows: { type: 'array', maxItems: 200, items: { type: 'array', maxItems: 8, items: { type: 'string' } } },
		searchable: { type: 'boolean' },
	},
} as const;

const attachmentPath = { type: ['string', 'null'], maxLength: 300 } as const;

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
		image: attachmentPath,
		imageText: { type: ['string', 'null'], maxLength: 10_000 },
		tables: { type: ['array', 'null'], maxItems: 5, items: tableBody },
		file: attachmentPath,
		fileName: { type: ['string', 'null'], maxLength: 300 },
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

const uploadQuery = {
	type: 'object',
	required: ['kind', 'name'],
	properties: {
		// table — картинка таблицы: ее может загрузить и админ, а в хранилище она ложится как обычная картинка
		kind: { type: 'string', enum: ['image', 'file', 'table'] },
		name: { type: 'string', minLength: 1, maxLength: 300 },
	},
} as const;

const versionParams = {
	type: 'object',
	required: ['version'],
	properties: { version: { type: 'string', maxLength: 64 } },
} as const;

const settingsBody = {
	type: 'object',
	required: ['changes'],
	properties: {
		changes: {
			type: 'array',
			maxItems: 20,
			items: {
				type: 'object',
				required: ['key', 'value', 'previous'],
				properties: {
					key: { type: 'string', enum: Object.keys(DEFAULT_SETTINGS) },
					value: { type: 'string' },
					previous: { type: 'string' },
				},
			},
		},
	},
} as const;

// Запись контента идет по одной: так не появятся встречные переносы с циклом (бот молча скрыл бы всю ветку),
// а хеш версии в истории точно соответствует состоянию после правки.
// Снимок до правки нужен, чтобы вернуться можно было и к первому состоянию, и к состоянию после правок через SQL
const withContentLock = <T>(work: (tx: Tx) => Promise<T>) => db.transaction(async tx => {
	await tx.execute(sql`select pg_advisory_xact_lock(${CONTENT_LOCK})`);
	await storeSnapshot(tx);
	return work(tx);
});

// Хеш версии в журнале связывает снимок с тем, кто и что поменял: из этого строится история версий
const auditContent = async (tx: Tx, actor: AdminUser, action: string, targetId: number | null, details: Record<string, unknown>) => {
	const { version } = await storeSnapshot(tx);
	await writeAudit(tx, actor, action, targetId, { ...details, version });
};

const loadVersion = async (reader: Pick<typeof db, 'select'>, version: string) => {
	const [row] = await reader.select().from(contentVersions).where(eq(contentVersions.version, version));

	if (!row) {
		throw new RuleError(404, 'Такой версии нет. Обновите страницу');
	}

	const raw = row.nodes as ContentNode[];

	return {
		nodes: raw.map(toContentNode),
		legacy: legacyTableIds(raw),
		settings: row.settings as Settings,
	};
};

// Служебные тексты, которые отличаются от версии. В старых снимках новых ключей нет: такие тексты не трогаем
const changedSettings = (current: Settings, target: Settings) =>
	(Object.keys(current) as (keyof Settings)[]).filter(key => key in target && target[key] !== current[key]);

// В старых версиях контента нет входа в чат: возврат к ним не должен его убирать
const keepOperator = <T extends { removed: ContentNode[]; }>(diff: T): T => ({
	...diff,
	removed: diff.removed.filter(node => node.code !== OPERATOR_CODE && node.code !== OPERATOR_MENU_CODE),
});

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

	// Тело не разбирается и не копится в памяти: это только поток. Читать его начинает обработчик, то есть уже после проверки роли
	app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));

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

		return withContentLock(async tx => {
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

			await auditContent(tx, actor, 'content.create', created.id, { title: created.title, type });
			return toAdminNode(created);
		});
	});

	app.patch<{ Params: { id: number; }; Body: UpdateNodeRequest; }>('/nodes/:id', { schema: { params: idParams, body: updateBody } }, async (request): Promise<AdminContentNode> => {
		const { body } = request;
		const actor = actorOf(request);

		return withContentLock(async tx => {
			const row = await lockNode(tx, request.params.id);

			if (row.updatedAt.toISOString() !== body.updatedAt) {
				throw new RuleError(409, `Раздел уже изменил другой сотрудник${row.updatedBy ? ` (${row.updatedBy})` : ''}. Обновите страницу`);
			}

			const file = body.file === undefined ? row.file : emptyToNull(body.file);
			// Пустой список — то же, что нет таблиц
			const tables = body.tables === undefined ? row.tables : body.tables?.length ? body.tables : null;

			assertRule(tables ? tablesError(tables) : null);

			const next = {
				title: body.title?.trim() ?? row.title,
				text: body.text === undefined ? row.text : emptyToNull(body.text),
				url: body.url === undefined ? row.url : emptyToNull(body.url),
				targetId: body.targetId === undefined ? row.targetId : body.targetId,
				synonyms: body.synonyms ? normalizeSynonyms(body.synonyms) : row.synonyms,
				image: body.image === undefined ? row.image : emptyToNull(body.image),
				// Текст для поиска у раздела с таблицами всегда собирает сервер: он не расходится с таблицей
				imageText: tables ? emptyToNull(tablesSearchText(tables)) : body.imageText === undefined ? row.imageText : emptyToNull(body.imageText),
				tables,
				file,
				// Без файла имени быть не может: иначе бот показал бы чужое имя у следующего файла
				fileName: file === null ? null : body.fileName === undefined ? row.fileName : emptyToNull(body.fileName),
				isActive: body.isActive ?? row.isActive,
				isHidden: body.isHidden ?? row.isHidden,
			};

			const changed = (Object.keys(next) as (keyof typeof next)[]).filter(field => fieldChanged(next[field], row[field]));

			if (changed.length === 0) {
				return toAdminNode(row);
			}

			// Админ меняет картинку вместе с таблицей, из которой она нарисована. Убрать таблицу, то есть оставить обычную картинку, может только суперадмин
			const withTables = changed.includes('tables') && next.tables !== null;

			if (changed.includes('tables') && next.tables === null && actor.role !== 'superadmin') {
				throw new RuleError(403, 'Убрать таблицу может только суперадмин');
			}

			if (changed.includes('imageText') && !withTables && actor.role !== 'superadmin') {
				throw new RuleError(403, 'Текст с картинки может менять только суперадмин');
			}

			if (changed.includes('image') && !withTables && actor.role !== 'superadmin') {
				throw new RuleError(403, 'Картинку может менять только суперадмин');
			}

			if (changed.includes('tables') && row.type !== 'section') {
				throw new RuleError(400, 'Таблицы бывают только у раздела с ответом');
			}

			if ((changed.includes('image') || changed.includes('file')) && row.type !== 'section') {
				throw new RuleError(400, 'Картинка и файл бывают только у раздела с ответом');
			}

			if (changed.includes('image') && next.image !== null) {
				assertRule(await uploadedPathError('image', next.image));
			}

			if (changed.includes('file') && next.file !== null) {
				assertRule(await uploadedPathError('file', next.file));
			}

			if (next.fileName !== null && (changed.includes('file') || changed.includes('fileName'))) {
				assertRule(fileNameError(next.fileName));
			}

			// Только при смене файла: у раздела из начального контента имени может не быть, и другие его поля должны сохраняться
			if (changed.includes('file') && next.file !== null && next.fileName === null) {
				throw new RuleError(400, 'Укажите имя файла');
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

			await auditContent(tx, actor, 'content.update', row.id, { title: updated.title, fields: changed });
			return toAdminNode(updated);
		});
	});

	// updatedAt не трогаем: он защищает поля формы, а перенос их не меняет и не должен мешать чужой правке
	app.post<{ Params: { id: number; }; Body: MoveNodeRequest; }>('/nodes/:id/move', { schema: { params: idParams, body: moveBody } }, async (request, reply) => {
		const { id } = request.params;
		const { parentId, index } = request.body;
		const actor = actorOf(request);

		await withContentLock(async tx => {
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

			await auditContent(tx, actor, 'content.move', id, { title: row.title, fromParentId: row.parentId, toParentId: parentId });
		});

		return reply.code(204).send();
	});

	app.delete<{ Params: { id: number; }; }>('/nodes/:id', { schema: { params: idParams } }, async (request, reply) => {
		const { id } = request.params;

		await withContentLock(async tx => {
			const row = await lockNode(tx, id);

			if (row.parentId === null) {
				throw new RuleError(409, 'Корень удалить нельзя');
			}

			const nodes = await allNodes(tx);
			const removed = subtreeIds(nodes, id);
			const handoff = await handoffCode(tx);

			if (nodes.some(node => removed.has(node.id) && node.code === OPERATOR_CODE)) {
				throw new RuleError(409, 'Здесь находится пункт «Написать оператору», без него пассажиры не попадут в чат. Его можно выключить');
			}

			if (nodes.some(node => removed.has(node.id) && node.code === handoff)) {
				throw new RuleError(409, 'На этот раздел ведет пункт «Нет подходящего варианта». Сначала смените его в настройках или выключите раздел');
			}

			// Вложенные удалит каскад, у переходов сюда цель обнулится: без нее бот их не показывает
			await tx.delete(contentNodes).where(eq(contentNodes.id, id));
			await auditContent(tx, actorOf(request), 'content.delete', id, { title: row.title, removed: removed.size });
		});

		return reply.code(204).send();
	});

	// Файл кладется на сервер, в раздел он попадет при сохранении формы: так работают проверка чужой правки, журнал и история
	app.post<{ Querystring: { kind: UploadKind | 'table'; name: string; }; }>('/uploads', { schema: { querystring: uploadQuery } }, async (request): Promise<UploadResult> => {
		const { kind, name } = request.query;

		if (!(request.body instanceof Readable)) {
			throw new RuleError(415, 'Файл нужно передавать как application/octet-stream');
		}

		if (kind === 'image' && actorOf(request).role !== 'superadmin') {
			throw new RuleError(403, 'Картинку может менять только суперадмин');
		}

		if (kind === 'file') {
			assertRule(fileNameError(name));
		}

		const stored = kind === 'table' ? 'image' : kind;

		assertUploadSize(stored, Number(request.headers['content-length'] ?? 0));

		return saveUpload(stored, name, request.body);
	});

	app.get<{ Params: { '*': string; }; }>('/media/*', async (request, reply) => {
		const file = await mediaFile(request.params['*']);

		if (!file) {
			throw new RuleError(404, 'Файл не найден');
		}

		// Имя в uploads — хеш содержимого: файл по этому адресу не изменится
		return reply
			.header('content-type', file.type ?? 'application/octet-stream')
			.header('content-length', file.size)
			.header('content-disposition', file.type ? 'inline' : 'attachment')
			.header('x-content-type-options', 'nosniff')
			.header('cache-control', 'private, max-age=86400')
			.send(createReadStream(file.absolute));
	});

	// previous — значение, которое правил сотрудник: чужая правка того же текста молча не затирается
	app.patch<{ Body: UpdateSettingsRequest; }>('/settings', { schema: { body: settingsBody } }, async (request): Promise<Settings> => {
		const { changes } = request.body;

		return withContentLock(async tx => {
			const current = await loadSettings(tx);
			const nodes = await allNodes(tx);
			const real = changes.filter(change => change.value !== current[change.key]);

			for (const change of real) {
				if (change.previous !== current[change.key]) {
					throw new RuleError(409, 'Этот текст уже изменил другой сотрудник. Обновите страницу');
				}

				assertRule(settingError(change.key, change.value, nodes));
			}

			if (real.some(change => change.key === 'support.open' || change.key === 'support.close')) {
				assertRule(supportHoursError({ ...current, ...Object.fromEntries(real.map(change => [change.key, change.value])) }));
			}

			for (const { key, value } of real) {
				await tx.insert(settings).values({ key, value })
					.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
			}

			if (real.length > 0) {
				await auditContent(tx, actorOf(request), 'settings.update', null, { title: 'Служебные тексты', keys: real.map(change => change.key) });
			}

			return loadSettings(tx);
		});
	});

	app.get('/versions', async (): Promise<ContentVersionEntry[]> => {
		// Сначала текущая версия: после правки в обход админки ее снимок записывается при этом чтении
		const current = await loadContent();
		const [edits, snapshots] = await Promise.all([
			db.select({
				id: auditLog.id,
				createdAt: auditLog.createdAt,
				actorName: admins.fullName,
				action: auditLog.action,
				details: auditLog.details,
			})
				.from(auditLog)
				.innerJoin(admins, eq(admins.id, auditLog.actorId))
				.where(sql`${auditLog.details}->>'version' is not null`)
				.orderBy(desc(auditLog.id))
				.limit(HISTORY_LIMIT),
			db.select({ version: contentVersions.version, createdAt: contentVersions.createdAt })
				.from(contentVersions)
				.orderBy(desc(contentVersions.createdAt))
				.limit(HISTORY_LIMIT),
		]);

		return mergeHistory(edits, snapshots, current.version);
	});

	app.get<{ Params: { version: string; }; }>('/versions/:version', { schema: { params: versionParams } }, async (request): Promise<ContentVersionDiff> => {
		const target = await loadVersion(db, request.params.version);
		const current = await loadContent();
		const diff = keepOperator(diffContent(current.nodes, keepTables(current.nodes, target.nodes, target.legacy)));

		return {
			changed: diff.changed.map(node => node.title),
			returned: diff.returned.map(node => node.title),
			removed: diff.removed.map(node => node.title),
			settings: changedSettings(current.settings, target.settings).length,
		};
	});

	// Разделы не удаляются и не создаются заново: остаются те же id, поэтому сессии пассажиров и статистика не теряют связь.
	// Текущее состояние уже в истории, так что к нему тоже можно вернуться
	app.post<{ Params: { version: string; }; }>('/versions/:version/restore', { schema: { params: versionParams } }, async (request, reply) => {
		const { version } = request.params;
		const actor = actorOf(request);

		await withContentLock(async tx => {
			const target = await loadVersion(tx, version);
			const current = (await allNodes(tx)).map(toContentNode);
			const currentSettings = await loadSettings(tx);
			const { changed, returned, removed } = keepOperator(diffContent(current, keepTables(current, target.nodes, target.legacy)));
			const changedKeys = changedSettings(currentSettings, target.settings);

			if (!target.nodes.some(node => node.code === ROOT_CODE && node.isActive)) {
				throw new RuleError(409, 'В этой версии нет включенного корня: бот перестал бы отвечать');
			}

			if (actor.role !== 'superadmin' && imagesChanged(current, changed)) {
				throw new RuleError(403, 'В этой версии другие картинки или текст с картинки. Вернуть ее может только суперадмин');
			}

			const written = [...changed, ...returned];

			if (written.length === 0 && removed.length === 0 && changedKeys.length === 0) {
				return;
			}

			const removedIds = removed.map(node => node.id);

			// Код уникален: вернувшийся раздел может занять код раздела, который сейчас будет удален
			if (removedIds.length > 0) {
				await tx.update(contentNodes)
					.set({ code: sql`'removed-' || ${contentNodes.id}` })
					.where(inArray(contentNodes.id, removedIds));
			}

			// Одним запросом: родитель и цель могут вернуться вместе с разделом, ссылки проверяются в конце запроса
			if (written.length > 0) {
				await tx.insert(contentNodes)
					.values(written.map(node => ({ ...node, updatedBy: actor.login })))
					.onConflictDoUpdate({
						target: contentNodes.id,
						set: {
							parentId: sql`excluded.parent_id`,
							code: sql`excluded.code`,
							type: sql`excluded.type`,
							title: sql`excluded.title`,
							text: sql`excluded.text`,
							url: sql`excluded.url`,
							targetId: sql`excluded.target_id`,
							image: sql`excluded.image`,
							imageText: sql`excluded.image_text`,
							tables: sql`excluded.tables`,
							file: sql`excluded.file`,
							fileName: sql`excluded.file_name`,
							synonyms: sql`excluded.synonyms`,
							sort: sql`excluded.sort`,
							isActive: sql`excluded.is_active`,
							isHidden: sql`excluded.is_hidden`,
							updatedAt: sql`now()`,
							updatedBy: actor.login,
						},
					});
			}

			// После записи: разделы из версии уже вернулись к своим родителям, каскад их не заденет
			if (removedIds.length > 0) {
				await tx.delete(contentNodes).where(inArray(contentNodes.id, removedIds));
			}

			for (const key of changedKeys) {
				await tx.insert(settings).values({ key, value: target.settings[key] })
					.onConflictDoUpdate({ target: settings.key, set: { value: target.settings[key], updatedAt: sql`now()` } });
			}

			await auditContent(tx, actor, 'content.restore', null, {
				title: 'Весь контент',
				restoredFrom: version,
				changed: changed.length,
				returned: returned.length,
				removed: removed.length,
			});
		});

		return reply.code(204).send();
	});
};
