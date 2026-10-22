// Заливает начальный контент в пустую БД. Повторный запуск без --force ничего не меняет,
// чтобы не затереть правки из админки.

import { pool } from './client';
import { seedContent } from './seed-content';

const seeded = await seedContent({ force: process.argv.includes('--force') });

console.log(seeded > 0 ? `Seeded ${seeded} content nodes` : 'Content already exists. Use --force to replace it.');
await pool.end();
