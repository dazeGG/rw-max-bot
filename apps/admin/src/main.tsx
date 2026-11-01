import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { App } from './App';
import { queryClient } from './session';
import './styles.css';

// Роутер данных нужен для предупреждения о несохраненных правках при переходе (useBlocker)
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<ConfigProvider locale={ruRU}>
			<AntApp>
				<QueryClientProvider client={queryClient}>
					<RouterProvider router={router} />
				</QueryClientProvider>
			</AntApp>
		</ConfigProvider>
	</StrictMode>,
);
