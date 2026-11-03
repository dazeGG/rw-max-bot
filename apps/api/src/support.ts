// Обращения пассажиров. Пока обращение открыто, бот не отвечает сам: сообщения идут сотрудникам.
// Статусы: queue — ждет в очереди, active — в работе у сотрудника, closed — закрыто

import path from 'node:path';

import { and, asc, count, desc, eq, gte, inArray, lt, min, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { isSupportCancel, ROOT_CODE, supportOpenedText } from '@rw/core';
import type { AdminUser, DialogUser, SupportAttachment, SupportHistoryEntry, SupportInboundRequest, SupportInboundResult, SupportTicketDetail, SupportReason, SupportTicketSummary, SupportCounts, SupportStatus, SupportTab } from '@rw/core';
import { admins, contentNodes, db, dialogEvents, sessions, subscribers, supportMessages, supportTickets } from '@rw/db';
import { errorMessage } from '@rw/runtime';

import { config } from './config';
import { loadSettings } from './content';
import { sendToPassenger } from './content-notifier';
import { RuleError } from './errors';
import { logger } from './logger';
import { publish } from './support-hub';
import { mediaFile } from './uploads';

export const SUPPORT_FOLDER = 'uploads/support';

// Закрываем, только если последним писал сотрудник: иначе ответа ждет пассажир
const SILENCE_HOURS = 24;
const HISTORY_LIMIT = 10;
const HISTORY_HOURS = 24;
const LIST_LIMIT = 100;
// Какие сообщения пассажира относятся к этому обращению к оператору
const REASON_WINDOW_MS = 60 * 60 * 1000;

const isManager = (actor: AdminUser) => actor.role !== 'support';

const passengerName = (row: { firstName: string | null; lastName: string | null; userId: number; }) =>
	[row.firstName, row.lastName].filter(Boolean).join(' ') || `Пассажир ${row.userId}`;

const addSystemMessage = (tx: Pick<typeof db, 'insert'>, ticketId: number, text: string) =>
	tx.insert(supportMessages).values({ ticketId, sender: 'system', text });

// Сообщения бота перед обращением, от новых к старым. Оператор выбран следующим сообщением, поэтому
// уточнение прямо перед ним значит, что не подошел ни один вариант: другие пункты уточнения к оператору не ведут
export const ticketReason = (events: { type: string; data: Record<string, unknown>; }[]): { reason: SupportReason; misses: number; } => {
	const misses = events.filter(event => event.type === 'unrecognized').length;
	const [last] = events;

	if (last?.type === 'clarify' && 'handoff' in last.data) {
		return { reason: 'noOption', misses };
	}

	return { reason: misses > 0 ? 'unrecognized' : 'asked', misses };
};

const loadReason = async (userId: number, now: Date) => ticketReason(await db.select({ type: dialogEvents.type, data: dialogEvents.data })
	.from(dialogEvents)
	.where(and(eq(dialogEvents.userId, userId), gte(dialogEvents.createdAt, new Date(now.getTime() - REASON_WINDOW_MS))))
	.orderBy(desc(dialogEvents.createdAt), desc(dialogEvents.id))
	.limit(HISTORY_LIMIT));

// Обращение открывается при выборе «Написать оператору». Если оно уже открыто, второе не появится
export const openTicket = async (user: DialogUser, now = new Date()): Promise<string> => {
	const { reason, misses } = await loadReason(user.id, now);

	const [created] = await db.insert(supportTickets)
		.values({ userId: user.id, status: 'queue', openReason: reason, botMisses: misses })
		.onConflictDoNothing({ target: supportTickets.userId, where: sql`status <> 'closed'` })
		.returning();

	if (created) {
		publish({ ticketId: created.id, kind: 'queued', assigneeId: null });
	}

	return supportOpenedText(await loadSettings(db), now);
};

export const openStatus = async (userId: number): Promise<SupportStatus | null> => {
	const [row] = await db.select({ status: supportTickets.status }).from(supportTickets)
		.where(and(eq(supportTickets.userId, userId), ne(supportTickets.status, 'closed')));

	return row ? row.status as SupportStatus : null;
};

// Бот спрашивает здесь про каждое сообщение пассажира: отвечать самому или передать сотрудникам
export const receiveMessage = async ({ userId, text, mid, attachments, start }: SupportInboundRequest): Promise<SupportInboundResult> => {
	const outcome = await db.transaction(async tx => {
		const [ticket] = await tx.select().from(supportTickets)
			.where(and(eq(supportTickets.userId, userId), ne(supportTickets.status, 'closed')))
			.for('update');

		if (!ticket) {
			return { action: 'none' as const };
		}

		if (ticket.status === 'queue' && attachments.length === 0 && (start || isSupportCancel(text))) {
			await tx.update(supportTickets)
				.set({ status: 'closed', closedAt: new Date(), closeReason: 'passenger' })
				.where(eq(supportTickets.id, ticket.id));
			await addSystemMessage(tx, ticket.id, 'Пассажир отменил обращение');

			return { action: 'cancelled' as const, ticket };
		}

		// Перезапуск бота, пока обращение в работе: переписка продолжается, писать нечего
		if (start) {
			return { action: 'stored' as const };
		}

		// MAX может прислать одно и то же обновление повторно
		const [message] = await tx.insert(supportMessages)
			.values({ ticketId: ticket.id, sender: 'passenger', text, attachments, mid })
			.onConflictDoNothing({ target: supportMessages.mid, where: sql`mid is not null` })
			.returning({ id: supportMessages.id });

		if (message) {
			await tx.update(supportTickets)
				.set({ lastSender: 'passenger', lastMessageAt: new Date() })
				.where(eq(supportTickets.id, ticket.id));
		}

		return { action: 'stored' as const, ticket: message ? ticket : undefined };
	});

	if (outcome.action === 'cancelled') {
		publish({ ticketId: outcome.ticket.id, kind: 'changed', assigneeId: null });

		return { action: 'cancelled', text: (await loadSettings(db))['text.supportCancelled'] };
	}

	if (outcome.action === 'stored' && outcome.ticket) {
		publish({ ticketId: outcome.ticket.id, kind: 'message', assigneeId: outcome.ticket.assigneeId });
	}

	return { action: outcome.action };
};

const unansweredMessages = (value: SQL) => sql`
	select ${value} from support_messages m
	where m.ticket_id = support_tickets.id and m.sender = 'passenger' and m.id > coalesce((
		select max(s.id) from support_messages s where s.ticket_id = support_tickets.id and s.sender = 'staff'
	), 0)
`;

const summaryColumns = {
	id: supportTickets.id,
	userId: supportTickets.userId,
	status: supportTickets.status,
	assigneeId: supportTickets.assigneeId,
	assigneeName: admins.fullName,
	createdAt: supportTickets.createdAt,
	lastMessageAt: supportTickets.lastMessageAt,
	lastSender: supportTickets.lastSender,
	closedAt: supportTickets.closedAt,
	openReason: supportTickets.openReason,
	botMisses: supportTickets.botMisses,
	firstName: subscribers.firstName,
	lastName: subscribers.lastName,
	preview: sql<string | null>`(
		select case when m.text <> '' then m.text else 'Вложение' end
		from support_messages m
		where m.ticket_id = support_tickets.id and m.sender <> 'system'
		order by m.id desc limit 1
	)`,
	topic: sql<string | null>`(
		select m.text from support_messages m
		where m.ticket_id = support_tickets.id and m.sender = 'passenger' and m.text <> ''
		order by m.id limit 1
	)`,
	unanswered: sql<number>`(${unansweredMessages(sql`count(*)::int`)})`,
	// Драйвер отдает дату из подзапроса строкой
	waitingSince: sql<string | null>`(${unansweredMessages(sql`min(m.created_at)`)})`,
};

type SummaryRow = {
	id: number;
	userId: number;
	status: string;
	assigneeId: number | null;
	assigneeName: string | null;
	createdAt: Date;
	lastMessageAt: Date;
	lastSender: string | null;
	closedAt: Date | null;
	openReason: string | null;
	botMisses: number;
	firstName: string | null;
	lastName: string | null;
	preview: string | null;
	topic: string | null;
	unanswered: number;
	waitingSince: string | null;
};

const toSummary = (row: SummaryRow): SupportTicketSummary => ({
	id: row.id,
	status: row.status as SupportStatus,
	passenger: passengerName(row),
	assigneeId: row.assigneeId,
	assigneeName: row.assigneeName,
	preview: row.preview,
	topic: row.topic,
	// Пассажир написал последним: ответа ждет он
	waiting: row.status !== 'closed' && row.lastSender !== 'staff',
	// Пока пассажир ничего не написал, он ждет с момента, когда выбрал оператора
	waitingSince: row.status === 'closed' || row.lastSender === 'staff' ? null : new Date(row.waitingSince ?? row.createdAt).toISOString(),
	unanswered: row.status === 'closed' ? 0 : row.unanswered,
	reason: row.openReason as SupportReason | null,
	botMisses: row.botMisses,
	createdAt: row.createdAt.toISOString(),
	lastMessageAt: row.lastMessageAt.toISOString(),
	closedAt: row.closedAt?.toISOString() ?? null,
});

const selectSummaries = () => db.select(summaryColumns).from(supportTickets)
	.leftJoin(subscribers, eq(subscribers.userId, supportTickets.userId))
	.leftJoin(admins, eq(admins.id, supportTickets.assigneeId));

// Поддержка видит очередь и свои обращения, закрытые — свои. Обращения коллег в работе видят только суперадмин и админ
export const listTickets = async (tab: SupportTab, actor: AdminUser, search = ''): Promise<SupportTicketSummary[]> => {
	const pattern = `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`;
	const found = search.trim()
		? sql`(
			concat_ws(' ', ${subscribers.firstName}, ${subscribers.lastName}) ilike ${pattern}
			or exists (select 1 from support_messages m where m.ticket_id = support_tickets.id and m.sender <> 'system' and m.text ilike ${pattern})
		)`
		: undefined;

	const rows = tab === 'open'
		? await selectSummaries()
			.where(and(
				ne(supportTickets.status, 'closed'),
				isManager(actor) ? undefined : or(eq(supportTickets.status, 'queue'), eq(supportTickets.assigneeId, actor.id)),
				found,
			))
			// Сверху свободные: первым берут того, кто ждет дольше
			.orderBy(sql`case when ${supportTickets.status} = 'queue' then ${supportTickets.createdAt} end asc nulls last`, desc(supportTickets.lastMessageAt))
			.limit(LIST_LIMIT)
		: tab === 'mine'
			? await selectSummaries().where(and(eq(supportTickets.status, 'active'), eq(supportTickets.assigneeId, actor.id), found)).orderBy(desc(supportTickets.lastMessageAt)).limit(LIST_LIMIT)
			: await selectSummaries()
				.where(and(eq(supportTickets.status, 'closed'), isManager(actor) ? undefined : eq(supportTickets.assigneeId, actor.id), found))
				.orderBy(desc(supportTickets.closedAt)).limit(LIST_LIMIT);

	return rows.map(toSummary);
};

export const countTickets = async (actor: AdminUser): Promise<SupportCounts> => {
	const [row] = await db.select({
		queue: sql<number>`count(*) filter (where status = 'queue')::int`,
		open: isManager(actor) ? sql<number>`count(*)::int` : sql<number>`count(*) filter (where status = 'queue' or assignee_id = ${actor.id})::int`,
		mine: sql<number>`count(*) filter (where status = 'active' and assignee_id = ${actor.id})::int`,
		waiting: sql<number>`count(*) filter (where status = 'active' and assignee_id = ${actor.id} and last_sender is distinct from 'staff')::int`,
	}).from(supportTickets).where(ne(supportTickets.status, 'closed'));

	return row;
};

const loadTicket = async (id: number) => {
	const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));

	if (!ticket) {
		throw new RuleError(404, 'Обращение не найдено');
	}

	return ticket;
};

