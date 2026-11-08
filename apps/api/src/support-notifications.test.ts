import { describe, expect, it } from 'vitest';

import { newTicketText, ticketStateText } from './support-notifications';

const ticket = { id: 128, openReason: 'unrecognized' };

describe('тексты уведомлений о заявках', () => {
	it('называет номер и причину', () => {
		expect(newTicketText(ticket)).toBe('Новая заявка №128\nПричина: бот не понял вопрос');
	});

	it('обходится без причины у старых заявок', () => {
		expect(newTicketText({ id: 5, openReason: null })).toBe('Новая заявка №5');
	});

	it('показывает, кто взял заявку', () => {
		expect(ticketStateText({ ...ticket, status: 'active', assigneeName: 'Иван Иванов' }))
			.toBe('Заявка №128\nПричина: бот не понял вопрос\nВ работе: Иван Иванов');
	});

	it('показывает возврат в очередь и закрытие', () => {
		expect(ticketStateText({ ...ticket, status: 'queue', assigneeName: null })).toContain('Снова в очереди');
		expect(ticketStateText({ ...ticket, status: 'closed', assigneeName: 'Иван Иванов' })).toContain('Закрыта');
	});
});
