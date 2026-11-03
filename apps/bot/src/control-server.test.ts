import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SearchCheckResult } from '@rw/core';

import { createControlServer } from './control-server';

describe('internal content refresh server', () => {
	const servers: ReturnType<typeof createControlServer>[] = [];
	afterEach(async () => {
		await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
			server.close(error => error ? reject(error) : resolve());
			server.closeAllConnections();
		})));
	});
	const setup = async (reload = vi.fn(async () => 'version-2'), check = vi.fn(async (): Promise<SearchCheckResult> => ({ kind: 'none' }))) => {
		const server = createControlServer('test-secret', reload, check);
		servers.push(server);
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/content/refresh`;
		return { url, reload, check, checkUrl: url.replace('content/refresh', 'search/check') };
	};
	const post = (url: string, body: string, authorization = 'Bearer test-secret') => fetch(url, { method: 'POST', headers: { authorization }, body });

	it('answers a search check and asks only for the given text', async () => {
		const { checkUrl, check } = await setup(undefined, vi.fn(async (): Promise<SearchCheckResult> => ({ kind: 'answer', node: { id: 7, title: 'Возврат' } })));
		const response = await post(checkUrl, JSON.stringify({ text: 'как вернуть билет' }));
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ kind: 'answer', node: { id: 7, title: 'Возврат' } });
		expect(check).toHaveBeenCalledExactlyOnceWith('как вернуть билет');
	});
	it('does not run a search check without auth', async () => {
		const { checkUrl, check } = await setup();
		expect((await post(checkUrl, JSON.stringify({ text: 'вопрос' }), 'Bearer wrong')).status).toBe(401);
		expect(check).not.toHaveBeenCalled();
	});
	it('rejects a bad search check request without searching', async () => {
		const { checkUrl, check } = await setup();
		for (const body of ['', 'не json', '{}', JSON.stringify({ text: '   ' }), JSON.stringify({ text: 5 }), JSON.stringify({ text: 'я'.repeat(1001) }), JSON.stringify({ text: 'я'.repeat(20_000) })]) {
			expect((await post(checkUrl, body)).status, body.slice(0, 20)).toBe(400);
		}
		expect(check).not.toHaveBeenCalled();
	});
	it('reports a failed search check', async () => {
		const { checkUrl } = await setup(undefined, vi.fn(async (): Promise<SearchCheckResult> => {
			throw new Error('model failed');
		}));
		expect((await post(checkUrl, JSON.stringify({ text: 'вопрос' }))).status).toBe(503);
	});
	it('rejects missing or incorrect auth without reloading', async () => {
		const { url, reload } = await setup();
		for (const authorization of ['', 'Bearer wrong']) {
			expect((await fetch(url, { method: 'POST', headers: { authorization } })).status).toBe(401);
		}
		expect(reload).not.toHaveBeenCalled();
	});
	it('returns the applied version only after reload succeeds', async () => {
		const { url, reload } = await setup();
		const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer test-secret' } });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, version: 'version-2' });
		expect(reload).toHaveBeenCalledOnce();
	});
	it('does not report success when refresh fails', async () => {
		const { url } = await setup(vi.fn(async () => {
			throw new Error('API unavailable');
		}));
		const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer test-secret' } });
		expect(response.status).toBe(503);
	});
	it('rejects other paths and methods', async () => {
		const { url, reload } = await setup();
		const headers = { authorization: 'Bearer test-secret' };
		expect((await fetch(url, { headers })).status).toBe(405);
		expect((await fetch(`${url}/wrong`, { method: 'POST', headers })).status).toBe(404);
		expect(reload).not.toHaveBeenCalled();
	});
});