// Что пассажир спрашивал у бота и что бот показал: чтобы не переспрашивать
const loadBotHistory = async (userId: number, before: Date): Promise<SupportHistoryEntry[]> => {
	const rows = await db.select({ type: dialogEvents.type, text: dialogEvents.text, data: dialogEvents.data, createdAt: dialogEvents.createdAt })
		.from(dialogEvents)
		.where(and(
			eq(dialogEvents.userId, userId),
			lt(dialogEvents.createdAt, before),
			sql`${dialogEvents.createdAt} > ${new Date(before.getTime() - HISTORY_HOURS * 3600_000).toISOString()}::timestamptz`,
			inArray(dialogEvents.type, ['start', 'answer', 'option', 'clarify', 'unrecognized', 'back', 'menu', 'more', 'goodbye']),
		))
		.orderBy(desc(dialogEvents.createdAt))
		.limit(HISTORY_LIMIT);

	return rows.reverse().map(row => ({
		question: row.text,
		// В ответах бота есть разметка, а здесь нужен только смысл
		answer: ((row.data.replies ?? []) as { text?: string; }[])
			.map(reply => (reply.text ?? '').replace(/<[^>]+>/g, '').trim())
			.filter(Boolean)
			.join('\n'),
		at: row.createdAt.toISOString(),
	}));
};

