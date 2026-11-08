// Контракты HTTP API: общие для API, бота и админки

import type { ContentNode, NodeType, SettingKey, Settings } from './content/types';

// Контент для бота. version меняется при любой правке, бот передает ее в If-None-Match
export type ContentSnapshot = {
	version: string;
	nodes: ContentNode[];
	settings: Settings;
};

// Запись журнала для статистики (POST /internal/events). type — тип из DialogEventType или тип обновления MAX
// (bot_stopped, message_edited…). Неизменные поля — колонки, все подробности — в data и raw (jsonb): их состав
// можно расширять без миграций, data.v — версия формата
export type DialogEventRecord = {
	userId: number;
	type: string;
	nodeId: number | null;
	nodeCode: string | null;
	contentVersion: string | null;
	text: string | null;
	data: Record<string, unknown>;
	// Исходное обновление MAX целиком
	raw: unknown;
	// Когда бот получил обновление (ISO 8601)
	createdAt: string;
};

export type BotLeaseRequest = {
	instanceId: string;
};

// Бот продлевает аренду втрое чаще, чем она истекает: одна потерянная попытка не отдает ее другому экземпляру
export const BOT_LEASE_TTL_SECONDS = 30;
export const BOT_LEASE_RENEW_SECONDS = 10;

export type AdminContentNode = ContentNode & {
	updatedAt: string;
	updatedBy: string | null;
};

export type ContentResponse = {
	nodes: AdminContentNode[];
	settings: Settings;
};

export type CreateNodeRequest = {
	parentId: number;
	type: NodeType;
	title: string;
	url?: string;
	targetId?: number;
};

// updatedAt — версия раздела, которую правил сотрудник. Отсутствующие поля не меняются
export type UpdateNodeRequest = {
	updatedAt: string;
	title?: string;
	text?: string | null;
	url?: string | null;
	targetId?: number | null;
	synonyms?: string[];
	image?: string | null;
	imageText?: string | null;
	file?: string | null;
	fileName?: string | null;
	isActive?: boolean;
	isHidden?: boolean;
};

export type UploadKind = 'image' | 'file';

// path — куда лег файл на сервере: его указывают в разделе при сохранении
export type UploadResult = {
	path: string;
	name: string;
	size: number;
};

export type MoveNodeRequest = {
	parentId: number;
	// Место среди разделов нового родителя, без учета самого раздела
	index: number;
};

export type QuestionSource = 'unrecognized' | 'noOption';

export type QuestionReviewStatus = 'dismissed' | 'resolved';

// Одинаковые вопросы объединены. phrase — вопрос без приветствия: готовая поисковая фраза.
// offered — что бот предлагал и пассажиру не подошло, suggestions — подходящие разделы по мнению поиска
export type PassengerQuestion = {
	key: string;
	text: string;
	phrase: string;
	sources: Record<QuestionSource, number>;
	count: number;
	people: number;
	lastAt: string;
	offered: string[];
	suggestions: SearchCheckNode[];
};

export type QuestionStats = {
	// Сколько вопросов за неделю сотрудники разобрали: добавили фразу к разделу или создали раздел
	resolvedWeek: number;
};

export type QuestionReviewRequest = {
	key: string;
	status: QuestionReviewStatus;
};

export type SearchCheckRequest = {
	text: string;
};

export type SearchCheckNode = {
	id: number;
	title: string;
};

// answer — ответит сразу; clarify — уточнит, handoff — последний пункт для тех, кому варианты не подошли;
// none — не поймет; service — приветствие или команда меню, до поиска фраза не дойдет
export type SearchCheckResult =
	| { kind: 'answer'; node: SearchCheckNode; }
	| { kind: 'clarify'; options: SearchCheckNode[]; handoff: string | null; }
	| { kind: 'none'; }
	| { kind: 'service'; };

export type SupportStatus = 'queue' | 'active' | 'closed';

// open — свободные и в работе: поддержка видит из них только свои, суперадмин и админ — все
export type SupportTab = 'open' | 'mine' | 'closed';

// Почему пассажир пришел к оператору: бот не понял, не подошли варианты уточнения или попросил сам
export type SupportReason = 'unrecognized' | 'noOption' | 'asked';

// unavailable — пассажир прислал то, что нельзя показать в чате: видео, стикер, запрещенный тип файла
export type SupportAttachment = {
	kind: 'image' | 'file' | 'unavailable';
	path: string;
	name: string;
	size?: number;
};

export type SupportTicketSummary = {
	id: number;
	status: SupportStatus;
	passenger: string;
	assigneeId: number | null;
	assigneeName: string | null;
	preview: string | null;
	// Первое сообщение пассажира: тема обращения
	topic: string | null;
	waiting: boolean;
	// С какого момента пассажир ждет ответа и сколько сообщений написал после последнего ответа сотрудника
	waitingSince: string | null;
	unanswered: number;
	reason: SupportReason | null;
	botMisses: number;
	createdAt: string;
	lastMessageAt: string;
	closedAt: string | null;
};

// delivery: pending — отправляется, failed — пассажир не получил. Только у сообщений сотрудников
export type SupportMessage = {
	id: number;
	sender: 'passenger' | 'staff' | 'system';
	authorName: string | null;
	text: string;
	attachments: SupportAttachment[];
	delivery: 'pending' | 'sent' | 'failed' | null;
	createdAt: string;
};

