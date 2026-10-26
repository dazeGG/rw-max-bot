import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Bot } from '@maxhub/max-bot-api';
import type { Context } from '@maxhub/max-bot-api';

import type { DialogEngine, DialogEventRecord, DialogInput, DialogUser, Reply } from '@rw/core';
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

// Запись для статистики без версии контента: ее добавляет тот, кто знает текущий контент
export type TransportEvent = Omit<DialogEventRecord, 'contentVersion'>;

export type MaxBotHooks = {
	onUser?: (user: DialogUser) => Promise<void>;
	onBlocked?: (userId: number) => Promise<void>;
	onEvent?: (event: TransportEvent) => void;
	// Выложенный коммит: попадает в каждую запись статистики
	revision?: string | null;
};

// Версия формата data в dialog_events: менять, если поля переименовываются или меняют смысл
const EVENT_FORMAT = 1;
// Эти обновления бот обрабатывает как диалог, остальные только записывает в статистику
const DIALOG_UPDATES = new Set(['message_created', 'bot_started']);

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
		const copy = path.join(dir, displayName);

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
			await sendWith([]);
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
	const record = (event: Omit<TransportEvent, 'data'> & { data: Record<string, unknown>; }) => {
		try {
			hooks.onEvent?.({ ...event, data: { v: EVENT_FORMAT, channel: 'max', revision: hooks.revision ?? null, ...event.data } });
		} catch (error) {
			logger.error('Event record failed', { type: event.type, error: errorMessage(error) });
		}
	};

	const handle = async (user: MaxUser, input: DialogInput, update: MaxUpdate, receivedAt: number) => {
		const dialogUser = toDialogUser(user);

		// Учет подписчиков не должен задерживать ответ
		void hooks.onUser?.(dialogUser).catch(error =>
			logger.error('Subscriber update failed', { userId: dialogUser.id, error: errorMessage(error) }));

		const startedAt = Date.now();
		const { replies, event } = await engine.process(dialogUser, input);
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

	bot.on('bot_started', ctx => dispatch(ctx.user, { type: 'start' }, ctx.update));

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

	return { bot, drain };
};
