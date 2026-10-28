import { afterEach, describe, expect, it, vi } from 'vitest';

import { flattenSeed, SEED_SETTINGS } from '@rw/core';

import { ApiClient } from './api-client';
import { ContentCache } from './content-cache';

describe('content cache refresh', () => {
	afterEach(() => {
		vi.restoreAllMocks(); vi.useRealTimers();
	});
	const setup = async () => {
		const api = new ApiClient('http://unused', 'secret');
		const snapshot = { nodes: flattenSeed(), settings: SEED_SETTINGS, version: 'v1' };
		const getContent = vi.spyOn(api, 'getContent').mockResolvedValue(snapshot);
		const cache = new ContentCache(api);
		await cache.init(300);
		return { cache, getContent, snapshot };
	};
	it('polls every five minutes and retains content on API failure', async () => {
		vi.useFakeTimers();
		const { cache, getContent } = await setup();
		getContent.mockRejectedValue(new Error('offline'));
		await vi.advanceTimersByTimeAsync(299_999);
		expect(getContent).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(getContent).toHaveBeenCalledTimes(2);
		expect(cache.currentVersion()).toBe('v1');
		cache.stop();
	});
	it('reloads after an already running request instead of losing the signal', async () => {
		const { cache, getContent, snapshot } = await setup();
		let finish!: (value: null) => void;
		getContent.mockImplementationOnce(() => new Promise(resolve => {
			finish = resolve;
		}));
		const background = cache.refresh();
		const signal = cache.reload();
		getContent.mockResolvedValue({ ...snapshot, version: 'v2' });
		finish(null);
		await Promise.all([background, signal]);
		expect(getContent).toHaveBeenCalledTimes(3);
		expect(cache.currentVersion()).toBe('v2');
		cache.stop();
	});
	it('propagates signal failure and preserves the old tree', async () => {
		const { cache, getContent } = await setup();
		const tree = cache.get();
		getContent.mockRejectedValue(new Error('offline'));
		await expect(cache.reload()).rejects.toThrow('offline');
		expect(cache.get()).toBe(tree);
		cache.stop();
	});
});