export type SupportHistoryEntry = {
	question: string | null;
	answer: string;
	at: string;
};

export type SupportTicketDetail = SupportTicketSummary & {
	messages: SupportMessage[];
	card: {
		userId: number;
		name: string;
		username: string | null;
		firstSeenAt: string | null;
		isBlocked: boolean;
		firstTicketAt: string;
		ticketCount: number;
		botQuestions: number;
	};
	past: SupportTicketSummary[];
	history: SupportHistoryEntry[];
};

export type SupportCounts = {
	queue: number;
	open: number;
	mine: number;
	waiting: number;
};

export type SupportTemplate = {
	id: number;
	title: string;
	command: string;
	text: string;
};

export type SupportTemplateRequest = Omit<SupportTemplate, 'id'>;

export type SupportReplyRequest = {
	text: string;
	attachments: SupportAttachment[];
};

export type SupportTransferRequest = {
	adminId: number;
};

export type SupportStaffMember = {
	id: number;
	fullName: string;
};

// В потоке нет ни текста, ни имен: данные браузер читает обычным запросом, где проверяются вход и роль
export type SupportEvent = {
	ticketId: number;
	kind: 'queued' | 'message' | 'changed';
	assigneeId: number | null;
};

export type SupportInboundRequest = {
	userId: number;
	text: string;
	mid: string | null;
	attachments: SupportAttachment[];
	// Пассажир заново запустил бота
	start: boolean;
};

// none — обращения нет, отвечает бот; stored — передано сотрудникам; cancelled — пассажир передумал, снова отвечает бот
export type SupportInboundResult =
	| { action: 'none' | 'stored'; }
	| { action: 'cancelled'; text: string; };

export type SupportSendRequest = {
	userId: number;
	text: string;
	attachments: SupportAttachment[];
	// Служебный текст из настроек: в нем уже есть разметка, и подпись поддержки ему не нужна
	notice?: boolean;
};

export type SupportSendResult = { ok: true; } | { ok: false; error: string; };

// Уведомление сотруднику в MAX: новое по userId или обновление отправленного по mid
export type StaffNotifyRequest = { text: string; url: string; } & ({ userId: number; } | { mid: string; });

export type StaffNotifyResult = { ok: true; mid: string; } | { ok: false; error: string; };

export type ContentApplied = {
	version: string;
};

export type SettingChange = {
	key: SettingKey;
	value: string;
	// Значение, которое правил сотрудник: если оно уже другое, правка не применится
	previous: string;
};

export type UpdateSettingsRequest = {
	changes: SettingChange[];
};

export type ContentVersionEntry = {
	id: string;
	version: string;
	createdAt: string;
	// null — изменение не из админки или начальное состояние
	actorName: string | null;
	action: string | null;
	title: string | null;
	fields: string[];
	current: boolean;
	restorable: boolean;
};

// Что изменится при возврате к версии: названия разделов и число служебных текстов
export type ContentVersionDiff = {
	changed: string[];
	returned: string[];
	removed: string[];
	settings: number;
};

export type AdminRole = 'superadmin' | 'admin' | 'support';

export type AdminUser = {
	id: number;
	login: string;
	fullName: string;
	role: AdminRole;
	maxLinked: boolean;
	maxNotify: boolean;
	// Без привязки админка закрыта. Правило считает API, интерфейс только показывает экран привязки
	maxLinkRequired: boolean;
};

// Код привязки сотрудника в ссылке на бота; без этого префикса запуск по ссылке — обычный старт диалога
export const STAFF_LINK_PREFIX = 'staff_';

export type MaxLinkInfo = {
	url: string;
	expiresAt: string;
};

// done — кода больше нет: профиль привязан
export type MaxLinkStatus = {
	status: 'pending' | 'done' | 'expired';
};

export type UpdateMaxNotifyRequest = {
	enabled: boolean;
};

export type StaffMaxLinkRequest = {
	code: string;
	userId: number;
};

export type StaffMaxLinkResult =
	| { status: 'linked'; fullName: string; }
	| { status: 'invalid' | 'taken'; };

export type LoginRequest = {
	login: string;
	password: string;
};

export type ChangePasswordRequest = {
	currentPassword: string;
	newPassword: string;
};

export type InviteInfo = {
	login: string;
	fullName: string;
};

export type AcceptInviteRequest = {
	password: string;
};

export type StaffMember = Omit<AdminUser, 'maxLinkRequired' | 'maxNotify'> & {
	isActive: boolean;
	hasPassword: boolean;
	lastLoginAt: string | null;
	inviteExpiresAt: string | null;
};

export type CreateStaffRequest = {
	login: string;
	fullName: string;
	role: AdminRole;
};

export type UpdateStaffRequest = {
	fullName?: string;
	role?: AdminRole;
};

// Токен показывается один раз: в БД лежит только его хеш
export type StaffInvite = {
	token: string;
	expiresAt: string;
};

export type AuditEntry = {
	id: number;
	actorName: string;
	action: string;
	details: Record<string, unknown>;
	createdAt: string;
};

export type ApiError = {
	error: string;
	code?: 'max_link_required';
};
