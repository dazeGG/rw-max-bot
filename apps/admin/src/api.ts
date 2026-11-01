// Только типы из @rw/core: код движка и начальный контент в сборку админки не попадают
import type {
	AcceptInviteRequest,
	AdminUser,
	ApiError,
	AuditEntry,
	ChangePasswordRequest,
	ContentNode,
	CreateStaffRequest,
	InviteInfo,
	LoginRequest,
	Settings,
	StaffInvite,
	StaffMember,
	UpdateStaffRequest,
} from '@rw/core';

export class UnauthorizedError extends Error {}

const request = async <T>(path: string, init: { method?: string; body?: unknown; } = {}): Promise<T> => {
	const response = await fetch(`/api${path}`, {
		method: init.method ?? 'GET',
		headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});

	if (!response.ok) {
		const body = await response.json().catch(() => null) as ApiError | null;
		const message = body?.error ?? `Ошибка ${response.status}`;
		throw response.status === 401 ? new UnauthorizedError(message) : new Error(message);
	}

	return response.status === 204 ? undefined as T : await response.json() as T;
};

export type ContentResponse = {
	nodes: ContentNode[];
	settings: Settings;
};

export const api = {
	me: () => request<AdminUser>('/auth/me'),
	login: (body: LoginRequest) => request<AdminUser>('/auth/login', { method: 'POST', body }),
	logout: () => request<void>('/auth/logout', { method: 'POST' }),
	logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
	changePassword: (body: ChangePasswordRequest) => request<void>('/auth/password', { method: 'POST', body }),
	invite: (token: string) => request<InviteInfo>(`/invites/${encodeURIComponent(token)}`),
	acceptInvite: (token: string, body: AcceptInviteRequest) => request<AdminUser>(`/invites/${encodeURIComponent(token)}`, { method: 'POST', body }),
	content: () => request<ContentResponse>('/content'),
	staff: () => request<StaffMember[]>('/staff'),
	createStaff: (body: CreateStaffRequest) => request<StaffInvite>('/staff', { method: 'POST', body }),
	updateStaff: (id: number, body: UpdateStaffRequest) => request<void>(`/staff/${id}`, { method: 'PATCH', body }),
	reissueInvite: (id: number) => request<StaffInvite>(`/staff/${id}/invite`, { method: 'POST' }),
	disableStaff: (id: number) => request<void>(`/staff/${id}/disable`, { method: 'POST' }),
	enableStaff: (id: number) => request<void>(`/staff/${id}/enable`, { method: 'POST' }),
	auditLog: () => request<AuditEntry[]>('/audit-log'),
};
