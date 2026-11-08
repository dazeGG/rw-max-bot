import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Bot } from '@maxhub/max-bot-api';
import type { Context } from '@maxhub/max-bot-api';

import { escapeHtml, STAFF_LINK_PREFIX } from '@rw/core';

import type { DialogEngine, DialogEventRecord, DialogInput, DialogResult, DialogUser, Reply, StaffMaxLinkRequest, StaffMaxLinkResult, StaffNotifyRequest, StaffNotifyResult, SupportAttachment, SupportInboundRequest, SupportInboundResult, SupportSendRequest, SupportSendResult, SupportStatus, UploadKind, UploadResult } from '@rw/core';
import { errorMessage, repoPath } from '@rw/runtime';

import { logger } from '../logger';

const MEDIA_DIR = repoPath('media');

type MaxUser = NonNullable<Context['user']>;
type MaxUpdate = Context['update'];
type SendExtra = NonNullable<Parameters<Context['reply']>[1]>;
type Attachment = NonNullable<SendExtra['attachments']>[number];
type UploadedAttachment = { toJson: () => unknown; };

// Как ушел каждый ответ: картинка из кеша, перезагруженная или не отправленная; файл отправлен или нет
type Delivery = {
	image?: 'cached' | 'reuploaded' | 'dropped';
	file?: 'sent' | 'failed';
};

export type TransportEvent = DialogEventRecord;

export type MaxBotHooks = {
	onUser?: (user: DialogUser) => Promise<void>;
	onBlocked?: (userId: number) => Promise<void>;
	onEvent?: (event: TransportEvent) => void;
	getContentVersion?: () => string | null;
	// Выложенный коммит: попадает в каждую запись статистики
	revision?: string | null;
	support?: SupportTransport;
	linkStaff?: (request: StaffMaxLinkRequest) => Promise<StaffMaxLinkResult>;
};

export type SupportTransport = {
	openSupportTicket: (user: DialogUser) => Promise<string>;
	supportStatus: (userId: number) => Promise<SupportStatus | null>;
	sendSupportInbound: (message: SupportInboundRequest) => Promise<SupportInboundResult>;
	uploadSupportFile: (kind: UploadKind, name: string, body: ReadableStream<Uint8Array>) => Promise<UploadResult>;
};

// Сотрудникам показываем фото и файлы. Про остальное они узнают из подписи и спросят пассажира
const OTHER_ATTACHMENTS: Record<string, string> = {
	video: 'видео',
	audio: 'голосовое сообщение',
	sticker: 'стикер',
	contact: 'контакт',
	location: 'геопозицию',
	share: 'ссылку',
};

// Версия формата data в dialog_events: менять, если поля переименовываются или меняют смысл
const EVENT_FORMAT = 1;

const ATTACHMENT_TIMEOUT_MS = 120_000;
const SUPPORT_SIGNATURE = '<b>Служба поддержки</b>';

// Вложения входящего сообщения: библиотека не экспортирует их тип
type MaxAttachment = { type: string; filename: string; payload: { url: string; }; };
// Эти обновления бот обрабатывает как диалог, остальные только записывает в статистику
const DIALOG_UPDATES = new Set(['message_created', 'bot_started']);

const STAFF_LINK_FAILURES = {
	invalid: 'Ссылка устарела. Получите новую в админке.',
	taken: 'Этот профиль MAX уже привязан к другому сотруднику.',
};

const toDialogUser = (user: MaxUser): DialogUser => ({
	id: user.user_id,
	firstName: user.first_name,
	lastName: user.last_name ?? null,
	username: user.username,
});

// Путь из контента не должен выходить за папку media (например, «../.env»)
const mediaPath = (relativePath: string): string => {
	const absolute = path.resolve(MEDIA_DIR, relativePath);

	if (!absolute.startsWith(MEDIA_DIR + path.sep)) {
		throw new Error(`Media path outside media directory: ${relativePath}`);
	}

	return absolute;
};

