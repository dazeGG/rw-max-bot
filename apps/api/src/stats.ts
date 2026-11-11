// Статистика для админки. В ответе только суммы: ни текстов, ни данных пассажиров. Дни и часы считаются по якутскому времени

import { and, count, countDistinct, desc, gte, inArray, isNotNull, eq, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import type { DialogEventType, StatsDay, StatsHour, StatsPeriod, StatsResponse } from '@rw/core';
import { supportDay } from '@rw/core';
import { contentNodes, db, dialogEvents, subscribers, supportTickets } from '@rw/db';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS_IN_DAY = 24;
const TOP_SECTIONS = 10;

// Сообщения пассажира. Остальные типы в журнале — служебные обновления MAX
const DIALOG_TYPES: DialogEventType[] = ['start', 'answer', 'option', 'clarify', 'unrecognized', 'back', 'menu', 'more', 'goodbye', 'operator'];
// Открытие раздела: найден поиском или выбран пунктом
const SECTION_TYPES: DialogEventType[] = ['answer', 'option'];

type DialogDay = Pick<StatsDay, 'date' | 'activeUsers' | 'answered' | 'clarified' | 'unrecognized'>;
type NewUsersDay = Pick<StatsDay, 'date' | 'newUsers'>;
type TicketsDay = { date: string; reason: string; tickets: number; };

const localDay = (column: AnyPgColumn) => sql<string>`to_char(${column} at time zone 'Asia/Yakutsk', 'YYYY-MM-DD')`;

// Последние days дней, сегодняшний — последний
export const periodDates = (days: number, now: Date) => {
	const today = Date.parse(`${supportDay(now)}T00:00:00Z`);

	return Array.from({ length: days }, (_, index) => new Date(today - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10));
};

export const periodStart = (firstDate: string) => new Date(`${firstDate}T00:00:00+09:00`);

// В дни без событий строк нет, а на графике должен быть ноль
export const buildDays = (dates: string[], dialog: DialogDay[], newUsers: NewUsersDay[], tickets: TicketsDay[]): StatsDay[] => dates.map(date => {
	const ticketsBy = (reason: string) => tickets.find(row => row.date === date && row.reason === reason)?.tickets ?? 0;
	const { activeUsers = 0, answered = 0, clarified = 0, unrecognized = 0 } = dialog.find(row => row.date === date) ?? {};

	return {
		date,
		activeUsers,
		newUsers: newUsers.find(row => row.date === date)?.newUsers ?? 0,
		answered,
		clarified,
		unrecognized,
		ticketsAsked: ticketsBy('asked'),
		ticketsNoOption: ticketsBy('noOption'),
		ticketsUnrecognized: ticketsBy('unrecognized'),
	};
});

export const buildHours = (rows: StatsHour[]): StatsHour[] =>
	Array.from({ length: HOURS_IN_DAY }, (_, hour) => ({ hour, events: rows.find(row => row.hour === hour)?.events ?? 0 }));

export const loadStats = async (period: StatsPeriod, now = new Date()): Promise<StatsResponse> => {
	const dates = periodDates(period, now);
	const from = periodStart(dates[0]);
	const inPeriod = and(gte(dialogEvents.createdAt, from), inArray(dialogEvents.type, DIALOG_TYPES));
	const eventDay = localDay(dialogEvents.createdAt);
	const eventHour = sql<number>`extract(hour from ${dialogEvents.createdAt} at time zone 'Asia/Yakutsk')::int`;
	const subscriberDay = localDay(subscribers.firstSeenAt);
	const ticketDay = localDay(supportTickets.createdAt);
	// У обращений, открытых до появления причины, она пустая: это пассажиры, которые сами выбрали оператора
	const ticketReason = sql<string>`coalesce(${supportTickets.openReason}, 'asked')`;

	const [[totals], [active], dialog, newUsers, tickets, sections, hours] = await Promise.all([
		db.select({ subscribers: count(), blocked: sql<number>`(count(*) filter (where ${subscribers.isBlocked}))::int` }).from(subscribers),
		db.select({ activeUsers: countDistinct(dialogEvents.userId) }).from(dialogEvents).where(inPeriod),
		db.select({
			date: eventDay,
			activeUsers: countDistinct(dialogEvents.userId),
			answered: sql<number>`(count(*) filter (where ${dialogEvents.type} = 'answer'))::int`,
			clarified: sql<number>`(count(*) filter (where ${dialogEvents.type} = 'clarify'))::int`,
			unrecognized: sql<number>`(count(*) filter (where ${dialogEvents.type} = 'unrecognized'))::int`,
		}).from(dialogEvents).where(inPeriod).groupBy(eventDay),
		db.select({ date: subscriberDay, newUsers: count() }).from(subscribers).where(gte(subscribers.firstSeenAt, from)).groupBy(subscriberDay),
		db.select({ date: ticketDay, reason: ticketReason, tickets: count() }).from(supportTickets).where(gte(supportTickets.createdAt, from)).groupBy(ticketDay, ticketReason),
		db.select({ code: sql<string>`${dialogEvents.nodeCode}`, title: sql<string>`coalesce(${contentNodes.title}, ${dialogEvents.nodeCode})`, opens: count() })
			.from(dialogEvents)
			// Раздел могли удалить: тогда вместо названия покажем код
			.leftJoin(contentNodes, eq(contentNodes.code, dialogEvents.nodeCode))
			.where(and(gte(dialogEvents.createdAt, from), inArray(dialogEvents.type, SECTION_TYPES), isNotNull(dialogEvents.nodeCode)))
			.groupBy(dialogEvents.nodeCode, contentNodes.title)
			.orderBy(desc(count()), dialogEvents.nodeCode)
			.limit(TOP_SECTIONS),
		db.select({ hour: eventHour, events: count() }).from(dialogEvents).where(inPeriod).groupBy(eventHour),
	]);

	return { ...totals, ...active, days: buildDays(dates, dialog, newUsers, tickets), sections, hours: buildHours(hours) };
};
