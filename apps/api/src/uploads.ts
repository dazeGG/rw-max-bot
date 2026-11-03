// Картинки и файлы разделов. Имя файла — хеш содержимого: он никогда не перезаписывается и не удаляется,
// поэтому возврат к старой версии контента не приводит к битой ссылке.
// Лежат в media/uploads: на сервере это том, общий с ботом, который отправляет их пассажирам

import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { UploadKind, UploadResult } from '@rw/core';
import { repoPath } from '@rw/runtime';

import { RuleError } from './errors';

const MEDIA_DIR = repoPath('media');
const UPLOADS_DIR = 'uploads';

const MEGABYTE = 1024 * 1024;

export const UPLOAD_LIMITS: Record<UploadKind, number> = {
	image: 10 * MEGABYTE,
	file: 50 * MEGABYTE,
};

const FILE_NAME_LIMIT = 200;

// Форматы, которые принимает MAX и показывает браузер в предпросмотре. SVG нельзя: это код, а не картинка
const IMAGE_SIGNATURES: [string, number[]][] = [
	['jpg', [0xFF, 0xD8, 0xFF]],
	['png', [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
	['gif', [0x47, 0x49, 0x46, 0x38]],
];

const IMAGE_EXTENSIONS = new Set(IMAGE_SIGNATURES.map(([extension]) => extension));

// Файлы получают пассажиры: только документы и архивы, без исполняемых
const FILE_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'rtf', 'txt', 'csv', 'zip', 'jpg', 'jpeg', 'png']);

const IMAGE_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
};

export const imageExtension = (head: Buffer): string | null =>
	IMAGE_SIGNATURES.find(([, signature]) => signature.every((byte, index) => head[index] === byte))?.[0] ?? null;

export const fileExtension = (name: string): string | null => {
	const extension = path.extname(name).slice(1).toLowerCase();
	return FILE_EXTENSIONS.has(extension) ? extension : null;
};

// Имя видит пассажир, и бот создает файл с таким именем: разделителей пути и служебных символов в нем быть не должно
export const fileNameError = (name: string): string | null => {
	if (!name.trim() || name.length > FILE_NAME_LIMIT) {
		return `Имя файла должно быть от 1 до ${FILE_NAME_LIMIT} символов`;
	}

	if (/[/\\:*?"<>|\u0000-\u001F]/.test(name) || name.startsWith('.')) {
		return 'В имени файла недопустимые символы';
	}

	return fileExtension(name) ? null : `Такой тип файла нельзя загрузить. Можно: ${[...FILE_EXTENSIONS].join(', ')}`;
};

const tooLarge = (kind: UploadKind) => new RuleError(413, `Файл больше ${UPLOAD_LIMITS[kind] / MEGABYTE} МБ`);

export const assertUploadSize = (kind: UploadKind, size: number) => {
	if (size > UPLOAD_LIMITS[kind]) {
		throw tooLarge(kind);
	}
};

// Пишем во временный файл рядом с итоговым: в том же томе переименование атомарно, и бот не увидит половину файла
export const saveUpload = async (kind: UploadKind, name: string, source: Readable, root = MEDIA_DIR, folder = UPLOADS_DIR): Promise<UploadResult> => {
	const dir = path.join(root, folder);
	const temporary = path.join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
	const hash = createHash('sha256');
	let size = 0;
	let head = Buffer.alloc(0);

	const meter = new Transform({
		transform (chunk: Buffer, _encoding, done) {
			size += chunk.length;

			if (size > UPLOAD_LIMITS[kind]) {
				done(tooLarge(kind));
				return;
			}

			if (head.length < 16) {
				head = Buffer.concat([head, chunk]).subarray(0, 16);
			}

			hash.update(chunk);
			done(null, chunk);
		},
	});

	await fs.mkdir(dir, { recursive: true });

	try {
		await pipeline(source, meter, createWriteStream(temporary));

		if (size === 0) {
			throw new RuleError(400, 'Файл пустой');
		}

		const extension = kind === 'image' ? imageExtension(head) : fileExtension(name);

		if (!extension) {
			throw new RuleError(400, 'Это не картинка: можно загрузить JPG, PNG или GIF');
		}

		const relative = `${folder}/${hash.digest('hex')}.${extension}`;

		await fs.rename(temporary, path.join(root, relative));

		return { path: relative, name, size };
	} finally {
		await fs.rm(temporary, { force: true });
	}
};

const UPLOADED_PATH = /^uploads\/[0-9a-f]{64}\.([a-z]+)$/;

// Ссылаться можно только на то, что загружено через админку: иначе правкой раздела можно было бы отправить пассажиру любой файл
export const uploadedPathError = async (kind: UploadKind, value: string, root = MEDIA_DIR): Promise<string | null> => {
	const extension = UPLOADED_PATH.exec(value)?.[1];

	if (!extension || !(kind === 'image' ? IMAGE_EXTENSIONS : FILE_EXTENSIONS).has(extension)) {
		return kind === 'image' ? 'Картинка указана неверно' : 'Файл указан неверно';
	}

	try {
		await fs.access(path.join(root, value));
		return null;
	} catch {
		return 'Файл не найден. Загрузите его заново';
	}
};

// Путь из контента не должен выходить за папку media (например, «../.env»)
export const mediaFile = async (relative: string, root = MEDIA_DIR) => {
	const absolute = path.resolve(root, relative);

	if (!absolute.startsWith(path.resolve(root) + path.sep)) {
		return null;
	}

	try {
		const stat = await fs.stat(absolute);

		if (!stat.isFile()) {
			return null;
		}

		// В браузере открываются только картинки, остальное скачивается: чужой файл не выполнится в админке
		return { absolute, size: stat.size, type: IMAGE_TYPES[path.extname(absolute).toLowerCase()] ?? null };
	} catch {
		return null;
	}
};
