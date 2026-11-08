// Создать первого суперадмина или сбросить пароль сотруднику, если зайти больше некому:
//
//   pnpm admin:create <логин> [--role superadmin|admin|support]
//
// Новый сотрудник без --role становится суперадмином, у существующего без --role роль не меняется.
// Пароль спрашивается в консоли, чтобы не оставаться в истории команд.

import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { eq } from 'drizzle-orm';

import type { AdminRole } from '@rw/core';
import { adminInvites, adminSessions, admins, db, pool } from '@rw/db';

import { hashPassword } from '../auth/password';
import { MIN_PASSWORD_LENGTH, STAFF_ROLES } from '../auth/permissions';

const args = process.argv.slice(2);
const roleIndex = args.indexOf('--role');
const roleArg = roleIndex === -1 ? undefined : args[roleIndex + 1] as AdminRole | undefined;
const login = args.find(arg => !arg.startsWith('--') && arg !== roleArg)?.trim();

if (!login || (roleIndex !== -1 && !STAFF_ROLES.includes(roleArg!))) {
	console.error(`Usage: pnpm admin:create <login> [--role ${STAFF_ROLES.join('|')}]`);
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

const [saved] = await db.insert(admins)
	.values({ login, fullName: login, passwordHash, role: roleArg ?? 'superadmin', maxNotify: roleArg === 'support' })
	.onConflictDoUpdate({ target: admins.login, set: { passwordHash, isActive: true, ...roleArg && { role: roleArg } } })
	.returning();

// Старый пароль мог утечь: прежние входы и ссылки больше не действуют
await db.delete(adminSessions).where(eq(adminSessions.adminId, saved.id));
await db.delete(adminInvites).where(eq(adminInvites.adminId, saved.id));

console.log(`Сотрудник «${login}» (${saved.role}) сохранен`);
await pool.end();
