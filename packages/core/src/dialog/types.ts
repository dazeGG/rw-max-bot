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
	// Exact last displayed options, not an inherited topic or a parent's unseen menu.
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

export interface DialogEvents {
	onUnrecognized? (event: UnrecognizedEvent): Promise<void> | void;
}

// Как бот обработал сообщение — для статистики:
// start — стартовое сообщение; answer — раздел найден по тексту; option — выбран номер варианта;
// clarify — «Уточните, пожалуйста…»; unrecognized — не понял; back, menu — навигация;
// more, goodbye — «да» или «нет» на «Могу ли я ещё Вам чем-то помочь?»
export type DialogEventType = 'start' | 'answer' | 'option' | 'clarify' | 'unrecognized' | 'back' | 'menu' | 'more' | 'goodbye';

// Подробности разбора сообщения. Состав можно расширять: в БД они лежат в jsonb
export type DialogEventDetails = {
	// Раздел, где был пользователь, и пункты, на которые ссылаются номера в его сообщении
	fromNodeId?: number;
	fromNodeCode?: string;
	shown?: string[];
	normalized?: string;
	greeting?: boolean;
	// Номер варианта: option — выбран, unmatchedOption — в показанном списке такого номера не было
	option?: number;
	unmatchedOption?: number;
	// Лучшие кандидаты поиска по тексту с баллами и варианты, предложенные в «Уточните, пожалуйста…»
	candidates?: Array<{ code: string; score: number; }>;
	suggested?: string[];
};

export type DialogEvent = {
	type: DialogEventType;
	// Раздел, который бот показал (для clarify и unrecognized — где был пользователь)
	nodeId: number | null;
	nodeCode: string | null;
	text: string | null;
	details: DialogEventDetails;
};

export type DialogResult = {
	replies: Reply[];
	event: DialogEvent;
};
