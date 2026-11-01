// Только типы из @rw/core: код движка и начальный контент в сборку админки не попадают
import type {
	AcceptInviteRequest,
	AdminContentNode,
	AdminUser,
	ApiError,
	AuditEntry,
	ChangePasswordRequest,
	ContentApplied,
	ContentResponse,
	CreateNodeRequest,
	CreateStaffRequest,
	InviteInfo,
	LoginRequest,
	MoveNodeRequest,
	StaffInvite,
	StaffMember,
	UpdateNodeRequest,
	UpdateStaffRequest,
} from '@rw/core';

export class UnauthorizedError extends Error {}

// Запись опоздала: данные на сервере уже изменились
export class ConflictError extends Error {}

const request = async <T>(path: string, init: { method?: string; body?: unknown; } = {}): Promise<T> => {
	const response = await fetch(`/api${path}`, {
		method: init.method ?? 'GET',
		headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});

	if (!response.ok) {
		const body = await response.json().catch(() => null) as ApiError | null;
		const message = body?.error ?? `Ошибка ${response.status}`;

		if (response.status === 401) {
			throw new UnauthorizedError(message);
		}

		throw response.status === 409 ? new ConflictError(message) : new Error(message);
	}

	return response.status === 204 ? undefined as T : await response.json() as T;
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
	createNode: (body: CreateNodeRequest) => request<AdminContentNode>('/content/nodes', { method: 'POST', body }),
	updateNode: (id: number, body: UpdateNodeRequest) => request<AdminContentNode>(`/content/nodes/${id}`, { method: 'PATCH', body }),
	moveNode: (id: number, body: MoveNodeRequest) => request<void>(`/content/nodes/${id}/move`, { method: 'POST', body }),
	deleteNode: (id: number) => request<void>(`/content/nodes/${id}`, { method: 'DELETE' }),
	applyContent: () => request<ContentApplied>('/content/apply', { method: 'POST' }),
	staff: () => request<StaffMember[]>('/staff'),
	createStaff: (body: CreateStaffRequest) => request<StaffInvite>('/staff', { method: 'POST', body }),
	updateStaff: (id: number, body: UpdateStaffRequest) => request<void>(`/staff/${id}`, { method: 'PATCH', body }),
	reissueInvite: (id: number) => request<StaffInvite>(`/staff/${id}/invite`, { method: 'POST' }),
	disableStaff: (id: number) => request<void>(`/staff/${id}/disable`, { method: 'POST' }),
	enableStaff: (id: number) => request<void>(`/staff/${id}/enable`, { method: 'POST' }),
	auditLog: () => request<AuditEntry[]>('/audit-log'),
};
