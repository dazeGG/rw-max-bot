import { describe, expect, it, vi } from 'vitest';

import { buildDays, buildHours, periodDates, periodStart } from './stats';

vi.mock('@rw/db', () => ({}));

describe('период статистики', () => {
	it('заканчивается сегодняшним днем по якутскому времени', () => {
		// В UTC еще 10 ноября, в Якутске уже 11-е
		expect(periodDates(3, new Date('2026-11-10T20:00:00Z'))).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
	});

	it('начинается с полуночи по Якутску', () => {
		expect(periodStart('2026-11-09').toISOString()).toBe('2026-11-08T15:00:00.000Z');
	});

	it('переходит через границу месяца', () => {
		expect(periodDates(2, new Date('2026-12-01T03:00:00Z'))).toEqual(['2026-11-30', '2026-12-01']);
	});
});

describe('сборка дней', () => {
	const empty = { activeUsers: 0, newUsers: 0, answered: 0, clarified: 0, unrecognized: 0, ticketsAsked: 0, ticketsNoOption: 0, ticketsUnrecognized: 0 };

	it('заполняет нулями дни без событий', () => {
		expect(buildDays(['2026-11-09', '2026-11-10'], [], [], [])).toEqual([
			{ date: '2026-11-09', ...empty },
			{ date: '2026-11-10', ...empty },
		]);
	});

	it('раскладывает значения по своим дням и причинам', () => {
		const [first, second] = buildDays(
			['2026-11-09', '2026-11-10'],
			[{ date: '2026-11-10', activeUsers: 3, answered: 5, clarified: 2, unrecognized: 1 }],
			[{ date: '2026-11-09', newUsers: 4 }],
			[
				{ date: '2026-11-10', reason: 'asked', tickets: 2 },
				{ date: '2026-11-10', reason: 'noOption', tickets: 1 },
				{ date: '2026-11-09', reason: 'unrecognized', tickets: 7 },
			],
		);

		expect(first).toEqual({ date: '2026-11-09', ...empty, newUsers: 4, ticketsUnrecognized: 7 });
		expect(second).toEqual({ date: '2026-11-10', ...empty, activeUsers: 3, answered: 5, clarified: 2, unrecognized: 1, ticketsAsked: 2, ticketsNoOption: 1 });
	});
});

describe('сборка часов', () => {
	it('всегда дает 24 часа по порядку', () => {
		const hours = buildHours([{ hour: 23, events: 2 }, { hour: 0, events: 5 }]);

		expect(hours).toHaveLength(24);
		expect(hours[0]).toEqual({ hour: 0, events: 5 });
		expect(hours[12]).toEqual({ hour: 12, events: 0 });
		expect(hours[23]).toEqual({ hour: 23, events: 2 });
	});
});
