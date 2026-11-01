// Нарушение правила: откатывает транзакцию, текст уходит пользователю как есть
export class RuleError extends Error {
	constructor (readonly statusCode: number, message: string) {
		super(message);
	}
}
