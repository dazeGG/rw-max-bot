import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password';

describe('пароли админки', () => {
	it('принимает верный пароль и отклоняет неверный', async () => {
		const hash = await hashPassword('секретный пароль');

		expect(await verifyPassword('секретный пароль', hash)).toBe(true);
		expect(await verifyPassword('другой пароль', hash)).toBe(false);
	});

	it('для одного пароля каждый раз новая соль', async () => {
		expect(await hashPassword('password1')).not.toBe(await hashPassword('password1'));
	});

	it('не падает на испорченном хеше', async () => {
		expect(await verifyPassword('password1', 'plain-text')).toBe(false);
	});
});
