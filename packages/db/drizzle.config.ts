import path from 'node:path';

import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit собирает конфиг в CommonJS, где нет import.meta.dirname; запускается из packages/db
config({ path: path.resolve('../../.env'), quiet: true });

export default defineConfig({
	dialect: 'postgresql',
	schema: './src/schema.ts',
	out: './drizzle',
	dbCredentials: {
		url: process.env.DATABASE_URL ?? '',
	},
});