export const loadTicketDetail = async (id: number, actor: AdminUser): Promise<SupportTicketDetail> => {
	const ticket = await loadTicket(id);

	if (!isManager(actor) && ticket.status === 'active' && ticket.assigneeId !== actor.id) {
		throw new RuleError(403, 'Обращение ведет другой сотрудник');
	}

	const [[summary], messages, [subscriber], past, history, [tickets], [questions]] = await Promise.all([
		selectSummaries().where(eq(supportTickets.id, id)),
		db.select({
			id: supportMessages.id,
			sender: supportMessages.sender,
			authorName: admins.fullName,
			text: supportMessages.text,
			attachments: supportMessages.attachments,
			delivery: supportMessages.delivery,
			createdAt: supportMessages.createdAt,
		}).from(supportMessages)
			.leftJoin(admins, eq(admins.id, supportMessages.adminId))
			.where(eq(supportMessages.ticketId, id))
			.orderBy(asc(supportMessages.id)),
		db.select().from(subscribers).where(eq(subscribers.userId, ticket.userId)),
		selectSummaries()
			.where(and(eq(supportTickets.userId, ticket.userId), ne(supportTickets.id, id), eq(supportTickets.status, 'closed')))
			.orderBy(desc(supportTickets.closedAt))
			.limit(20),
		loadBotHistory(ticket.userId, ticket.createdAt),
		db.select({ first: min(supportTickets.createdAt), total: count() }).from(supportTickets).where(eq(supportTickets.userId, ticket.userId)),
		db.select({ total: count() }).from(dialogEvents).where(and(
			eq(dialogEvents.userId, ticket.userId),
			inArray(dialogEvents.type, ['answer', 'clarify', 'unrecognized']),
			sql`coalesce(trim(${dialogEvents.text}), '') <> ''`,
		)),
	]);

	return {
		...toSummary(summary),
		messages: messages.map(message => ({
			...message,
			sender: message.sender as SupportTicketDetail['messages'][number]['sender'],
			delivery: message.delivery as SupportTicketDetail['messages'][number]['delivery'],
			createdAt: message.createdAt.toISOString(),
		})),
		card: {
			userId: ticket.userId,
			name: passengerName({ firstName: subscriber?.firstName ?? null, lastName: subscriber?.lastName ?? null, userId: ticket.userId }),
			username: subscriber?.username ?? null,
			firstSeenAt: subscriber?.firstSeenAt.toISOString() ?? null,
			isBlocked: subscriber?.isBlocked ?? false,
			firstTicketAt: (tickets.first ?? ticket.createdAt).toISOString(),
			ticketCount: tickets.total,
			botQuestions: questions.total,
		},
		past: past.map(toSummary),
		history,
	};
};

