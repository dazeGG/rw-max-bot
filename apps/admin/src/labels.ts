// Подписи для журнала и истории версий: технические ключи сотрудникам не показываем

import type { SettingKey } from '@rw/core';

export const SETTING_LABELS: Record<SettingKey, string> = {
	'text.greeting': 'Приветствие',
	'text.didYouMean': 'Уточнение',
	'text.fallback': 'Бот не понял вопрос',
	'text.anythingElse': 'После ответа',
	'text.askMore': 'Пассажир хочет спросить еще',
	'text.goodbye': 'Прощание',
	'text.handoff': 'Пункт «Нет подходящего варианта»',
	'search.handoff': 'Куда ведет пункт «Нет подходящего варианта»',
};

export const ACTION_LABELS: Record<string, string> = {
	'staff.create': 'Добавление сотрудника',
	'staff.update': 'Изменение сотрудника',
	'staff.reset_password': 'Сброс пароля',
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
	imageText: 'текст с картинки',
	isActive: 'включение',
	isHidden: 'скрытие',
	...SETTING_LABELS,
};

export const fieldLabels = (fields: unknown[]) => fields.map(field => FIELD_LABELS[String(field)] ?? String(field)).join(', ');

export const formatDate = (value: string) => new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
