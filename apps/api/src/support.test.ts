import { describe, expect, it } from 'vitest';

import { ticketReason } from './support';

const event = (type: string, data: Record<string, unknown> = {}) => ({ type, data });

describe('ticketReason', () => {
	it('reports the rejected options when the last step was a clarification with the handoff item', () => {
		expect(ticketReason([event('clarify', { handoff: 'operator' }), event('unrecognized')])).toEqual({ reason: 'noOption', misses: 1 });
	});

	it('counts the messages the bot did not understand', () => {
		expect(ticketReason([event('menu'), event('unrecognized'), event('answer'), event('unrecognized')])).toEqual({ reason: 'unrecognized', misses: 2 });
	});

	it('does not blame the options when the passenger picked the operator among them', () => {
		expect(ticketReason([event('clarify', { handoff: 'support' })])).toEqual({ reason: 'asked', misses: 0 });
	});

	it('treats a clarification without the handoff item as a plain request', () => {
		expect(ticketReason([event('clarify')])).toEqual({ reason: 'asked', misses: 0 });
	});

	it('treats a passenger without dialog events as a plain request', () => {
		expect(ticketReason([])).toEqual({ reason: 'asked', misses: 0 });
	});
});
