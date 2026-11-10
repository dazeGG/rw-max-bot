// Подписи для журнала и истории версий: технические ключи сотрудникам не показываем

import type { SettingKey } from '@rw/core';

export const SETTING_LABELS: Record<SettingKey, string> = {
	'text.greeting': 'Приветствие',
	'text.didYouMean': 'Уточнение',
	'text.fallback': 'Бот не понял вопрос',
	'text.anythingElse': 'После ответа',
	'text.askMore': 'Пассажир хочет спросить ещё',
	'text.goodbye': 'Прощание',
	'text.handoff': 'Пункт «Нет подходящего варианта»',
	'text.handoffOperator': 'Пункт «Нет подходящего варианта» при включенном чате',
	'search.handoff': 'Куда ведет пункт «Нет подходящего варианта»',
	'text.supportQueued': 'Пассажира передали в поддержку',
	'text.supportOffHours': 'Поддержка сейчас не работает',
	'text.supportClosed': 'Обращение закрыто',
	'text.supportCancelled': 'Пассажир отменил обращение',
	'support.open': 'Начало работы поддержки',
	'support.close': 'Конец работы поддержки',
	'support.days': 'Рабочие дни поддержки',
};

export const ACTION_LABELS: Record<string, string> = {
	'staff.create': 'Добавление сотрудника',
	'staff.update': 'Изменение сотрудника',
	'staff.reset_password': 'Сброс пароля',
	'staff.max_linked': 'Привязка MAX',
	'staff.max_reset': 'Сброс привязки MAX',
	'staff.disable': 'Отключение',
	'staff.enable': 'Включение',
	'content.create': 'Новый пункт',
	'content.update': 'Изменение раздела',
	'content.move': 'Перенос раздела',
	'content.delete': 'Удаление раздела',
	'content.restore': 'Возврат к версии',
	'settings.update': 'Изменение текстов',
};

const FIELD_LABELS: Record<string, string> = {
	title: 'название',
	text: 'текст',
	url: 'адрес',
	targetId: 'цель перехода',
	synonyms: 'фразы',
	image: 'картинка',
	imageText: 'текст с картинки',
	tables: 'таблицы',
	file: 'файл',
	fileName: 'имя файла',
	isActive: 'включение',
	isHidden: 'скрытие',
	...SETTING_LABELS,
};

export const fieldLabels = (fields: unknown[]) => fields.map(field => FIELD_LABELS[String(field)] ?? String(field)).join(', ');

export const formatDate = (value: string) => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export const formatTime = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

// Без даты: 28.10 или 28.10.2025, если год другой
export const formatDay = (value: string, now = new Date()) => {
	const date = new Date(value);

	return date.toLocaleDateString('ru-RU', date.getFullYear() === now.getFullYear()
		? { day: '2-digit', month: '2-digit' }
		: { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Для списков: «сегодня, 14:20», «вчера, 16:02», «01.11, 10:15»
export const formatWhen = (value: string, now = new Date()) => {
	const date = new Date(value);
	const yesterday = new Date(now);

	yesterday.setDate(now.getDate() - 1);

	if (isSameDay(date, now)) {
		return `сегодня, ${formatTime(value)}`;
	}

	return `${isSameDay(date, yesterday) ? 'вчера' : formatDay(value, now)}, ${formatTime(value)}`;
};

// Выбирает форму слова: plural(3, ['раз', 'раза', 'раз'])
export const plural = (count: number, [one, few, many]: [string, string, string]) => {
	const tens = count % 100;
	const units = count % 10;

	if (tens >= 11 && tens <= 14) {
		return many;
	}

	if (units === 1) {
		return one;
	}

	return units >= 2 && units <= 4 ? few : many;
};
