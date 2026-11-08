// Правила чата поддержки, общие для бота и API

import type { Settings } from '../content/types';

import { normalize } from './text';

// Пункт, который передает пассажира оператору. Поиск его не находит: в очередь попадают только те,
// кто сознательно выбрал этот пункт, а не случайные фразы
export const OPERATOR_CODE = 'operator';
export const OPERATOR_MENU_CODE = 'operator-menu';

const CANCEL_WORDS = new Set(['отмена', 'отменить', 'отмени', 'меню', 'главное меню', 'в меню', 'start']);

// Пассажир передумал, пока обращение ждет в очереди
export const isSupportCancel = (text: string) => CANCEL_WORDS.has(normalize(text));

// Часы работы считаются по якутскому времени: пассажир может быть в другом поясе, поэтому пояс назван в сообщении.
// В Якутске нет перехода на летнее время
const YAKUTSK_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutesOf = (time: string) => {
	const match = TIME.exec(time);
	return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const daysOf = (value: string) => value.split(',').map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7);

export const supportTimeError = (value: string) => TIME.test(value) ? null : 'Время указывается так: 08:00';

export const supportDaysError = (value: string) => /^[1-7](,[1-7])*$/.test(value) ? null : 'Выберите хотя бы один рабочий день';

export const supportHoursError = (settings: Settings) =>
	(minutesOf(settings['support.open']) ?? 0) < (minutesOf(settings['support.close']) ?? 0) ? null : 'Начало работы должно быть раньше конца';

// Пока часы не заданы правильно, считаем, что поддержка работает: обращение принимается в любом случае
export const supportSchedule = (settings: Settings, now: Date): { isOpen: boolean; next: string; } => {
	const open = minutesOf(settings['support.open']);
	const close = minutesOf(settings['support.close']);
	const days = new Set(daysOf(settings['support.days']));

	if (open === null || close === null || days.size === 0) {
		return { isOpen: true, next: '' };
	}

	const local = new Date(now.getTime() + YAKUTSK_OFFSET_MS);
	// Понедельник — 1, воскресенье — 7
	const today = (local.getUTCDay() + 6) % 7 + 1;
	const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
	const time = settings['support.open'].replace(/^0/, '');

	if (days.has(today) && minutes >= open && minutes < close) {
		return { isOpen: true, next: '' };
	}

	if (days.has(today) && minutes < open) {
		return { isOpen: false, next: `сегодня с ${time}` };
	}

	for (let shift = 1; shift <= 7; shift++) {
		const day = (today - 1 + shift) % 7 + 1;

		if (days.has(day)) {
			return { isOpen: false, next: `${shift === 1 ? 'завтра' : WEEKDAYS[day - 1]} с ${time}` };
		}
	}

	return { isOpen: true, next: '' };
};

// Календарный день по якутскому времени
export const supportDay = (now: Date) => new Date(now.getTime() + YAKUTSK_OFFSET_MS).toISOString().slice(0, 10);

// Что пассажир видит сразу после «Написать оператору»
export const supportOpenedText = (settings: Settings, now: Date) => {
	const { isOpen, next } = supportSchedule(settings, now);
	return isOpen ? settings['text.supportQueued'] : settings['text.supportOffHours'].replaceAll('{next}', next);
};