const assertCanManage = (ticket: { status: string; assigneeId: number | null; }, actor: AdminUser) => {
	if (ticket.status !== 'active') {
		throw new RuleError(409, ticket.status === 'closed' ? 'Обращение уже закрыто' : 'Сначала возьмите обращение');
	}

	if (ticket.assigneeId !== actor.id && !isManager(actor)) {
		throw new RuleError(403, 'Обращение ведет другой сотрудник');
	}
};

// Двое нажали «Взять» одновременно: условие в запросе отдаст обращение только первому
export const takeTicket = async (id: number, actor: AdminUser) => {
	const taken = await db.transaction(async tx => {
		const [row] = await tx.update(supportTickets)
			.set({ status: 'active', assigneeId: actor.id, takenAt: new Date() })
			.where(and(eq(supportTickets.id, id), eq(supportTickets.status, 'queue')))
			.returning({ id: supportTickets.id });

		if (row) {
			await addSystemMessage(tx, id, `${actor.fullName} взял(а) обращение`);
		}

		return row;
	});

	if (!taken) {
		const ticket = await loadTicket(id);
		const [owner] = ticket.assigneeId === null ? [] : await db.select({ name: admins.fullName }).from(admins).where(eq(admins.id, ticket.assigneeId));

		throw new RuleError(409, ticket.status === 'closed' ? 'Обращение уже закрыто' : `Обращение уже взял(а) ${owner?.name ?? 'другой сотрудник'}`);
	}

	publish({ ticketId: id, kind: 'changed', assigneeId: actor.id });
};

