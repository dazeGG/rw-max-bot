import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db, pool } from './client';
import { MIGRATIONS_DIR } from './setup';

await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
await pool.end();

console.log('Migrations applied');
