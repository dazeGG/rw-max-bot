// Ответ движка не зависит от мессенджера: его отправляет транспорт MAX или консольный симулятор

export type Reply = {
	text: string;
	image?: string;
	file?: { path: string; name: string; };
};

export type DialogInput =
	| { type: 'start'; }
	| { type: 'text'; text: string; };

export type DialogUser = {
	id: number;
	firstName?: string;
	lastName?: string | null;
	username?: string | null;
};

export type Session = {
	nodeId: number | null;
	// Разделы, которые бот предложил в ответ на неоднозначный вопрос: следующий ответ ищется прежде всего среди них
	choices?: number[];
};

export interface SessionStore {
	get (userId: number): Promise<Session>;
	set (userId: number, session: Session): Promise<void>;
}

export type UnrecognizedEvent = {
	userId: number;
	text: string;
	nodeId: number | null;
};

// Как бот обработал сообщение — для статистики:
// start — стартовое сообщение; answer — раздел найден по тексту; option — выбран номер варианта;
// clarify — «Уточните, пожалуйста…»; unrecognized — не понял; back, menu — навигация;
// more, goodbye — «да» или «нет» на «Могу ли я ещё Вам чем-то помочь?»
export const DIALOG_EVENT_TYPES = ['start', 'answer', 'option', 'clarify', 'unrecognized', 'back', 'menu', 'more', 'goodbye'] as const;

export type DialogEventType = typeof DIALOG_EVENT_TYPES[number];

export type DialogEvent = {
	userId: number;
	type: DialogEventType;
	// Код раздела, который бот показал (для clarify и unrecognized — где был пользователь). Код, а не id:
	// id разделов меняются при перезаливке контента
	nodeCode: string | null;
	text: string | null;
};

export interface DialogEvents {
	onUnrecognized? (event: UnrecognizedEvent): Promise<void> | void;
	onEvent? (event: DialogEvent): Promise<void> | void;
}
