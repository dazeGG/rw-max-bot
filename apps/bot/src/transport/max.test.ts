import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DialogEngine, DialogResult, SupportInboundResult, SupportStatus, UploadKind } from '@rw/core';

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

describe('MAX staff link', () => {
	const engine = () => {
		const process = vi.fn(async () => result);
		return { process, engine: { process } as unknown as DialogEngine };
	};
	const started = (startPayload: string | null) => ({
		user: { user_id: 7, first_name: 'Иван', is_bot: false },
		startPayload,
		update: { update_type: 'bot_started', timestamp: Date.now(), payload: startPayload },
	});

	it('links by the code from the link and does not start a dialog', async () => {
		const { process, engine: dialog } = engine();
		const linkStaff = vi.fn(async () => ({ status: 'linked' as const, fullName: 'Иван Иванов' }));
		const onEvent = vi.fn();
		const { drain } = createMaxBot('test-token', dialog, { linkStaff, onEvent });

		await handlers.get('bot_started')!(started('staff_secret-code'));
		await drain();

		expect(linkStaff).toHaveBeenCalledWith({ code: 'secret-code', userId: 7 });
		expect(sendMessageToUser).toHaveBeenCalledWith(7, 'Профиль привязан: Иван Иванов.');
		expect(process).not.toHaveBeenCalled();
		expect(onEvent).not.toHaveBeenCalled();
	});

	it('explains why the link did not work', async () => {
		const linkStaff = vi.fn(async () => ({ status: 'taken' as const }));
		createMaxBot('test-token', engine().engine, { linkStaff });

		await handlers.get('bot_started')!(started('staff_secret-code'));

		expect(sendMessageToUser).toHaveBeenCalledWith(7, 'Этот профиль MAX уже привязан к другому сотруднику.');
	});

	it('answers when the API is down', async () => {
		const linkStaff = vi.fn(async () => {
			throw new Error('API is down');
		});
		createMaxBot('test-token', engine().engine, { linkStaff });

		await handlers.get('bot_started')!(started('staff_secret-code'));

		expect(sendMessageToUser).toHaveBeenCalledWith(7, 'Не удалось привязать профиль. Попробуйте, пожалуйста, ещё раз.');
	});

	it('starts a normal dialog for any other start', async () => {
		for (const payload of [null, 'test123']) {
			const { process, engine: dialog } = engine();
			const linkStaff = vi.fn();
			const { drain } = createMaxBot('test-token', dialog, { linkStaff });

			await handlers.get('bot_started')!(started(payload));
			await drain();

			expect(linkStaff).not.toHaveBeenCalled();
			expect(process).toHaveBeenCalledOnce();
		}
	});
});

