import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		// В разработке запросы /api уходят в локальный API; на сервере это делает nginx
		proxy: {
			'/api': 'http://127.0.0.1:3001',
		},
	},
});
