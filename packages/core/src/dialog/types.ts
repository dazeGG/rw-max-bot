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

export interface DialogEvents {
	onUnrecognized? (event: UnrecognizedEvent): Promise<void> | void;
}
