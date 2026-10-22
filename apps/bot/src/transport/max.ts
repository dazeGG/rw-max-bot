import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Bot } from '@maxhub/max-bot-api';
import type { Context } from '@maxhub/max-bot-api';

import type { DialogEngine, DialogInput, DialogUser, Reply } from '@rw/core';
import { errorMessage, repoPath } from '@rw/runtime';

import { logger } from '../logger';

const MEDIA_DIR = repoPath('media');

type MaxUser = NonNullable<Context['user']>;
type SendExtra = NonNullable<Parameters<Context['reply']>[1]>;
type Attachment = NonNullable<SendExtra['attachments']>[number];
type UploadedAttachment = { toJson: () => unknown; };

export type MaxBotHooks = {
	onUser?: (user: DialogUser) => Promise<void>;
	onBlocked?: (userId: number) => Promise<void>;
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

	const sendReply = async (userId: number, reply: Reply) => {
		const sendWith = (attachments: Attachment[]) =>
			bot.api.sendMessageToUser(userId, reply.text, { format: 'html', disable_link_preview: true, attachments });

		if (!reply.image) {
			await sendWith([]);
			return;
		}

		// Сохраненный токен картинки мог устареть: перезагружаем и, если не вышло, отправляем без картинки
		try {
			await sendWith([await uploadImage(reply.image)]);
		} catch (error) {
			logger.warn('Send with cached image failed, re-uploading', { image: reply.image, error: errorMessage(error) });

			try {
				await sendWith([await uploadImage(reply.image, true)]);
			} catch (retryError) {
				logger.error('Image send failed, sending text only', { image: reply.image, error: errorMessage(retryError) });
				await sendWith([]);
			}
		}
	};

	const send = async (userId: number, replies: Reply[]) => {
		for (const reply of replies) {
			await sendReply(userId, reply);

			// Файл отдельным сообщением после текста
			if (reply.file) {
				try {
					await bot.api.sendMessageToUser(userId, '', { attachments: [await uploadFile(reply.file.path, reply.file.name)] });
				} catch (error) {
					logger.error('File send failed', { file: reply.file.path, error: errorMessage(error) });
				}
			}
		}
	};

	const handle = async (user: MaxUser, input: DialogInput) => {
		const dialogUser = toDialogUser(user);

		// Учет подписчиков не должен задерживать ответ
		void hooks.onUser?.(dialogUser).catch(error =>
			logger.error('Subscriber update failed', { userId: dialogUser.id, error: errorMessage(error) }));

		await send(user.user_id, await engine.handle(dialogUser, input));
	};

	const dispatch = (user: MaxUser | null | undefined, input: DialogInput): Promise<void> => {
		if (!user || user.is_bot) {
			return Promise.resolve();
		}

		const previous = queues.get(user.user_id) ?? Promise.resolve();
		const next = previous
			.then(() => handle(user, input))
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

	bot.on('bot_started', ctx => dispatch(ctx.user, { type: 'start' }));

	bot.on('message_created', async ctx => {
		const message = ctx.message;

		// Иногда Bot API присылает пустой message_created. В групповых чатах и каналах бот не отвечает
		if (!message || message.recipient.chat_type !== 'dialog') {
			return;
		}

		const text = message.body.text?.trim();

		await dispatch(message.sender, text ? { type: 'text', text } : { type: 'start' });
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
