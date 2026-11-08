import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS } from '../content/types';
import type { Settings } from '../content/types';

import { isSupportCancel, supportDay, supportDaysError, supportHoursError, supportOpenedText, supportSchedule, supportTimeError } from './support';

// Время в Якутске: 2026-11-02 — понедельник
const yakutsk = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour - 9, minute));

describe('supportDay', () => {
	it('считает день по якутскому времени, а не по UTC', () => {
		expect(supportDay(yakutsk(3, 5))).toBe('2026-11-03');
	});
});

const settings = (over: Partial<Settings> = {}): Settings => ({
	...DEFAULT_SETTINGS,
	'support.open': '08:00',
	'support.close': '20:00',
	'support.days': '1,2,3,4,5,6,7',
	...over,
});

describe('часы работы поддержки', () => {
	it('считает по якутскому времени, а не по времени сервера', () => {
		// В Москве еще раннее утро понедельника, в Якутске уже день
		expect(supportSchedule(settings(), new Date('2026-11-02T03:00:00Z')).isOpen).toBe(true);
		// 23:30 UTC воскресенья — уже понедельник 8:30 в Якутске
		expect(supportSchedule(settings({ 'support.days': '1' }), new Date('2026-11-01T23:30:00Z')).isOpen).toBe(true);
	});

	it.each([
		[7, 59, false, 'сегодня с 8:00'],
		[8, 0, true, ''],
		[19, 59, true, ''],
		[20, 0, false, 'завтра с 8:00'],
		[23, 30, false, 'завтра с 8:00'],
	])('в %i:%i', (hour, minute, isOpen, next) => {
		expect(supportSchedule(settings(), yakutsk(2, hour, minute))).toEqual({ isOpen, next });
	});

	it('только по будням: в выходные называет понедельник', () => {
		const weekdays = settings({ 'support.days': '1,2,3,4,5' });

		expect(supportSchedule(weekdays, yakutsk(6, 21))).toEqual({ isOpen: false, next: 'в понедельник с 8:00' });
		expect(supportSchedule(weekdays, yakutsk(7, 12))).toEqual({ isOpen: false, next: 'в понедельник с 8:00' });
		expect(supportSchedule(weekdays, yakutsk(8, 12))).toEqual({ isOpen: false, next: 'завтра с 8:00' });
		expect(supportSchedule(weekdays, yakutsk(9, 12)).isOpen).toBe(true);
	});

	it('единственный рабочий день: следующий через неделю', () => {
		expect(supportSchedule(settings({ 'support.days': '1' }), yakutsk(2, 21))).toEqual({ isOpen: false, next: 'в понедельник с 8:00' });
	});

	it('время с минутами называет как есть', () => {
		expect(supportSchedule(settings({ 'support.open': '09:30' }), yakutsk(2, 9))).toEqual({ isOpen: false, next: 'сегодня с 9:30' });
		expect(supportSchedule(settings({ 'support.open': '10:00' }), yakutsk(2, 9)).next).toBe('сегодня с 10:00');
	});

	it('неверные часы не закрывают поддержку', () => {
		expect(supportSchedule(settings({ 'support.open': 'утром' }), yakutsk(2, 3)).isOpen).toBe(true);
		expect(supportSchedule(settings({ 'support.days': '' }), yakutsk(2, 3)).isOpen).toBe(true);
	});

	it('проверяет настройки', () => {
		expect(supportTimeError('08:00')).toBeNull();
		for (const bad of ['8:00', '24:00', '08:60', 'утром', '']) {
			expect(supportTimeError(bad), bad).not.toBeNull();
		}
		expect(supportDaysError('1,5')).toBeNull();
		expect(supportDaysError('')).not.toBeNull();
		expect(supportDaysError('8,0')).not.toBeNull();
		expect(supportHoursError(settings())).toBeNull();
		expect(supportHoursError(settings({ 'support.open': '20:00' }))).not.toBeNull();
	});
});

describe('сообщение пассажиру', () => {
	it('в рабочее время — обычное, ночью — со временем ответа и поясом', () => {
		expect(supportOpenedText(settings(), yakutsk(2, 12))).toBe(DEFAULT_SETTINGS['text.supportQueued']);

		const night = supportOpenedText(settings(), yakutsk(2, 23));

		expect(night).toContain('Ответим завтра с 8:00 по якутскому времени');
		expect(night).toContain('8 800 550 06 20');
		expect(night).not.toContain('{next}');
	});
});

describe('отмена обращения', () => {
	it.each(['отмена', 'Отмена!', 'меню', 'Главное меню', ' ОТМЕНИТЬ '])('%s', text => {
		expect(isSupportCancel(text)).toBe(true);
	});

	it.each(['отмена поезда', 'как отменить билет', 'расписание', ''])('%j — обычное сообщение', text => {
		expect(isSupportCancel(text)).toBe(false);
	});
});

describe('проверка дней недели', () => {
	it('принимает только номера от 1 до 7', () => {
		for (const value of ['1', '1,2,3', '1,2,3,4,5,6,7']) {
			expect(supportDaysError(value), value).toBeNull();
		}
		for (const value of ['', '0', '8', '1,9', '1,', ',1', 'пн', '1, 2']) {
			expect(supportDaysError(value), value).not.toBeNull();
		}
	});
});
