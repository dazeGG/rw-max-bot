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
	ContentVersionDiff,
	ContentVersionEntry,
	CreateNodeRequest,
	CreateStaffRequest,
	InviteInfo,
	LoginRequest,
	MaxLinkInfo,
	MaxLinkStatus,
	MaxLoginInfo,
	MaxLoginPoll,
	MoveNodeRequest,
	PassengerQuestion,
	QuestionReviewRequest,
	QuestionStats,
	SearchCheckResult,
	SupportAttachment,
	SupportCounts,
	SupportStaffMember,
	SupportTab,
	SupportTemplate,
	SupportTemplateRequest,
	SupportTicketDetail,
	SupportTicketSummary,
	Settings,
	StaffInvite,
	StaffMember,
	StatsPeriod,
	StatsResponse,
	UpdateNodeRequest,
	UpdateSettingsRequest,
	UpdateStaffRequest,
	UploadKind,
	UploadResult,
} from '@rw/core';

export class UnauthorizedError extends Error {}

// Запись опоздала: данные на сервере уже изменились
export class ConflictError extends Error {}

// Привязку MAX сбросили, пока сотрудник работал
export class MaxLinkRequiredError extends Error {}

const parse = async <T>(response: Response): Promise<T> => {
	if (!response.ok) {
		const body = await response.json().catch(() => null) as ApiError | null;
		const message = body?.error ?? `Ошибка ${response.status}`;

		if (response.status === 401) {
			throw new UnauthorizedError(message);
		}

		if (body?.code === 'max_link_required') {
			throw new MaxLinkRequiredError(message);
		}

		throw response.status === 409 ? new ConflictError(message) : new Error(message);
	}

	return response.status === 204 ? undefined as T : await response.json() as T;
};

const request = async <T>(path: string, init: { method?: string; body?: unknown; } = {}): Promise<T> => parse<T>(await fetch(`/api${path}`, {
	method: init.method ?? 'GET',
	headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
	body: init.body === undefined ? undefined : JSON.stringify(init.body),
}));

export const supportFileUrl = (path: string) => `/api/support/files/${path.split('/').map(encodeURIComponent).join('/')}`;

export const mediaUrl = (path: string) => `/api/content/media/${path.split('/').map(encodeURIComponent).join('/')}`;

