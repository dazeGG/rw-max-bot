// Создать пользователя админки или сменить ему пароль:
//
//   pnpm admin:create <логин> [--role admin|editor]
//
// Пароль спрашивается в консоли, чтобы не оставаться в истории команд.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { db, admins, pool } from '@rw/db';

import { hashPassword } from '../auth/password';

const MIN_PASSWORD_LENGTH = 8;

const args = process.argv.slice(2);
const login = args.find(arg => !arg.startsWith('--'))?.trim();
const roleIndex = args.indexOf('--role');
const role = roleIndex === -1 ? 'admin' : args[roleIndex + 1];

if (!login || (role !== 'admin' && role !== 'editor')) {
	console.error('Usage: pnpm admin:create <login> [--role admin|editor]');
	process.exit(1);
}

// Построчное чтение вместо rl.question: question теряет строки, пришедшие разом через pipe
const rl = readline.createInterface({ input: stdin });
const lines = rl[Symbol.asyncIterator]();

const ask = async (prompt: string): Promise<string> => {
	stdout.write(prompt);
	const { value } = await lines.next();
	return typeof value === 'string' ? value : '';
};

const password = await ask('Пароль: ');
const repeat = await ask('Пароль еще раз: ');
rl.close();

if (password !== repeat) {
	console.error('Пароли не совпадают');
	process.exit(1);
}

if (password.length < MIN_PASSWORD_LENGTH) {
	console.error(`Пароль короче ${MIN_PASSWORD_LENGTH} символов`);
	process.exit(1);
}

const passwordHash = await hashPassword(password);

await db.insert(admins)
	.values({ login, passwordHash, role })
	.onConflictDoUpdate({ target: admins.login, set: { passwordHash, role, isActive: true } });

console.log(`Пользователь «${login}» (${role}) сохранен`);
await pool.end();