export const releaseTicket = async (id: number, actor: AdminUser) => {
	await db.transaction(async tx => {
		const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');

		if (!ticket) {
			throw new RuleError(404, 'Обращение не найдено');
		}

		assertCanManage(ticket, actor);
		await tx.update(supportTickets).set({ status: 'queue', assigneeId: null, takenAt: null }).where(eq(supportTickets.id, id));
		await addSystemMessage(tx, id, `${actor.fullName} вернул(а) обращение в очередь`);
	});

	publish({ ticketId: id, kind: 'queued', assigneeId: null });
};

// Конец смены: незакрытые передаются в очередь. Сама система из-за смены ничего не закрывает
export const releaseAllTickets = async (actor: AdminUser) => {
	const rows = await db.select({ id: supportTickets.id }).from(supportTickets)
		.where(and(eq(supportTickets.status, 'active'), eq(supportTickets.assigneeId, actor.id)));

	for (const { id } of rows) {
		await releaseTicket(id, actor);
	}

	return rows.length;
};

// Статус не меняется: обращение остается в работе, переписку видит следующий сотрудник
export const transferTicket = async (id: number, targetId: number, actor: AdminUser) => {
	await db.transaction(async tx => {
		const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');

		if (!ticket) {
			throw new RuleError(404, 'Обращение не найдено');
		}

		assertCanManage(ticket, actor);

		const [target] = await tx.select().from(admins).where(and(eq(admins.id, targetId), eq(admins.isActive, true)));

		if (!target) {
			throw new RuleError(400, 'Такого сотрудника нет или он отключен');
		}

		await tx.update(supportTickets).set({ assigneeId: targetId }).where(eq(supportTickets.id, id));
		await addSystemMessage(tx, id, `${actor.fullName} передал(а) обращение: ${target.fullName}`);
	});

	publish({ ticketId: id, kind: 'changed', assigneeId: targetId });
};

// Сотрудника отключили: его обращения сразу возвращаются в очередь. Вызывается внутри транзакции отключения
export const releaseTicketsOf = async (tx: Pick<typeof db, 'update' | 'insert'>, adminId: number) => {
	const released = await tx.update(supportTickets)
		.set({ status: 'queue', assigneeId: null, takenAt: null })
		.where(and(eq(supportTickets.status, 'active'), eq(supportTickets.assigneeId, adminId)))
		.returning({ id: supportTickets.id });

	for (const { id } of released) {
		await addSystemMessage(tx, id, 'Сотрудника отключили, обращение вернулось в очередь');
	}

	return released.map(row => row.id);
};

export const publishQueued = (ids: number[]) => {
	for (const ticketId of ids) {
		publish({ ticketId, kind: 'queued', assigneeId: null });
	}
};

// Сообщения одного обращения уходят по порядку. Сбой одной отправки не отменяет следующие
const deliveries = new Map<number, Promise<unknown>>();

const inOrder = (ticketId: number, work: () => Promise<void>) => {
	const next = (deliveries.get(ticketId) ?? Promise.resolve()).then(work, work);
	const forget = () => {
		if (deliveries.get(ticketId) === next) {
			deliveries.delete(ticketId);
		}
	};

	deliveries.set(ticketId, next);
	next.then(forget, forget);

	return next;
};

const deliver = (ticketId: number, messageId: number, userId: number, text: string, attachments: SupportAttachment[]) => inOrder(ticketId, async () => {
	let delivery: 'sent' | 'failed' = 'failed';

	try {
		const result = await sendToPassenger(config.botControlUrl, config.internalToken, { userId, text, attachments });

		if (result.ok) {
			delivery = 'sent';
		} else {
			logger.warn('Support message was not delivered', { ticketId, error: result.error });
		}
	} catch (error) {
		logger.warn('Bot did not take support message', { ticketId, error: errorMessage(error) });
	}

	await db.update(supportMessages).set({ delivery }).where(eq(supportMessages.id, messageId));
	publish({ ticketId, kind: 'changed', assigneeId: null });
});

