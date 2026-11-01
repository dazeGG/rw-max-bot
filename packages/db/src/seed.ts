// Заливает начальный контент в пустую БД. Повторный запуск без --force ничего не меняет,
// чтобы не затереть правки из админки.

import { pool } from './client';
import { seedContent } from './seed-content';

const force = process.argv.includes('--force');

// На сервере источник правды — БД: --force стер бы правки из админки и сессии пользователей
if (force && process.env.NODE_ENV === 'production') {
	console.error('--force is not allowed in production: it would erase edits made in the admin panel');
	process.exit(1);
}

const seeded = await seedContent({ force });

console.log(seeded > 0 ? `Seeded ${seeded} content nodes` : 'Content already exists. Use --force to replace it.');
await pool.end();
