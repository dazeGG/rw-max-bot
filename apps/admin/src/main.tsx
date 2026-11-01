import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import { App } from './App';
import { queryClient } from './session';
import './styles.css';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ConfigProvider locale={ruRU}>
			<AntApp>
				<QueryClientProvider client={queryClient}>
					<BrowserRouter>
						<App />
					</BrowserRouter>
				</QueryClientProvider>
			</AntApp>
		</ConfigProvider>
	</StrictMode>,
);
