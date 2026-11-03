// Чат поддержки для сотрудников. Он нужен всем трем ролям, различия — в support.ts

import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { SupportAttachment, SupportReplyRequest, SupportTab, SupportTransferRequest, UploadKind, UploadResult } from '@rw/core';
import { repoPath } from '@rw/runtime';

import { requireAdmin } from '../auth/guards';
import { RuleError } from '../errors';
import { activeStaff, closeTicket, countTickets, listTickets, loadTicketDetail, releaseAllTickets, releaseTicket, replyToTicket, SUPPORT_FOLDER, supportFile, takeTicket, transferTicket } from '../support';
import { addStream } from '../support-hub';
import { assertUploadSize, fileNameError, saveUpload } from '../uploads';

const MESSAGE_LIMIT = 3900;
const ATTACHMENT_LIMIT = 10;
const ATTACHED_PATH = new RegExp(`^${SUPPORT_FOLDER}/[0-9a-f]{64}\\.[a-z0-9]+$`);

const idParams = {
	type: 'object',
	required: ['id'],
	properties: { id: { type: 'integer' } },
} as const;

const listQuery = {
	type: 'object',
	required: ['tab'],
	properties: { tab: { type: 'string', enum: ['queue', 'mine', 'closed', 'all'] } },
} as const;

const uploadQuery = {
	type: 'object',
	required: ['kind', 'name'],
	properties: {
		kind: { type: 'string', enum: ['image', 'file'] },
		name: { type: 'string', minLength: 1, maxLength: 300 },
	},
} as const;

const replyBody = {
	type: 'object',
	required: ['text', 'attachments'],
	properties: {
		text: { type: 'string', maxLength: MESSAGE_LIMIT },
		attachments: {
			type: 'array',
			maxItems: ATTACHMENT_LIMIT,
			items: {
				type: 'object',
				required: ['kind', 'path', 'name'],
				properties: {
					kind: { type: 'string', enum: ['image', 'file'] },
					path: { type: 'string', maxLength: 300 },
					name: { type: 'string', minLength: 1, maxLength: 300 },
					size: { type: 'integer' },
				},
			},
		},
	},
} as const;

const transferBody = {
	type: 'object',
	required: ['adminId'],
	properties: { adminId: { type: 'integer' } },
} as const;

const assertAttachments = async (attachments: SupportAttachment[]) => {
	for (const { kind, path: relative, name } of attachments) {
		if (!ATTACHED_PATH.test(relative)) {
			throw new RuleError(400, 'Файл указан неверно');
		}

		const error = kind === 'file' ? fileNameError(name) : null;

		if (error) {
			throw new RuleError(400, error);
		}

		await fs.access(path.join(repoPath('media'), relative)).catch(() => {
			throw new RuleError(400, 'Файл не найден. Загрузите его заново');
		});
	}
};

export const supportRoutes: FastifyPluginAsync = async app => {
	app.addHook('preHandler', requireAdmin);

	const actorOf = (request: FastifyRequest) => request.admin!;

	// Тело не разбирается и не копится в памяти: читать его начинает обработчик, уже после проверки входа
	app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));

	app.get('/stream', (request, reply) => {
		reply.hijack();
		reply.raw.writeHead(200, {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store',
			connection: 'keep-alive',
			// Иначе прокси может копить события
			'x-accel-buffering': 'no',
		});
		reply.raw.write(': connected\n\n');
		addStream(reply.raw, actorOf(request).id);
	});

	app.get('/counts', request => countTickets(actorOf(request)));

	app.get('/staff', () => activeStaff());

	app.get<{ Querystring: { tab: SupportTab; }; }>('/tickets', { schema: { querystring: listQuery } }, request => listTickets(request.query.tab, actorOf(request)));

	app.get<{ Params: { id: number; }; }>('/tickets/:id', { schema: { params: idParams } }, request => loadTicketDetail(request.params.id, actorOf(request)));

	app.post<{ Params: { id: number; }; }>('/tickets/:id/take', { schema: { params: idParams } }, async (request, reply) => {
		await takeTicket(request.params.id, actorOf(request));
		return reply.code(204).send();
	});

	app.post<{ Params: { id: number; }; }>('/tickets/:id/release', { schema: { params: idParams } }, async (request, reply) => {
		await releaseTicket(request.params.id, actorOf(request));
		return reply.code(204).send();
	});

	app.post('/tickets/release-mine', async request => ({ released: await releaseAllTickets(actorOf(request)) }));

	app.post<{ Params: { id: number; }; Body: SupportTransferRequest; }>('/tickets/:id/transfer', { schema: { params: idParams, body: transferBody } }, async (request, reply) => {
		await transferTicket(request.params.id, request.body.adminId, actorOf(request));
		return reply.code(204).send();
	});

	app.post<{ Params: { id: number; }; }>('/tickets/:id/close', { schema: { params: idParams } }, async (request, reply) => {
		await closeTicket(request.params.id, actorOf(request));
		return reply.code(204).send();
	});

	app.post<{ Params: { id: number; }; Body: SupportReplyRequest; }>('/tickets/:id/messages', { schema: { params: idParams, body: replyBody } }, async (request, reply) => {
		const { text, attachments } = request.body;

		if (!text.trim() && attachments.length === 0) {
			throw new RuleError(400, 'Напишите сообщение или приложите файл');
		}

		await assertAttachments(attachments);
		await replyToTicket(request.params.id, text.trim(), attachments, actorOf(request));

		return reply.code(204).send();
	});

	app.post<{ Querystring: { kind: UploadKind; name: string; }; }>('/uploads', { schema: { querystring: uploadQuery } }, async (request): Promise<UploadResult> => {
		const { kind, name } = request.query;

		if (!(request.body instanceof Readable)) {
			throw new RuleError(415, 'Файл нужно передавать как application/octet-stream');
		}

		const error = kind === 'file' ? fileNameError(name) : null;

		if (error) {
			throw new RuleError(400, error);
		}

		assertUploadSize(kind, Number(request.headers['content-length'] ?? 0));

		return saveUpload(kind, name, request.body, undefined, SUPPORT_FOLDER);
	});

	app.get<{ Params: { '*': string; }; }>('/files/*', async (request, reply) => {
		const file = await supportFile(request.params['*']);

		if (!file) {
			throw new RuleError(404, 'Файл не найден');
		}

		return reply
			.header('content-type', file.type ?? 'application/octet-stream')
			.header('content-length', file.size)
			.header('content-disposition', file.type ? 'inline' : 'attachment')
			.header('x-content-type-options', 'nosniff')
			.header('cache-control', 'private, max-age=86400')
			.send(createReadStream(file.absolute));
	});
};
