import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

const derive = (password: string, salt: Buffer, length: number) => new Promise<Buffer>((resolve, reject) => {
	scrypt(password, salt, length, (error, key) => error ? reject(error) : resolve(key));
});

// Формат: scrypt$<соль hex>$<ключ hex>
export const hashPassword = async (password: string): Promise<string> => {
	const salt = randomBytes(16);
	const key = await derive(password, salt, KEY_LENGTH);
	return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
	const [scheme, salt, key] = stored.split('$');

	if (scheme !== 'scrypt' || !salt || !key) {
		return false;
	}

	const expected = Buffer.from(key, 'hex');
	const actual = await derive(password, Buffer.from(salt, 'hex'), expected.length);

	return timingSafeEqual(actual, expected);
};
