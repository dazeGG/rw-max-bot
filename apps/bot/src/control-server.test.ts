import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createControlServer } from './control-server';

describe('internal content refresh server', () => {
	const servers: ReturnType<typeof createControlServer>[] = [];
	afterEach(async () => {
		await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
			server.close(error => error ? reject(error) : resolve());
			server.closeAllConnections();
		})));
	});
	const setup = async (reload = vi.fn(async () => 'version-2')) => {
		const server = createControlServer('test-secret', reload);
		servers.push(server);
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/internal/content/refresh`;
		return { url, reload };
	};
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
