// section — раздел: сообщение (текст, картинка, файл) и вложенные пункты.
//           Раздел с вложенными пунктами — это уточняющий вопрос (пункты перечисляются в сообщении
//           как варианты ответа), без них — информационный ответ.
// link    — пункт-ссылка на внешний сайт.
// goto    — пункт, который ведет в другой раздел (чтобы не дублировать контент).
export type NodeType = 'section' | 'link' | 'goto';

export type ContentNode = {
	id: number;
	parentId: number | null;
	code: string;
	type: NodeType;
	// Название пункта в списке вариантов
	title: string;
	// Текст сообщения (HTML: <b>, <i>, <u>, <s>, <mark>, <code>, <a href>, <h1>, <blockquote>)
	text: string | null;
	url: string | null;
	targetId: number | null;
	// Пути к файлам относительно папки media
	image: string | null;
	// Текст, изображённый на картинке (таблица цен, расписание). Пользователю не показывается, только для поиска
	imageText: string | null;
	file: string | null;
	fileName: string | null;
	// Фразы, по которым раздел находится по свободному тексту
	synonyms: string[];
	sort: number;
	isActive: boolean;
	// Не перечислять в вариантах родителя: раздел находится только по тексту или через goto
	isHidden: boolean;
};

export type SettingKey =
	| 'text.fallback'
	| 'text.didYouMean'
	| 'text.greeting'
	| 'text.anythingElse'
	| 'text.askMore'
	| 'text.goodbye'
	| 'text.handoff'
	| 'search.handoff';

export type Settings = Record<SettingKey, string>;

export const DEFAULT_SETTINGS: Settings = {
	'text.fallback': 'К сожалению, я не понял вопрос. Попробуйте сформулировать его иначе.\n\nЯ могу подсказать по темам:',
	'text.didYouMean': 'Уточните, пожалуйста, что Вас интересует:',
	'text.greeting': 'Здравствуйте! Я буду помогать в решении Вашего вопроса.',
	'text.anythingElse': 'Могу ли я ещё Вам чем-то помочь?',
	'text.askMore': 'Задайте вопрос своими словами.\n\nЯ могу подсказать по темам:',
	'text.goodbye': 'Спасибо за обращение! Если появятся вопросы, пишите.',
	// Последний пункт каждого уточнения поиска и код раздела, куда он ведёт; пустой код — пункта нет
	'text.handoff': 'Нет подходящего варианта — служба поддержки',
	'search.handoff': 'support',
};

export const ROOT_CODE = 'root';
