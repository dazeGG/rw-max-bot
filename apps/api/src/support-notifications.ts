// Уведомления сотрудникам о заявках в MAX. Отвечают пассажирам только в админке, сюда приходят сигнал и ссылка.
// В MAX-аккаунтах личные телефоны сотрудников, поэтому здесь нет ни имени пассажира, ни текста обращения.
// Сбой отправки не должен мешать работе с заявкой: все идет в фоне, ошибки только в журнал

import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';

import { supportDay, supportSchedule } from '@rw/core';
import type { StaffNotifyRequest, SupportReason } from '@rw/core';
import { admins, db, supportDigests, supportNotifications, supportTickets } from '@rw/db';
import { errorMessage } from '@rw/runtime';

import { config } from './config';
import { loadSettings } from './content';
import { notifyStaffInMax } from './content-notifier';
import { logger } from './logger';
import { orderedQueue } from './ordered-queue';

const DIGEST_CHECK_MS = 60 * 1000;

const REASON_TEXT: Record<SupportReason, string> = {
	unrecognized: 'бот не понял вопрос',
	noOption: 'нет подходящего варианта',
	asked: 'пассажир попросил оператора',
};

type TicketInfo = { id: number; openReason: string | null; };
type TicketState = TicketInfo & { status: string; assigneeName: string | null; };

const reasonLine = ({ openReason }: TicketInfo) => openReason ? `\nПричина: ${REASON_TEXT[openReason as SupportReason]}` : '';

export const newTicketText = (ticket: TicketInfo) => `Новая заявка №${ticket.id}${reasonLine(ticket)}`;

export const ticketStateText = (ticket: TicketState) => {
	const state = {
		queue: 'Снова в очереди',
		active: `В работе: ${ticket.assigneeName ?? 'сотрудник'}`,
		closed: 'Закрыта',
	}[ticket.status];

	return `Заявка №${ticket.id}${reasonLine(ticket)}\n${state}`;
};

const inOrder = orderedQueue();

// Без адреса админки ссылку дать некуда: так на сервере, где админка не выложена
const enqueue = (ticketId: number, work: () => Promise<void>) => {
	if (!config.adminUrl) {
		return;
	}

	void inOrder(ticketId, work).catch((error: unknown) =>
		logger.error('Support notification failed', { ticketId, error: errorMessage(error) }));
};

const ticketUrl = (ticketId: number) => `${config.adminUrl}/support/${ticketId}`;

const isWorkingTime = async (now: Date) => supportSchedule(await loadSettings(db), now).isOpen;

const recipients = async () => {
	const rows = await db.select({ adminId: admins.id, userId: admins.maxUserId }).from(admins)
		.where(and(eq(admins.isActive, true), eq(admins.maxNotify, true), isNotNull(admins.maxUserId)));

	return rows.map(row => ({ adminId: row.adminId, userId: row.userId! }));
};

// Один недоступный сотрудник (например, заблокировал бота) не должен оставить без уведомления остальных
const deliver = async (request: StaffNotifyRequest): Promise<string | null> => {
	try {
		const result = await notifyStaffInMax(config.botControlUrl, config.internalToken, request);

		if (result.ok) {
			return result.mid;
		}

		logger.warn('Staff notification was not delivered', { error: result.error });
	} catch (error) {
		logger.warn('Bot did not take staff notification', { error: errorMessage(error) });
	}

	return null;
};

export const notifyNewTicket = (ticket: TicketInfo, now = new Date()) => enqueue(ticket.id, async () => {
	if (!await isWorkingTime(now)) {
		return;
	}

	const text = newTicketText(ticket);

	for (const { adminId, userId } of await recipients()) {
		const mid = await deliver({ userId, text, url: ticketUrl(ticket.id) });

		if (mid) {
			await db.insert(supportNotifications).values({ ticketId: ticket.id, adminId, mid, text }).onConflictDoNothing();
		}
	}
});

// Обновление не присылает нового сообщения, поэтому в нерабочее время не откладывается
export const refreshTicketNotifications = (ticketId: number) => enqueue(ticketId, async () => {
	const sent = await db.select().from(supportNotifications).where(eq(supportNotifications.ticketId, ticketId));

	if (sent.length === 0) {
		return;
	}

	const [ticket] = await db
		.select({ id: supportTickets.id, openReason: supportTickets.openReason, status: supportTickets.status, assigneeName: admins.fullName })
		.from(supportTickets)
		.leftJoin(admins, eq(admins.id, supportTickets.assigneeId))
		.where(eq(supportTickets.id, ticketId));
	const text = ticketStateText(ticket);

	for (const { adminId, mid, text: current } of sent) {
		if (current !== text && await deliver({ mid, text, url: ticketUrl(ticketId) })) {
			await db.update(supportNotifications).set({ text })
				.where(and(eq(supportNotifications.ticketId, ticketId), eq(supportNotifications.adminId, adminId)));
		}
	}

	// Статус закрытой заявки больше не изменится
	if (ticket.status === 'closed') {
		await db.delete(supportNotifications).where(eq(supportNotifications.ticketId, ticketId));
	}
});

export const notifyPassengerReply = (ticketId: number, now = new Date()) => enqueue(ticketId, async () => {
	if (!await isWorkingTime(now)) {
		return;
	}

	// Условие в запросе не даст написать второй раз, пока сотрудник не ответил
	const [claimed] = await db.update(supportTickets)
		.set({ assigneeNotifiedAt: now })
		.where(and(eq(supportTickets.id, ticketId), eq(supportTickets.status, 'active'), isNull(supportTickets.assigneeNotifiedAt), isNotNull(supportTickets.assigneeId)))
		.returning({ assigneeId: supportTickets.assigneeId });

	if (!claimed) {
		return;
	}

	const assignee = (await recipients()).find(({ adminId }) => adminId === claimed.assigneeId);

	if (assignee) {
		await deliver({ userId: assignee.userId, text: `Пассажир ответил в заявке №${ticketId}`, url: ticketUrl(ticketId) });
	}
});

// Ночью заявки копятся молча: к началу смены одна сводка
export const sendShiftDigest = async (now = new Date()) => {
	if (!config.adminUrl || !await isWorkingTime(now)) {
		return;
	}

	const [claimed] = await db.insert(supportDigests).values({ day: supportDay(now) }).onConflictDoNothing().returning();

	if (!claimed) {
		return;
	}

	const [{ waiting }] = await db.select({ waiting: count() }).from(supportTickets).where(eq(supportTickets.status, 'queue'));

	if (waiting === 0) {
		return;
	}

	for (const { userId } of await recipients()) {
		await deliver({ userId, text: `Заявок в очереди: ${waiting}`, url: `${config.adminUrl}/support` });
	}
};

export const startShiftDigest = () => {
	const timer = setInterval(() => {
		void sendShiftDigest().catch((error: unknown) => logger.error('Shift digest failed', { error: errorMessage(error) }));
	}, DIGEST_CHECK_MS).unref();

	return () => clearInterval(timer);
};