export const createMaxBot = (token: string, engine: DialogEngine, hooks: MaxBotHooks = {}) => {
	const bot = new Bot(token);

	// Загруженные в MAX файлы переиспользуются по токену; ключ меняется при замене файла
	const uploads = new Map<string, UploadedAttachment>();

	// Сообщения одного пользователя обрабатываются строго по очереди: иначе два быстрых сообщения
	// прочитают одну и ту же сессию, а ответы перемешаются
	const queues = new Map<number, Promise<void>>();

	const uploadKey = async (kind: string, relativePath: string, displayName = '') => {
		const absolute = mediaPath(relativePath);
		const stat = await fs.stat(absolute);
		return { absolute, key: `${kind}:${absolute}:${stat.mtimeMs}:${displayName}` };
	};

	// MAX показывает имя файла, с которым он был загружен, поэтому загружаем копию с нужным именем
	const uploadFileWithName = async (absolute: string, displayName: string): Promise<UploadedAttachment> => {
		if (displayName === path.basename(absolute)) {
			return bot.api.uploadFile({ source: absolute });
		}

		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rw-max-bot-'));
		// Имя задают сотрудники: копия не должна выйти за временную папку
		const copy = path.join(dir, path.basename(displayName));

		try {
			await fs.copyFile(absolute, copy);
			return await bot.api.uploadFile({ source: copy });
		} catch (error) {
			logger.warn('Upload with display name failed, uploading original file name', { displayName, error: errorMessage(error) });
			return bot.api.uploadFile({ source: absolute });
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	};

	const uploadImage = async (relativePath: string, fresh = false): Promise<Attachment> => {
		const { absolute, key } = await uploadKey('image', relativePath);

		if (fresh) {
			uploads.delete(key);
		}

		const attachment = uploads.get(key) ?? await bot.api.uploadImage({ source: absolute });
		uploads.set(key, attachment);
		return attachment.toJson() as Attachment;
	};

	const uploadFile = async (relativePath: string, displayName: string): Promise<Attachment> => {
		const { absolute, key } = await uploadKey('file', relativePath, displayName);
		const attachment = uploads.get(key) ?? await uploadFileWithName(absolute, displayName);
		uploads.set(key, attachment);
		return attachment.toJson() as Attachment;
	};

	const sendReply = async (userId: number, reply: Reply, delivery: Delivery) => {
		const sendWith = (attachments: Attachment[]) =>
			bot.api.sendMessageToUser(userId, reply.text, { format: 'html', disable_link_preview: true, attachments });

		if (!reply.image) {
			// Сообщение может состоять из одного файла: он уйдет отдельно
			if (reply.text) {
				await sendWith([]);
			}

			return;
		}

		// Сохраненный токен картинки мог устареть: перезагружаем и, если не вышло, отправляем без картинки
		try {
			await sendWith([await uploadImage(reply.image)]);
			delivery.image = 'cached';
		} catch (error) {
			logger.warn('Send with cached image failed, re-uploading', { image: reply.image, error: errorMessage(error) });

			try {
				await sendWith([await uploadImage(reply.image, true)]);
				delivery.image = 'reuploaded';
			} catch (retryError) {
				logger.error('Image send failed, sending text only', { image: reply.image, error: errorMessage(retryError) });
				await sendWith([]);
				delivery.image = 'dropped';
			}
		}
	};

	const send = async (userId: number, replies: Reply[], deliveries: Delivery[]) => {
		for (const reply of replies) {
			const delivery: Delivery = {};
			deliveries.push(delivery);

			await sendReply(userId, reply, delivery);

			// Файл отдельным сообщением после текста
			if (reply.file) {
				try {
					await bot.api.sendMessageToUser(userId, '', { attachments: [await uploadFile(reply.file.path, reply.file.name)] });
					delivery.file = 'sent';
				} catch (error) {
					logger.error('File send failed', { file: reply.file.path, error: errorMessage(error) });
					delivery.file = 'failed';
				}
			}
		}
	};

	// Запись не должна задерживать ответ и ронять обработку
	const record = (event: Omit<TransportEvent, 'data' | 'contentVersion'> & { contentVersion?: string | null; data: Record<string, unknown>; }) => {
		try {
			hooks.onEvent?.({
				...event,
				contentVersion: event.contentVersion === undefined ? hooks.getContentVersion?.() ?? null : event.contentVersion,
				data: { v: EVENT_FORMAT, channel: 'max', revision: hooks.revision ?? null, ...event.data },
			});
		} catch (error) {
			logger.error('Event record failed', { type: event.type, error: errorMessage(error) });
		}
	};

	// Вложения пассажира сохраняются до записи сообщения: если файл не получить, сотрудник увидит это на экране
	const saveAttachments = async (attachments: MaxAttachment[], support: SupportTransport): Promise<SupportAttachment[]> => Promise.all(attachments.flatMap((attachment): Promise<SupportAttachment>[] => {
		const { type: kind } = attachment;

		if (kind !== 'image' && kind !== 'file') {
			const label = OTHER_ATTACHMENTS[kind];
			return label ? [Promise.resolve({ kind: 'unavailable', path: '', name: `Пассажир прислал ${label}, в чате это не открывается` })] : [];
		}

		const name = kind === 'file' ? attachment.filename : 'Фото';

		return [(async (): Promise<SupportAttachment> => {
			try {
				const response = await fetch(attachment.payload.url, { signal: AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS) });

				if (!response.ok || !response.body) {
					throw new Error(`MAX responded ${response.status}`);
				}

				const saved = await support.uploadSupportFile(kind, name, response.body);
				return { kind, path: saved.path, name, size: saved.size };
			} catch (error) {
				logger.warn('Passenger attachment was not saved', { type: kind, error: errorMessage(error) });
				return { kind: 'unavailable', path: '', name: `Не удалось получить вложение: ${name}` };
			}
		})()];
	}));

	// Пока обращение открыто, бот не отвечает сам. Возвращает, что делать дальше: ответить ботом или ничего
	const routeToSupport = async (user: DialogUser, input: DialogInput, update: MaxUpdate, receivedAt: number, support: SupportTransport): Promise<DialogInput | null> => {
		let status: SupportStatus | null;

		// Без API не узнать, открыто ли обращение. Бот обещает отвечать и без API, а обращение почти всегда не открыто
		try {
			status = await support.supportStatus(user.id);
		} catch (error) {
			logger.error('Support status is unknown, answering with the bot', { userId: user.id, error: errorMessage(error) });
			return input;
		}

		if (!status) {
			return input;
		}

		const message = 'message' in update ? update.message : undefined;
		const attachments = await saveAttachments((message?.body.attachments ?? []) as MaxAttachment[], support);
		const text = input.type === 'text' ? input.text : '';
		const result = await support.sendSupportInbound({
			userId: user.id,
			text,
			mid: message?.body.mid ?? null,
			attachments,
			// Сообщение без текста и вложений приходит как «старт»
			start: input.type === 'start' && attachments.length === 0,
		});

		record({
			userId: user.id,
			type: 'support_message',
			nodeId: null,
			nodeCode: null,
			text: text || null,
			raw: update,
			createdAt: new Date(receivedAt).toISOString(),
			data: { action: result.action, status, attachments: attachments.map(attachment => attachment.kind) },
		});

		if (result.action === 'cancelled') {
			await bot.api.sendMessageToUser(user.id, result.text, { format: 'html' });
			return { type: 'text', text: 'меню' };
		}

		return result.action === 'none' ? input : null;
	};

	const handle = async (user: MaxUser, originalInput: DialogInput, update: MaxUpdate, receivedAt: number) => {
		const dialogUser = toDialogUser(user);

		// Учет подписчиков не должен задерживать ответ
		void hooks.onUser?.(dialogUser).catch(error =>
			logger.error('Subscriber update failed', { userId: dialogUser.id, error: errorMessage(error) }));

		let input = originalInput;

		if (hooks.support) {
			try {
				const routed = await routeToSupport(dialogUser, originalInput, update, receivedAt, hooks.support);

				if (!routed) {
					return;
				}

				input = routed;
			} catch (error) {
				logger.error('Support routing failed', { userId: user.user_id, error: errorMessage(error) });
				await bot.api.sendMessageToUser(user.user_id, 'Не удалось передать сообщение сотруднику. Попробуйте, пожалуйста, ещё раз');
				return;
			}
		}

		const startedAt = Date.now();
		// Captured synchronously with the tree used by engine.process, before async E5 work.
		const contentVersion = hooks.getContentVersion?.() ?? null;
		let result: DialogResult;
		try {
			result = await engine.process(dialogUser, input);
		} catch (error) {
			logger.error('Semantic search failed', { error: errorMessage(error) });
			record({
				userId: user.user_id,
				type: 'search_failed',
				contentVersion,
				nodeId: null,
				nodeCode: null,
				text: input.type === 'text' ? input.text : null,
				raw: update,
				createdAt: new Date(receivedAt).toISOString(),
				data: { error: errorMessage(error), updateType: update.update_type },
			});
			await bot.api.sendMessageToUser(user.user_id, 'Не удалось выполнить поиск. Попробуйте ещё раз или напишите «меню» и выберите пункт номером.');
			return;
		}
		const { event } = result;
		let { replies } = result;

		// Пассажир выбрал «Написать оператору»
		if (event.type === 'operator') {
			try {
				replies = [{ text: await hooks.support?.openSupportTicket(dialogUser) ?? '' }];
			} catch (error) {
				logger.error('Support ticket was not opened', { userId: user.user_id, error: errorMessage(error) });
				replies = [{ text: 'Не удалось передать обращение. Попробуйте, пожалуйста, ещё раз или позвоните по телефону 8 800 550 06 20' }];
			}
		}

		const processedAt = Date.now();
		const deliveries: Delivery[] = [];
		let sendError: string | undefined;

		try {
			await send(user.user_id, replies, deliveries);
		} catch (error) {
			sendError = errorMessage(error);
			throw error;
		} finally {
			const message = 'message' in update ? update.message : undefined;

			record({
				userId: user.user_id,
				type: event.type,
				contentVersion,
				nodeId: event.nodeId,
				nodeCode: event.nodeCode,
				text: event.text,
				raw: update,
				createdAt: new Date(receivedAt).toISOString(),
				data: {
					...event.details,
					updateType: update.update_type,
					messageId: message?.body.mid ?? null,
					attachments: message?.body.attachments?.map(attachment => attachment.type) ?? [],
					replies,
					deliveries,
					...sendError ? { sendError } : {},
					timing: {
						// От отправки сообщения в MAX до получения ботом, ожидание в очереди пользователя, разбор, отправка ответов
						lagMs: receivedAt - update.timestamp,
						queueMs: startedAt - receivedAt,
						engineMs: processedAt - startedAt,
						sendMs: Date.now() - processedAt,
					},
				},
			});
		}
	};

	const dispatch = (user: MaxUser | null | undefined, input: DialogInput, update: MaxUpdate): Promise<void> => {
		if (!user || user.is_bot) {
			return Promise.resolve();
		}

		const receivedAt = Date.now();
		const previous = queues.get(user.user_id) ?? Promise.resolve();
		const next = previous
			.then(() => handle(user, input, update, receivedAt))
			.catch((error: unknown) => {
				logger.error('Update handling failed', {
					userId: user.user_id,
					error: errorMessage(error),
					stack: error instanceof Error ? error.stack : undefined,
				});
			});

		queues.set(user.user_id, next);
		void next.finally(() => {
			if (queues.get(user.user_id) === next) {
				queues.delete(user.user_id);
			}
		});

		return next;
	};

	// Остальные обновления (бота остановили, сообщение изменили или удалили…) бот не обрабатывает как диалог,
	// но записывает целиком: по ним тоже можно что-то посчитать
	bot.use(async (ctx, next) => {
		if (!DIALOG_UPDATES.has(ctx.updateType) && ctx.user && !ctx.user.is_bot) {
			record({
				userId: ctx.user.user_id,
				type: ctx.updateType,
				nodeId: null,
				nodeCode: null,
				text: null,
				raw: ctx.update,
				createdAt: new Date().toISOString(),
				data: { updateType: ctx.updateType, timing: { lagMs: Date.now() - ctx.update.timestamp } },
			});
		}

		await next();
	});

	// Привязка сотрудника разбирается до диалога: иначе старт по ссылке закрыл бы его открытое обращение,
	// а код попал бы в статистику
	const linkStaff = async (user: MaxUser, code: string, link: NonNullable<MaxBotHooks['linkStaff']>) => {
		let text = 'Не удалось привязать профиль. Попробуйте, пожалуйста, ещё раз.';

		try {
			const result = await link({ code, userId: user.user_id });

			text = result.status === 'linked' ? `Профиль привязан: ${result.fullName}.` : STAFF_LINK_FAILURES[result.status];
		} catch (error) {
			logger.error('Staff MAX link failed', { userId: user.user_id, error: errorMessage(error) });
		}

		await bot.api.sendMessageToUser(user.user_id, text);
	};

	bot.on('bot_started', ctx => {
		const code = ctx.startPayload?.startsWith(STAFF_LINK_PREFIX) ? ctx.startPayload.slice(STAFF_LINK_PREFIX.length) : null;

		return code && hooks.linkStaff
			? linkStaff(ctx.user, code, hooks.linkStaff)
			: dispatch(ctx.user, { type: 'start' }, ctx.update);
	});

	bot.on('message_created', async ctx => {
		const message = ctx.message;

		// Иногда Bot API присылает пустой message_created. В групповых чатах и каналах бот не отвечает
		if (!message || message.recipient.chat_type !== 'dialog') {
			return;
		}

		const text = message.body.text?.trim();

		await dispatch(message.sender, text ? { type: 'text', text } : { type: 'start' }, ctx.update);
	});

	bot.on('bot_stopped', async ctx => {
		if (ctx.user) {
			await hooks.onBlocked?.(ctx.user.user_id).catch(error =>
				logger.error('Subscriber block failed', { error: errorMessage(error) }));
		}
	});

	bot.catch((error, ctx) => {
		logger.error('Update handling failed', {
			updateType: ctx.updateType,
			chatId: ctx.chatId,
			error: errorMessage(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
	});

	// Дождаться ответов, которые еще отправляются (для корректной остановки)
	const drain = async () => {
		await Promise.allSettled([...queues.values()]);
	};

	// Пассажир видит «Служба поддержки», имя сотрудника в сообщение не попадает.
	// Сотрудник пишет обычный текст: его спецсимволы экранируются
	const sendSupport = async ({ userId, text, attachments, notice }: SupportSendRequest): Promise<SupportSendResult> => {
		const sendable = attachments.filter(attachment => attachment.kind !== 'unavailable');
		const images = sendable.filter(attachment => attachment.kind === 'image');
		const files = sendable.filter(attachment => attachment.kind === 'file');
		const replies: Reply[] = [
			{ text: notice ? text : `${SUPPORT_SIGNATURE}\n${escapeHtml(text)}`.trimEnd(), image: images[0]?.path },
			...images.slice(1).map(image => ({ text: '', image: image.path })),
			...files.map(file => ({ text: '', file: { path: file.path, name: file.name } })),
		];
		const deliveries: Delivery[] = [];

		try {
			await send(userId, replies, deliveries);
		} catch (error) {
			return { ok: false, error: errorMessage(error) };
		}

		const lost = deliveries.some(delivery => delivery.image === 'dropped' || delivery.file === 'failed');

		return lost ? { ok: false, error: 'Attachment was not delivered' } : { ok: true };
	};

	const notifyStaff = async ({ text, url, ...target }: StaffNotifyRequest): Promise<StaffNotifyResult> => {
		const attachments = [{ type: 'inline_keyboard' as const, payload: { buttons: [[{ type: 'link' as const, text: 'Открыть в админке', url }]] } }];

		try {
			if ('mid' in target) {
				await bot.api.editMessage(target.mid, { text, attachments });
				return { ok: true, mid: target.mid };
			}

			const message = await bot.api.sendMessageToUser(target.userId, text, { attachments });

			return { ok: true, mid: message.body.mid };
		} catch (error) {
			return { ok: false, error: errorMessage(error) };
		}
	};

	return { bot, drain, sendSupport, notifyStaff };
};