describe('MAX support routing', () => {
	const engineWith = (answer: DialogResult = result) => {
		const process = vi.fn(async () => answer);
		return { process, engine: { process } as unknown as DialogEngine };
	};
	const transport = (status: SupportStatus | null = 'active', inbound: SupportInboundResult = { action: 'stored' }) => ({
		openSupportTicket: vi.fn(async () => 'Передали в поддержку'),
		supportStatus: vi.fn(async () => status),
		sendSupportInbound: vi.fn(async () => inbound),
		uploadSupportFile: vi.fn(async (_kind: UploadKind, name: string) => ({ path: 'uploads/support/a.png', name, size: 3 })),
	});
	const withAttachments = (attachments: unknown[], text = '') => {
		const { message, update } = incoming();
		const changed = { ...message, body: { text, mid: 'incoming-2', attachments } };
		return { message: changed, update: { ...update, message: changed } };
	};
	const run = async (engine: DialogEngine, support: ReturnType<typeof transport>, context: unknown = incoming(), onEvent = vi.fn()) => {
		const { drain } = createMaxBot('test-token', engine, { support, onEvent });
		await dispatchMessage(context);
		await drain();
		return onEvent;
	};

	afterEach(() => vi.unstubAllGlobals());

	it('answers with the bot when there is no open ticket', async () => {
		const { engine, process } = engineWith();
		const support = transport(null);
		await run(engine, support);

		expect(process).toHaveBeenCalledOnce();
		expect(support.sendSupportInbound).not.toHaveBeenCalled();
		expect(sendMessageToUser).toHaveBeenCalledOnce();
	});

	it('stays silent while a ticket is open and passes the message to staff', async () => {
		const { engine, process } = engineWith();
		const support = transport();
		const onEvent = await run(engine, support);

		expect(process).not.toHaveBeenCalled();
		expect(sendMessageToUser).not.toHaveBeenCalled();
		expect(support.sendSupportInbound).toHaveBeenCalledExactlyOnceWith({ userId: 42, text: 'Где купить билет?', mid: 'incoming-1', attachments: [], start: false });
		expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'support_message', userId: 42 }));
	});

	it('tells the passenger about a cancellation and shows the menu', async () => {
		const { engine, process } = engineWith();
		await run(engine, transport('queue', { action: 'cancelled', text: 'Обращение отменено.' }));

		expect(sendMessageToUser.mock.calls.map(call => (call as unknown[])[1])).toEqual(['Обращение отменено.', result.replies[0].text]);
		expect(process).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }), { type: 'text', text: 'меню' });
	});

	it('falls back to the bot when the ticket closed in the meantime', async () => {
		const { engine, process } = engineWith();
		await run(engine, transport('active', { action: 'none' }));

		expect(process).toHaveBeenCalledOnce();
	});

	it('keeps answering with the bot when the API is down', async () => {
		const { engine, process } = engineWith();
		const support = transport();
		support.supportStatus.mockRejectedValue(new Error('API down'));
		await run(engine, support);

		expect(process).toHaveBeenCalledOnce();
		expect(sendMessageToUser.mock.calls[0]).toContain(result.replies[0].text);
	});

	it('tells the passenger when a message did not reach staff', async () => {
		const { engine, process } = engineWith();
		const support = transport();
		support.sendSupportInbound.mockRejectedValue(new Error('API down'));
		await run(engine, support);

		expect(process).not.toHaveBeenCalled();
		expect(sendMessageToUser).toHaveBeenCalledOnce();
		expect(sendMessageToUser.mock.calls[0]).toContain('Не удалось передать сообщение сотруднику. Попробуйте, пожалуйста, ещё раз');
	});

	it('opens a ticket when the passenger chooses the operator', async () => {
		const { engine } = engineWith({ replies: [], event: { type: 'operator', nodeId: 2, nodeCode: 'operator', text: '1', details: {} } });
		const support = transport(null);
		await run(engine, support);

		expect(support.openSupportTicket).toHaveBeenCalledOnce();
		expect(sendMessageToUser.mock.calls[0]).toContain('Передали в поддержку');
	});

	it('gives the phone number when a ticket cannot be opened', async () => {
		const { engine } = engineWith({ replies: [], event: { type: 'operator', nodeId: 2, nodeCode: 'operator', text: '1', details: {} } });
		const support = transport(null);
		support.openSupportTicket.mockRejectedValue(new Error('API down'));
		await run(engine, support);

		expect(String((sendMessageToUser.mock.calls[0] as unknown[])[1])).toContain('8 800 550 06 20');
	});

	it('streams photos and files to the API and describes everything else', async () => {
		const fetchMock = vi.fn(async () => new Response('png'));
		vi.stubGlobal('fetch', fetchMock);
		const { engine } = engineWith();
		const support = transport();
		await run(engine, support, withAttachments([
			{ type: 'image', payload: { url: 'https://max.test/1', token: 't', photo_id: 1 } },
			{ type: 'file', filename: 'Билет.pdf', size: 3, payload: { url: 'https://max.test/2', token: 't' } },
			{ type: 'video', payload: { url: 'https://max.test/3', token: 't' } },
			{ type: 'sticker', payload: { url: 'https://max.test/4', code: 'c' } },
			{ type: 'inline_keyboard', payload: {} },
		]));

		expect(fetchMock.mock.calls.map(call => (call as unknown[])[0])).toEqual(['https://max.test/1', 'https://max.test/2']);
		expect(support.uploadSupportFile.mock.calls.map(call => [call[0], call[1]])).toEqual([['image', 'Фото'], ['file', 'Билет.pdf']]);
		expect(support.sendSupportInbound).toHaveBeenCalledWith(expect.objectContaining({
			start: false,
			attachments: [
				{ kind: 'image', path: 'uploads/support/a.png', name: 'Фото', size: 3 },
				{ kind: 'file', path: 'uploads/support/a.png', name: 'Билет.pdf', size: 3 },
				{ kind: 'unavailable', path: '', name: expect.stringContaining('видео') as string },
				{ kind: 'unavailable', path: '', name: expect.stringContaining('стикер') as string },
			],
		}));
	});

	it('keeps the message when an attachment cannot be fetched or saved', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
		const { engine } = engineWith();
		const support = transport();
		await run(engine, support, withAttachments([{ type: 'file', filename: 'virus.exe', size: 3, payload: { url: 'https://max.test/2', token: 't' } }], 'Смотрите файл'));

		expect(support.sendSupportInbound).toHaveBeenCalledWith(expect.objectContaining({
			text: 'Смотрите файл',
			attachments: [{ kind: 'unavailable', path: '', name: 'Не удалось получить вложение: virus.exe' }],
		}));
	});

	it('marks a bot restart and an empty message as a start', async () => {
		const { engine } = engineWith();
		const support = transport();
		await run(engine, support, withAttachments([]));

		expect(support.sendSupportInbound).toHaveBeenCalledWith(expect.objectContaining({ start: true, text: '' }));
	});

	it('sends a staff reply with markup escaped and without a name', async () => {
		const { sendSupport } = createMaxBot('test-token', engineWith().engine, {});

		expect(await sendSupport({ userId: 7, text: 'Цена <b> & 5', attachments: [] })).toEqual({ ok: true });
		expect(sendMessageToUser).toHaveBeenCalledExactlyOnceWith(7, '<b>Служба поддержки</b>\nЦена &lt;b&gt; &amp; 5', { format: 'html', disable_link_preview: true, attachments: [] });
	});

	it('sends a service text as it is', async () => {
		const { sendSupport } = createMaxBot('test-token', engineWith().engine, {});

		await sendSupport({ userId: 7, text: '<b>Обращение</b> закрыто', attachments: [], notice: true });
		expect(sendMessageToUser).toHaveBeenCalledExactlyOnceWith(7, '<b>Обращение</b> закрыто', { format: 'html', disable_link_preview: true, attachments: [] });
	});

	it('reports a blocked passenger', async () => {
		sendMessageToUser.mockRejectedValueOnce(new Error('chat.denied'));
		const { sendSupport } = createMaxBot('test-token', engineWith().engine, {});

		expect(await sendSupport({ userId: 7, text: 'Ответ', attachments: [] })).toEqual({ ok: false, error: 'chat.denied' });
	});

	it('does not report success when an attachment was lost', async () => {
		const { sendSupport } = createMaxBot('test-token', engineWith().engine, {});

		expect((await sendSupport({ userId: 7, text: 'Ответ', attachments: [{ kind: 'image', path: 'нет/такого.png', name: 'a.png' }] })).ok).toBe(false);
		expect((await sendSupport({ userId: 7, text: '', attachments: [{ kind: 'file', path: 'нет/такого.pdf', name: 'a.pdf' }] })).ok).toBe(false);
	});
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
