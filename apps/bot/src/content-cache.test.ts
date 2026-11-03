import { afterEach, describe, expect, it, vi } from 'vitest';

import { flattenSeed, SEED_SETTINGS } from '@rw/core';
import type { ContentTree } from '@rw/core';

import { ApiClient } from './api-client';
import { ContentCache } from './content-cache';

describe('content cache refresh', () => {
	afterEach(() => {
		vi.restoreAllMocks(); vi.useRealTimers();
	});
	const setup = async (prepare?: (tree: ContentTree) => Promise<void>) => {
		const api = new ApiClient('http://unused', 'secret');
		const snapshot = { nodes: flattenSeed(), settings: SEED_SETTINGS, version: 'v1' };
		const getContent = vi.spyOn(api, 'getContent').mockResolvedValue(snapshot);
		const cache = new ContentCache(api, prepare);
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
	it('hides the operator items until the support chat is enabled', async () => {
		const api = new ApiClient('http://unused', 'secret');
		vi.spyOn(api, 'getContent').mockResolvedValue({ nodes: flattenSeed(), settings: SEED_SETTINGS, version: 'v1' });
		const hidden = new ContentCache(api);
		const enabled = new ContentCache(api, undefined, true);
		await Promise.all([hidden.init(300), enabled.init(300)]);

		expect(hidden.get().getByCode('operator')).toBeUndefined();
		expect(hidden.get().getByCode('operator-menu')).toBeUndefined();
		expect(hidden.get().getByCode('support')).toBeDefined();
		expect(enabled.get().getByCode('operator')).toBeDefined();
		expect(enabled.get().getByCode('operator-menu')).toBeDefined();
		hidden.stop();
		enabled.stop();
	});
	it('propagates signal failure and preserves the old tree', async () => {
		const { cache, getContent } = await setup();
		const tree = cache.get();
		getContent.mockRejectedValue(new Error('offline'));
		await expect(cache.reload()).rejects.toThrow('offline');
		expect(cache.get()).toBe(tree);
		cache.stop();
	});
	it('waits for model preparation before publishing initial content', async () => {
		let ready!: () => void;
		let started!: () => void;
		const pending = new Promise<void>(resolve => {
			ready = resolve;
		});
		const preparing = new Promise<void>(resolve => {
			started = resolve;
		});
		const prepare = vi.fn(async () => {
			started();
			await pending;
		});
		const api = new ApiClient('http://unused', 'secret');
		vi.spyOn(api, 'getContent').mockResolvedValue({ nodes: flattenSeed(), settings: SEED_SETTINGS, version: 'v1' });
		const cache = new ContentCache(api, prepare);
		const initializing = cache.init(300);
		await preparing;
		expect(cache.currentVersion()).toBeNull();
		expect(() => cache.get()).toThrow('Content is not loaded');
		ready();
		await initializing;
		expect(cache.currentVersion()).toBe('v1');
		expect(prepare).toHaveBeenCalledWith(cache.get());
		cache.stop();
	});
	it('keeps serving old content while a replacement model index is pending', async () => {
		let ready!: () => void;
		let started!: () => void;
		const pending = new Promise<void>(resolve => {
			ready = resolve;
		});
		const preparing = new Promise<void>(resolve => {
			started = resolve;
		});
		const prepare = vi.fn<(tree: ContentTree) => Promise<void>>(async () => undefined);
		const { cache, getContent, snapshot } = await setup(prepare);
		const oldTree = cache.get();
		prepare.mockImplementationOnce(async () => {
			started();
			await pending;
		});
		getContent.mockResolvedValue({ ...snapshot, version: 'v2' });
		const refreshing = cache.reload();
		await preparing;
		expect(cache.get()).toBe(oldTree);
		expect(cache.currentVersion()).toBe('v1');
		ready();
		await refreshing;
		expect(cache.get()).not.toBe(oldTree);
		expect(cache.currentVersion()).toBe('v2');
		cache.stop();
	});
	it('preserves content and version on preparation failure and retries the same update', async () => {
		const prepare = vi.fn<(tree: ContentTree) => Promise<void>>(async () => undefined);
		const { cache, getContent, snapshot } = await setup(prepare);
		const oldTree = cache.get();
		getContent.mockResolvedValue({ ...snapshot, version: 'v2' });
		prepare.mockRejectedValueOnce(new Error('index unavailable'));
		await expect(cache.reload()).rejects.toThrow('index unavailable');
		expect(cache.get()).toBe(oldTree);
		expect(cache.currentVersion()).toBe('v1');
		await cache.reload();
		expect(getContent).toHaveBeenLastCalledWith('v1');
		expect(cache.currentVersion()).toBe('v2');
		expect(prepare).toHaveBeenCalledTimes(3);
		cache.stop();
	});
});
