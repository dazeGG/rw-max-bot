import { afterEach, describe, expect, it, vi } from 'vitest';

import { notifyBotContentChanged } from './content-notifier';

afterEach(() => vi.unstubAllGlobals());

describe('сигнал обновления контента бота', () => {
	it('отправляет защищенный POST и возвращает подтвержденную версию', async () => {
		const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, version: 'new-version' }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(notifyBotContentChanged('http://bot:3002/', 'secret')).resolves.toEqual({ ok: true, version: 'new-version' });
		expect(fetchMock).toHaveBeenCalledWith('http://bot:3002/internal/content/refresh', {
			method: 'POST',
			headers: { authorization: 'Bearer secret' },
			signal: expect.any(AbortSignal),
		});
	});

	it('не подтверждает обновление при ошибке бота', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

		await expect(notifyBotContentChanged('http://bot:3002', 'secret')).rejects.toThrow('responded 503');
	});

	it('не считает некорректный ответ подтверждением', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));

		await expect(notifyBotContentChanged('http://bot:3002', 'secret')).rejects.toThrow('invalid confirmation');
	});

	it('передает ошибку соединения вызывающему коду', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

		await expect(notifyBotContentChanged('http://bot:3002', 'secret')).rejects.toThrow('Connection refused');
	});

	it('ограничивает ожидание сигнала десятью секундами', async () => {
		const timeout = vi.spyOn(AbortSignal, 'timeout');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true, version: 'v1' })));

		try {
			await notifyBotContentChanged('http://bot:3002', 'secret');
			expect(timeout).toHaveBeenCalledWith(10_000);
		} finally {
			timeout.mockRestore();
		}
	});
});