// Пассажир видит «Служба поддержки», кто отвечал — только внутри системы.
// Ответ сразу сохраняется: отправка занимает время, а ее результат появится на экране
export const replyToTicket = async (id: number, text: string, attachments: SupportAttachment[], actor: AdminUser) => {
	const { message, userId } = await db.transaction(async tx => {
		const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');

		if (!ticket) {
			throw new RuleError(404, 'Обращение не найдено');
		}

		assertCanManage(ticket, actor);

		if (ticket.assigneeId !== actor.id) {
			throw new RuleError(403, 'Обращение ведет другой сотрудник. Передайте его себе, чтобы ответить');
		}

		const [inserted] = await tx.insert(supportMessages)
			.values({ ticketId: id, sender: 'staff', adminId: actor.id, text, attachments, delivery: 'pending' })
			.returning({ id: supportMessages.id });

		await tx.update(supportTickets).set({ lastSender: 'staff', lastMessageAt: new Date() }).where(eq(supportTickets.id, id));

		return { message: inserted, userId: ticket.userId };
	});

	publish({ ticketId: id, kind: 'changed', assigneeId: null });
	void deliver(id, message.id, userId, text, attachments).catch((error: unknown) =>
		logger.error('Support delivery failed', { ticketId: id, error: errorMessage(error) }));
};

// Обращение уже закрыто: сбой здесь не должен ни вернуть ошибку сотруднику, ни остановить сервер
const notifyClosed = async (ticketId: number, userId: number) => {
	try {
		const settings = await loadSettings(db);
		const [root] = await db.select({ id: contentNodes.id }).from(contentNodes).where(eq(contentNodes.code, ROOT_CODE));

		// Старые номера вариантов больше ничего не значат: следующий вопрос бот поймет с начала
		await db.insert(sessions).values({ userId, nodeId: root?.id ?? null, choices: [] })
			.onConflictDoUpdate({ target: sessions.userId, set: { nodeId: root?.id ?? null, choices: [], updatedAt: sql`now()` } });

		await inOrder(ticketId, async () => {
			const result = await sendToPassenger(config.botControlUrl, config.internalToken, { userId, text: settings['text.supportClosed'], attachments: [], notice: true });

			if (!result.ok) {
				logger.warn('Close notice was not delivered', { ticketId, error: result.error });
			}
		});
	} catch (error) {
		logger.warn('Close notice was not delivered', { ticketId, error: errorMessage(error) });
	}
};

export const closeTicket = async (id: number, actor: AdminUser) => {
	const userId = await db.transaction(async tx => {
		const [ticket] = await tx.select().from(supportTickets).where(eq(supportTickets.id, id)).for('update');

		if (!ticket) {
			throw new RuleError(404, 'Обращение не найдено');
		}

		assertCanManage(ticket, actor);
		await tx.update(supportTickets).set({ status: 'closed', closedAt: new Date(), closeReason: 'staff' }).where(eq(supportTickets.id, id));
		await addSystemMessage(tx, id, `${actor.fullName} закрыл(а) обращение`);

		return ticket.userId;
	});

	publish({ ticketId: id, kind: 'changed', assigneeId: null });
	void notifyClosed(id, userId);
};

// Пассажир не отвечает 24 часа. Возвращает, сколько обращений закрыто
export const closeSilentTickets = async (now = new Date()) => {
	const threshold = new Date(now.getTime() - SILENCE_HOURS * 3600_000);

	const closed = await db.transaction(async tx => {
		const rows = await tx.update(supportTickets)
			.set({ status: 'closed', closedAt: now, closeReason: 'timeout' })
			.where(and(eq(supportTickets.status, 'active'), eq(supportTickets.lastSender, 'staff'), lt(supportTickets.lastMessageAt, threshold)))
			.returning({ id: supportTickets.id, userId: supportTickets.userId, assigneeId: supportTickets.assigneeId });

		for (const { id } of rows) {
			await addSystemMessage(tx, id, `Закрыто автоматически: пассажир не отвечал ${SILENCE_HOURS} часа`);
		}

		return rows;
	});

	for (const { id, userId, assigneeId } of closed) {
		publish({ ticketId: id, kind: 'changed', assigneeId });
		await notifyClosed(id, userId);
	}

	return closed.length;
};

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export const startSilenceSweep = () => {
	const timer = setInterval(() => {
		void closeSilentTickets().catch((error: unknown) => logger.error('Silence sweep failed', { error: errorMessage(error) }));
	}, SWEEP_INTERVAL_MS).unref();

	return () => clearInterval(timer);
};

// Обращение ведет свои файлы отдельно от контента: это личные данные пассажиров
export const supportFile = (relative: string) => {
	const inside = path.posix.normalize(relative);

	return inside.startsWith(`${SUPPORT_FOLDER}/`) ? mediaFile(inside) : Promise.resolve(null);
};

export const activeStaff = () => db.select({ id: admins.id, fullName: admins.fullName }).from(admins)
	.where(eq(admins.isActive, true))
	.orderBy(asc(admins.fullName));
