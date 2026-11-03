import { MutationCache, QueryCache, QueryClient, useQuery } from '@tanstack/react-query';

import type { AdminRole, AdminUser } from '@rw/core';

import { api, UnauthorizedError } from './api';

const ME_KEY = ['me'];

export const CONTENT_KEY = ['content'];

export const QUESTIONS_KEY = ['questions'];

// Сессия закончилась или сотрудника отключили: возвращаем на форму входа и забываем чужие данные
export const signedOut = () => {
	queryClient.setQueryData(ME_KEY, null);
	queryClient.removeQueries({ predicate: query => query.queryKey[0] !== ME_KEY[0] });
};

export const signedIn = (user: AdminUser) => {
	queryClient.setQueryData(ME_KEY, user);
};

const onError = (error: unknown) => {
	if (error instanceof UnauthorizedError) {
		signedOut();
	}
};

export const queryClient = new QueryClient({
	queryCache: new QueryCache({ onError }),
	mutationCache: new MutationCache({ onError }),
	defaultOptions: {
		queries: {
			retry: (count, error) => !(error instanceof UnauthorizedError) && count < 2,
		},
	},
});

// null — не вошел. Роль перечитывается при возврате на вкладку: ее могли сменить
export const useMe = () => useQuery({
	queryKey: ME_KEY,
	queryFn: () => api.me().catch((error: unknown) => {
		if (error instanceof UnauthorizedError) {
			return null;
		}

		throw error;
	}),
});

export const ROLE_LABELS: Record<AdminRole, string> = {
	superadmin: 'Суперадмин',
	admin: 'Админ',
	support: 'Поддержка',
};

export const isManager = (role: AdminRole) => role !== 'support';

export const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
