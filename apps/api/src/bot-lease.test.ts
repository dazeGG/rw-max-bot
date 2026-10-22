import { describe, expect, it } from 'vitest';

import { BotLease } from './bot-lease';

describe('аренда бота', () => {
	const setup = () => {
		let now = 0;
		const lease = new BotLease(30_000, () => now);
		const advance = (ms: number) => {
			now += ms;
		};

		return { lease, advance };
	};

	it('второй экземпляр не получает аренду, пока первый ее продлевает', () => {
		const { lease, advance } = setup();

		expect(lease.acquire('first')).toBe(true);
		advance(10_000);
		expect(lease.acquire('first')).toBe(true);
		advance(25_000);
		expect(lease.acquire('second')).toBe(false);
	});

	it('аренда переходит к другому экземпляру, когда истекла', () => {
		const { lease, advance } = setup();

		lease.acquire('first');
		advance(30_001);

		expect(lease.acquire('second')).toBe(true);
		expect(lease.acquire('first')).toBe(false);
	});

	it('освобожденную аренду сразу получает другой экземпляр', () => {
		const { lease } = setup();

		lease.acquire('first');
		lease.release('second');
		expect(lease.acquire('second')).toBe(false);

		lease.release('first');
		expect(lease.acquire('second')).toBe(true);
	});
});
