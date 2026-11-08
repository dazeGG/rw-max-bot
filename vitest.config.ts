import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
		// Модули API требуют эти переменные при импорте; к базе тесты не подключаются
		env: { DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused', INTERNAL_API_TOKEN: 'test-token' },
	},
});
