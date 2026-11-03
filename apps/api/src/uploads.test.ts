import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RuleError } from './errors';
import { fileExtension, fileNameError, imageExtension, mediaFile, saveUpload, UPLOAD_LIMITS, uploadedPathError } from './uploads';

const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);
const GIF = Buffer.from('GIF89a-content');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('тип загрузки', () => {
	it('картинка определяется по содержимому, а не по имени', () => {
		expect(imageExtension(PNG)).toBe('png');
		expect(imageExtension(JPEG)).toBe('jpg');
		expect(imageExtension(GIF)).toBe('gif');
		expect(imageExtension(SVG)).toBeNull();
		expect(imageExtension(Buffer.from('MZ'))).toBeNull();
		expect(imageExtension(Buffer.alloc(0))).toBeNull();
	});

	it('файл определяется по расширению из разрешенного списка', () => {
		expect(fileExtension('Правила.PDF')).toBe('pdf');
		expect(fileExtension('tariffs.xlsx')).toBe('xlsx');
		expect(fileExtension('virus.exe')).toBeNull();
		expect(fileExtension('script.pdf.js')).toBeNull();
		expect(fileExtension('без расширения')).toBeNull();
	});

	it.each([
		['../../.env.pdf'],
		['..\\..\\evil.pdf'],
		['/etc/passwd.pdf'],
		['a/b.pdf'],
		['C:evil.pdf'],
		['.hidden.pdf'],
		['перенос\nстроки.pdf'],
		['  '],
		['virus.exe'],
		[`${'а'.repeat(200)}.pdf`],
	])('имя файла %j не принимается', name => {
		expect(fileNameError(name)).not.toBeNull();
	});

	it('обычное имя принимается', () => {
		expect(fileNameError('Правила перевозки (2026).pdf')).toBeNull();
	});
});

describe('сохранение', () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'rw-uploads-'));
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	const stored = () => fs.readdir(path.join(root, 'uploads'));

	it('имя файла — хеш содержимого, повторная загрузка не создает копию', async () => {
		const first = await saveUpload('image', 'a.png', Readable.from([PNG]), root);
		const second = await saveUpload('image', 'совсем другое имя.png', Readable.from([PNG.subarray(0, 4), PNG.subarray(4)]), root);

		expect(first.path).toMatch(/^uploads\/[0-9a-f]{64}\.png$/);
		expect(second.path).toBe(first.path);
		expect(first.size).toBe(PNG.length);
		expect(await stored()).toHaveLength(1);
		expect(await fs.readFile(path.join(root, first.path))).toEqual(PNG);
	});

	it('расширение картинки берется из содержимого, а не из имени', async () => {
		expect((await saveUpload('image', 'photo.png', Readable.from([JPEG]), root)).path).toMatch(/\.jpg$/);
	});

	it('начало картинки распознается и при маленьких кусках', async () => {
		const chunks = [...PNG].map(byte => Buffer.from([byte]));

		expect((await saveUpload('image', 'a.png', Readable.from(chunks), root)).path).toMatch(/\.png$/);
	});

	it('не картинка отклоняется и не оставляет следов', async () => {
		await expect(saveUpload('image', 'a.svg', Readable.from([SVG]), root)).rejects.toThrow(RuleError);
		expect(await stored()).toEqual([]);
	});

	it('пустой файл отклоняется', async () => {
		await expect(saveUpload('file', 'a.pdf', Readable.from([Buffer.alloc(0)]), root)).rejects.toThrow('пустой');
		expect(await stored()).toEqual([]);
	});

	it('слишком большой файл обрывается на лимите и не оставляет следов', async () => {
		const chunk = Buffer.alloc(1024 * 1024);
		let produced = 0;

		const endless = new Readable({
			read () {
				produced += chunk.length;
				this.push(produced > 500 * 1024 * 1024 ? null : chunk);
			},
		});

		await expect(saveUpload('image', 'a.png', endless, root)).rejects.toMatchObject({ statusCode: 413 });
		expect(produced).toBeLessThan(UPLOAD_LIMITS.image + 20 * 1024 * 1024);
		expect(await stored()).toEqual([]);
	});

	it('обрыв соединения не оставляет следов', async () => {
		const broken = new Readable({
			read () {
				this.destroy(new Error('соединение оборвано'));
			},
		});

		await expect(saveUpload('file', 'a.pdf', broken, root)).rejects.toThrow('оборвано');
		expect(await stored()).toEqual([]);
	});

	it('ссылаться можно только на загруженный файл нужного типа', async () => {
		const image = await saveUpload('image', 'a.png', Readable.from([PNG]), root);
		const file = await saveUpload('file', 'a.pdf', Readable.from([Buffer.from('%PDF')]), root);

		expect(await uploadedPathError('image', image.path, root)).toBeNull();
		expect(await uploadedPathError('file', file.path, root)).toBeNull();
		expect(await uploadedPathError('image', file.path, root)).not.toBeNull();
		expect(await uploadedPathError('image', `uploads/${'0'.repeat(64)}.png`, root)).toContain('не найден');

		for (const bad of ['../.env', 'uploads/../../.env', 'generated/tariffs.jpg', 'uploads/a.png', `uploads/${'0'.repeat(64)}.exe`, '']) {
			expect(await uploadedPathError('file', bad, root), bad).not.toBeNull();
		}
	});

	it('прочитать можно только файл внутри папки', async () => {
		const image = await saveUpload('image', 'a.png', Readable.from([PNG]), root);
		const file = await saveUpload('file', 'a.pdf', Readable.from([Buffer.from('%PDF')]), root);
		await fs.writeFile(path.join(root, '..', 'rw-secret-outside'), 'секрет');

		expect(await mediaFile(image.path, root)).toMatchObject({ size: PNG.length, type: 'image/png' });
		expect(await mediaFile(file.path, root)).toMatchObject({ type: null });
		expect(await mediaFile('../rw-secret-outside', root)).toBeNull();
		expect(await mediaFile('uploads', root), 'папка').toBeNull();
		expect(await mediaFile('нет-такого.png', root)).toBeNull();

		await fs.rm(path.join(root, '..', 'rw-secret-outside'));
	});
});