export const api = {
	me: () => request<AdminUser>('/auth/me'),
	login: (body: LoginRequest) => request<AdminUser>('/auth/login', { method: 'POST', body }),
	createMaxLogin: () => request<MaxLoginInfo>('/auth/max-login', { method: 'POST' }),
	pollMaxLogin: (token: string) => request<MaxLoginPoll>('/auth/max-login/poll', { method: 'POST', body: { token } }),
	logout: () => request<void>('/auth/logout', { method: 'POST' }),
	logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
	changePassword: (body: ChangePasswordRequest) => request<void>('/auth/password', { method: 'POST', body }),
	createMaxLink: () => request<MaxLinkInfo>('/auth/max-link', { method: 'POST' }),
	maxLinkStatus: () => request<MaxLinkStatus>('/auth/max-link'),
	setMaxNotify: (enabled: boolean) => request<void>('/auth/max-notify', { method: 'PUT', body: { enabled } }),
	invite: (token: string) => request<InviteInfo>(`/invites/${encodeURIComponent(token)}`),
	acceptInvite: (token: string, body: AcceptInviteRequest) => request<AdminUser>(`/invites/${encodeURIComponent(token)}`, { method: 'POST', body }),
	content: () => request<ContentResponse>('/content'),
	createNode: (body: CreateNodeRequest) => request<AdminContentNode>('/content/nodes', { method: 'POST', body }),
	updateNode: (id: number, body: UpdateNodeRequest) => request<AdminContentNode>(`/content/nodes/${id}`, { method: 'PATCH', body }),
	moveNode: (id: number, body: MoveNodeRequest) => request<void>(`/content/nodes/${id}/move`, { method: 'POST', body }),
	deleteNode: (id: number) => request<void>(`/content/nodes/${id}`, { method: 'DELETE' }),
	applyContent: () => request<ContentApplied>('/content/apply', { method: 'POST' }),
	supportCounts: () => request<SupportCounts>('/support/counts'),
	supportTickets: (tab: SupportTab, search: string) => request<SupportTicketSummary[]>(`/support/tickets?tab=${tab}&search=${encodeURIComponent(search)}`),
	supportTicket: (id: number) => request<SupportTicketDetail>(`/support/tickets/${id}`),
	supportStaff: () => request<SupportStaffMember[]>('/support/staff'),
	takeTicket: (id: number) => request<void>(`/support/tickets/${id}/take`, { method: 'POST' }),
	releaseTicket: (id: number) => request<void>(`/support/tickets/${id}/release`, { method: 'POST' }),
	releaseMyTickets: () => request<{ released: number; }>('/support/tickets/release-mine', { method: 'POST' }),
	transferTicket: (id: number, adminId: number) => request<void>(`/support/tickets/${id}/transfer`, { method: 'POST', body: { adminId } }),
	closeTicket: (id: number) => request<void>(`/support/tickets/${id}/close`, { method: 'POST' }),
	replyToTicket: (id: number, text: string, attachments: SupportAttachment[]) => request<void>(`/support/tickets/${id}/messages`, { method: 'POST', body: { text, attachments } }),
	uploadSupportFile: async (kind: UploadKind, file: File) => parse<UploadResult>(await fetch(`/api/support/uploads?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
		method: 'POST',
		headers: { 'content-type': 'application/octet-stream' },
		body: file,
	})),
	supportTemplates: () => request<SupportTemplate[]>('/support/templates'),
	createSupportTemplate: (body: SupportTemplateRequest) => request<SupportTemplate>('/support/templates', { method: 'POST', body }),
	updateSupportTemplate: (id: number, body: SupportTemplateRequest) => request<SupportTemplate>(`/support/templates/${id}`, { method: 'PUT', body }),
	deleteSupportTemplate: (id: number) => request<void>(`/support/templates/${id}`, { method: 'DELETE' }),
	questions: () => request<PassengerQuestion[]>('/questions'),
	questionStats: () => request<QuestionStats>('/questions/stats'),
	stats: (days: StatsPeriod) => request<StatsResponse>(`/stats?days=${days}`),
	reviewQuestion: (body: QuestionReviewRequest) => request<void>('/questions/reviews', { method: 'POST', body }),
	undoQuestionReview: (key: string) => request<void>(`/questions/reviews/${key}`, { method: 'DELETE' }),
	checkSearch: (text: string) => request<SearchCheckResult>('/questions/check', { method: 'POST', body: { text } }),
	upload: async (kind: UploadKind | 'table', file: File) => parse<UploadResult>(await fetch(`/api/content/uploads?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
		method: 'POST',
		headers: { 'content-type': 'application/octet-stream' },
		body: file,
	})),
	updateSettings: (body: UpdateSettingsRequest) => request<Settings>('/content/settings', { method: 'PATCH', body }),
	contentVersions: () => request<ContentVersionEntry[]>('/content/versions'),
	contentVersionDiff: (version: string) => request<ContentVersionDiff>(`/content/versions/${encodeURIComponent(version)}`),
	restoreContentVersion: (version: string) => request<void>(`/content/versions/${encodeURIComponent(version)}/restore`, { method: 'POST' }),
	staff: () => request<StaffMember[]>('/staff'),
	createStaff: (body: CreateStaffRequest) => request<StaffInvite>('/staff', { method: 'POST', body }),
	updateStaff: (id: number, body: UpdateStaffRequest) => request<void>(`/staff/${id}`, { method: 'PATCH', body }),
	reissueInvite: (id: number) => request<StaffInvite>(`/staff/${id}/invite`, { method: 'POST' }),
	resetStaffMax: (id: number) => request<void>(`/staff/${id}/max-reset`, { method: 'POST' }),
	disableStaff: (id: number) => request<void>(`/staff/${id}/disable`, { method: 'POST' }),
	enableStaff: (id: number) => request<void>(`/staff/${id}/enable`, { method: 'POST' }),
	auditLog: () => request<AuditEntry[]>('/audit-log'),
};
