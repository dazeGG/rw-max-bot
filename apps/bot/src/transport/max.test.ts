import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DialogEngine, DialogResult } from '@rw/core';

import { createMaxBot } from './max';

const { handlers, botCreated, sendMessageToUser, useMock, catchMock } = vi.hoisted(() => ({
	handlers: new Map<string, (context: unknown) => Promise<void>>(),
	botCreated: vi.fn(),
	sendMessageToUser: vi.fn(async () => undefined),
	useMock: vi.fn(),
	catchMock: vi.fn(),
}));

vi.mock('@maxhub/max-bot-api', () => ({
	Bot: class {
		api = { sendMessageToUser };
		constructor (token: string) {
			botCreated(token);
		}
		on (event: string, handler: (context: unknown) => Promise<void>) {
			handlers.set(event, handler);
		}
		use (handler: unknown) {
			useMock(handler);
		}
		catch (handler: unknown) {
			catchMock(handler);
		}
	},
}));
vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const incoming = (chatType = 'dialog') => {
	const message = {
		sender: { user_id: 42, first_name: 'Тест', username: 'tester', is_bot: false },
		recipient: { chat_type: chatType },
		body: { text: '  Где купить билет?  ', mid: 'incoming-1', attachments: [] },
	};
	return { message, update: { update_type: 'message_created', timestamp: Date.now(), message } };
};
const result: DialogResult = {
	replies: [{ text: 'Билеты можно купить онлайн.' }],
	event: { type: 'answer', nodeId: 2, nodeCode: 'buy', text: 'Где купить билет?', details: {} },
};
const dispatchMessage = (context: unknown) => handlers.get('message_created')!(context);

beforeEach(() => {
	vi.clearAllMocks();
	handlers.clear();
});

describe('MAX semantic transport', () => {
	it('records the version captured before async search even when content refreshes during processing', async () => {
		let started!: () => void;
		let finish!: (value: DialogResult) => void;
		const processing = new Promise<void>(resolve => {
			started = resolve;
		});
		const pending = new Promise<DialogResult>(resolve => {
			finish = resolve;
		});
		const process = vi.fn(async () => {
			started();
			return pending;
		});
		const engine = { process } as unknown as DialogEngine;
		let version = 'v1';
		const getContentVersion = vi.fn(() => version);
		const onEvent = vi.fn();
		const { drain } = createMaxBot('test-token', engine, { getContentVersion, onEvent, revision: 'test-revision' });
		const delivery = dispatchMessage(incoming());
		await processing;
		version = 'v2';
		finish(result);
		await delivery;
		await drain();

		expect(botCreated).toHaveBeenCalledWith('test-token');
		expect(useMock).toHaveBeenCalledOnce();
		expect(catchMock).toHaveBeenCalledOnce();
		expect(process).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), { type: 'text', text: 'Где купить билет?' });
		expect(sendMessageToUser).toHaveBeenCalledWith(42, result.replies[0].text, {
			format: 'html', disable_link_preview: true, attachments: [],
		});
		expect(getContentVersion).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
			type: 'answer',
			contentVersion: 'v1',
			nodeCode: 'buy',
			data: expect.objectContaining({ messageId: 'incoming-1', channel: 'max', revision: 'test-revision' }),
		}));
	});

	it('sends a friendly retry/menu instruction and records search failure without lexical fallback', async () => {
		let started!: () => void;
		let fail!: (reason: Error) => void;
		const processing = new Promise<void>(resolve => {
			started = resolve;
		});
		const pending = new Promise<DialogResult>((_, reject) => {
			fail = reject;
		});
		const process = vi.fn(async () => {
			started();
			return pending;
		});
		let version = 'v1';
		const onEvent = vi.fn();
		const { drain } = createMaxBot('test-token', { process } as unknown as DialogEngine, {
			getContentVersion: () => version,
			onEvent,
		});
		const context = incoming();
		const delivery = dispatchMessage(context);
		await processing;
		version = 'v2';
		fail(new Error('E5 encoder unavailable'));
		await delivery;
		await drain();

		expect(process).toHaveBeenCalledOnce();
		expect(sendMessageToUser).toHaveBeenCalledOnce();
		expect(sendMessageToUser).toHaveBeenCalledWith(42, expect.stringMatching(/Попробуйте ещё раз.*меню.*номер/));
		expect(onEvent).toHaveBeenCalledOnce();
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
			userId: 42,
			type: 'search_failed',
			contentVersion: 'v1',
			nodeId: null,
			nodeCode: null,
			text: 'Где купить билет?',
			raw: context.update,
			data: expect.objectContaining({ error: 'E5 encoder unavailable', updateType: 'message_created' }),
		}));
	});

	it.each(['chat', 'channel'])('ignores incoming %s messages instead of running semantic search', async chatType => {
		const process = vi.fn(async () => result);
		const onEvent = vi.fn();
		createMaxBot('test-token', { process } as unknown as DialogEngine, { onEvent });
		await dispatchMessage(incoming(chatType));
		expect(process).not.toHaveBeenCalled();
		expect(sendMessageToUser).not.toHaveBeenCalled();
		expect(onEvent).not.toHaveBeenCalled();
	});
});
