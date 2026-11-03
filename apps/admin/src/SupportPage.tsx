// Чат поддержки: слева обращения, по центру переписка, справа карточка пассажира.
// Новые события приходят через SSE, а данные читаются обычными запросами с проверкой входа и роли

import { CheckOutlined, ClockCircleOutlined, InfoCircleOutlined, PaperClipOutlined, RightOutlined, RobotOutlined, SendOutlined, SwapOutlined, ThunderboltOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Badge, Button, Card, Collapse, Divider, Dropdown, Input, Mentions, Modal, Segmented, Select, Tag, Tooltip, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import type { AdminUser, SupportAttachment, SupportEvent, SupportHistoryEntry, SupportMessage, SupportReason, SupportTab, SupportTemplate, SupportTicketDetail, SupportTicketSummary } from '@rw/core';

import { api, supportFileUrl } from './api';
import { formatDay, formatTime, formatWhen, plural } from './labels';
import { PageHeader, passengerInitials, PersonAvatar, shortName } from './page';
import { errorText, isManager, queryClient } from './session';
import { TEMPLATE_TEXT_LIMIT, TemplatesDrawer, useTemplates } from './SupportTemplates';

const SUPPORT_KEY = 'support';
const TITLE = 'ЖДЯ-бот';
const MESSAGE_LIMIT = TEMPLATE_TEXT_LIMIT;
const RECONNECT_MS = 5000;
const SILENCE_MS = 70_000;
const MEGABYTE = 1024 * 1024;
const SIZE_LIMIT = { image: 10 * MEGABYTE, file: 50 * MEGABYTE };
const IMAGE_EXTENSION = /\.(jpe?g|png|gif)$/i;
const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.rtf,.txt,.csv,.zip,.jpg,.jpeg,.png,.gif';

// После этого времени ожидание выделяется цветом
const LONG_WAIT_MINUTES = 10;
const TICK_MS = 30_000;
const SEARCH_DELAY_MS = 300;
const QUEUE = 'queue';

const reasonLabel = ({ reason, botMisses }: Pick<SupportTicketSummary, 'reason' | 'botMisses'>) => {
	const labels: Record<SupportReason, string> = {
		unrecognized: `Бот не понял ${botMisses} ${plural(botMisses, ['раз', 'раза', 'раз'])}`,
		noOption: 'Нет подходящего варианта',
		asked: 'Попросил оператора',
	};

	return reason ? labels[reason] : null;
};

// Минуты ожидания сами не обновятся: новых событий в это время может не быть
const useNow = () => {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), TICK_MS);

		return () => clearInterval(timer);
	}, []);

	return now;
};

const minutesSince = (value: string, now: number) => Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));

const waitText = (minutes: number) => {
	if (minutes < 1) {
		return 'только что';
	}

	if (minutes < 60) {
		return `ждёт ${minutes} мин`;
	}

	return minutes < 1440 ? `ждёт ${Math.floor(minutes / 60)} ч` : `ждёт ${Math.floor(minutes / 1440)} дн`;
};

const useDebounced = (value: string) => {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), SEARCH_DELAY_MS);

		return () => clearTimeout(timer);
	}, [value]);

	return debounced;
};

const refresh = () => queryClient.invalidateQueries({ queryKey: [SUPPORT_KEY] });

// Браузер разрешает звук только после действия пользователя на странице: до него сигнал просто не прозвучит
const playSignal = () => {
	try {
		const audio = new AudioContext();
		const tone = audio.createOscillator();
		const gain = audio.createGain();

		tone.frequency.value = 880;
		gain.gain.setValueAtTime(0.15, audio.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
		tone.connect(gain).connect(audio.destination);
		tone.start();
		tone.stop(audio.currentTime + 0.4);
		tone.onended = () => void audio.close();
	} catch {
		// Сигнал не важнее работы: счетчик и список обновятся в любом случае
	}
};

const notifySystem = (title: string, ticketId: number) => {
	if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
		const notification = new Notification(title, { tag: `ticket-${ticketId}` });

		notification.onclick = () => {
			window.focus();
			window.location.assign(`/support/${ticketId}`);
		};
	}
};

// Живет на всех страницах админки: чат можно держать в фоне. Возвращает, сколько обращений ждет сотрудника
export const useSupportFeed = (user: AdminUser) => {
	const counts = useQuery({ queryKey: [SUPPORT_KEY, 'counts'], queryFn: api.supportCounts });
	const userId = useRef(user.id);

	useEffect(() => {
		let stream: EventSource;
		let timer: ReturnType<typeof setTimeout>;

		// Сервер шлет ping каждые 25 секунд. Если его нет, соединение зависло, а браузер этого сам не заметит:
		// например, уснул ноутбук или оборвался VPN
		const expectPing = () => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				stream.close();
				connect();
			}, SILENCE_MS);
		};

		const connect = () => {
			stream = new EventSource('/api/support/stream');
			expectPing();
			stream.addEventListener('ping', expectPing);

			stream.onmessage = ({ data }: MessageEvent<string>) => {
				const event = JSON.parse(data) as SupportEvent;

				void refresh();

				if (event.kind === 'queued') {
					playSignal();
					notifySystem('Новое обращение в очереди', event.ticketId);
				} else if (event.kind === 'message' && event.assigneeId === userId.current) {
					playSignal();
					notifySystem('Новое сообщение от пассажира', event.ticketId);
				}
			};
			// Соединение могло оборваться, и часть событий потерялась
			stream.onopen = () => {
				expectPing();
				void refresh();
			};
			// После обрыва браузер подключается сам, а после ответа с ошибкой сдается: так бывает, пока перезапускается API.
			// Если вход закончился, запрос в refresh выведет сотрудника на страницу входа
			stream.onerror = () => {
				if (stream.readyState === EventSource.CLOSED) {
					void refresh();
					clearTimeout(timer);
					timer = setTimeout(connect, RECONNECT_MS);
				}
			};
		};

		connect();

		return () => {
			clearTimeout(timer);
			stream.close();
		};
	}, []);

	const waiting = (counts.data?.queue ?? 0) + (counts.data?.waiting ?? 0);

	useEffect(() => {
		document.title = waiting > 0 ? `(${waiting}) ${TITLE}` : TITLE;

		return () => {
			document.title = TITLE;
		};
	}, [waiting]);

	return waiting;
};

const TicketTime = ({ ticket, now }: { ticket: SupportTicketSummary; now: number; }) => {
	if (ticket.status === 'queue') {
		const minutes = minutesSince(ticket.waitingSince ?? ticket.createdAt, now);

		return <span className={minutes >= LONG_WAIT_MINUTES ? 'long-wait small' : 'muted small'}>{waitText(minutes)}</span>;
	}

	return <span className="muted small">{ticket.status === 'closed' ? formatWhen(ticket.closedAt ?? ticket.lastMessageAt) : formatTime(ticket.lastMessageAt)}</span>;
};

const TicketStatus = ({ ticket, userId }: { ticket: SupportTicketSummary; userId: number; }) => {
	if (ticket.status === 'queue') {
		return <Badge status="processing" text="Свободно" />;
	}

	if (ticket.status === 'closed') {
		return <Badge status="default" text={ticket.assigneeName ? `Закрыто · ${shortName(ticket.assigneeName)}` : 'Закрыто'} />;
	}

	return ticket.assigneeId === userId
		? <Badge status="success" text="У вас" />
		: <Badge status="default" text={`Ведёт ${shortName(ticket.assigneeName ?? '')}`} />;
};

const TicketItem = ({ ticket, selected, userId, now }: { ticket: SupportTicketSummary; selected: boolean; userId: number; now: number; }) => (
	<Link className={selected ? 'ticket selected' : 'ticket'} to={`/support/${ticket.id}`}>
		<PersonAvatar initials={passengerInitials(ticket.passenger)} seed={ticket.passenger} />
		<div className="ticket-body">
			<div className="ticket-head">
				<span className="ticket-name">{ticket.passenger}</span>
				<TicketTime ticket={ticket} now={now} />
			</div>
			<div className="ticket-preview secondary">{ticket.preview ?? 'Пассажир ещё ничего не написал'}</div>
			<div className="ticket-foot">
				<TicketStatus ticket={ticket} userId={userId} />
				{ticket.status === 'queue' && reasonLabel(ticket) && <Tag>{reasonLabel(ticket)}</Tag>}
				{ticket.status === 'active' && ticket.unanswered > 0 && <Badge count={ticket.unanswered} size="small" />}
			</div>
		</div>
	</Link>
);

const TabLabel = ({ title, count }: { title: string; count?: number; }) => (
	<>{title}{Boolean(count) && <> <Badge count={count} overflowCount={999} color="rgba(0, 0, 0, 0.06)" className="muted-badge" /></>}</>
);

const TicketList = ({ user, selectedId }: { user: AdminUser; selectedId: number; }) => {
	const { message } = App.useApp();
	const now = useNow();
	const [tab, setTab] = useState<SupportTab>('open');
	const [search, setSearch] = useState('');
	const query = useDebounced(search.trim());
	const tickets = useQuery({ queryKey: [SUPPORT_KEY, 'list', tab, query], queryFn: () => api.supportTickets(tab, query) });
	const counts = useQuery({ queryKey: [SUPPORT_KEY, 'counts'], queryFn: api.supportCounts });

	const releaseAll = useMutation({
		mutationFn: api.releaseMyTickets,
		onSuccess: ({ released }) => void message.success(`В очередь передано: ${released}`),
		onError: error => void message.error(errorText(error)),
		onSettled: refresh,
	});

	return (
		<section className="support-list" aria-label="Обращения">
			<div className="support-list-head">
				<Segmented<SupportTab>
					value={tab}
					onChange={setTab}
					options={[
						{ value: 'open', label: <TabLabel title="Открытые" count={counts.data?.open} /> },
						{ value: 'mine', label: <TabLabel title="Мои" count={counts.data?.mine} /> },
						{ value: 'closed', label: 'Закрытые' },
					]}
				/>
				<Input.Search allowClear placeholder="Имя или текст сообщения" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} />
			</div>
			<div className="support-items">
				{tickets.isError && <Alert type="error" title={errorText(tickets.error)} />}
				{tickets.data?.length === 0 && <p className="support-empty muted">{query ? 'Ничего не найдено' : 'Здесь пусто'}</p>}
				{tickets.data?.map(ticket => <TicketItem key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} userId={user.id} now={now} />)}
			</div>
			{tab === 'mine' && Boolean(counts.data?.mine) && (
				<div className="support-list-foot">
					<Button block loading={releaseAll.isPending} onClick={() => releaseAll.mutate()}>Конец смены: передать все в очередь</Button>
				</div>
			)}
			{'Notification' in window && Notification.permission === 'default' && (
				<div className="support-list-foot">
					<Button block type="link" onClick={() => void Notification.requestPermission()}>Включить уведомления</Button>
				</div>
			)}
		</section>
	);
};

const Attachment = ({ attachment }: { attachment: SupportAttachment; }) => {
	if (attachment.kind === 'unavailable') {
		return <div className="muted">{attachment.name}</div>;
	}

	const url = supportFileUrl(attachment.path);

	return attachment.kind === 'image'
		? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.name} /></a>
		: <div><a href={url} download={attachment.name}><PaperClipOutlined /> {attachment.name}</a></div>;
};

const Delivery = ({ delivery }: { delivery: SupportMessage['delivery']; }) => {
	switch (delivery) {
	case 'sent':
		return <Tooltip title="Доставлено"><CheckOutlined className="delivered" aria-label="Доставлено" /></Tooltip>;

	case 'pending':
		return <Tooltip title="Отправляется…"><ClockCircleOutlined aria-label="Отправляется" /></Tooltip>;

	default:
		return null;
	}
};

const Message = ({ message }: { message: SupportMessage; }) => {
	if (message.sender === 'system') {
		return <span className="system-line"><UserOutlined /> {message.text} · {formatTime(message.createdAt)}</span>;
	}

	return (
		<div className={`message ${message.sender}${message.delivery === 'failed' ? ' failed' : ''}`}>
			{message.attachments.map(attachment => <Attachment key={`${attachment.path}${attachment.name}`} attachment={attachment} />)}
			{message.text}
			<div className="message-meta">
				{message.authorName && `${shortName(message.authorName)} · `}{formatTime(message.createdAt)}
				<Delivery delivery={message.delivery} />
			</div>
			{message.delivery === 'failed' && <div className="message-meta error">Не доставлено: пассажир не получил это сообщение</div>}
		</div>
	);
};

const kindOf = (file: File) => IMAGE_EXTENSION.test(file.name) ? 'image' as const : 'file' as const;

const TemplatesMenu = ({ templates, onPick, onManage }: { templates: SupportTemplate[]; onPick: (template: SupportTemplate) => void; onManage: () => void; }) => (
	<Dropdown
		trigger={['click']}
		placement="topLeft"
		menu={{
			className: 'templates-menu',
			items: [
				...templates.map(template => ({
					key: template.id,
					label: <TemplateOption template={template} />,
					onClick: () => onPick(template),
				})),
				...templates.length > 0 ? [{ type: 'divider' as const }] : [],
				{ key: 'manage', label: templates.length > 0 ? 'Мои шаблоны…' : 'Создать первый шаблон…', onClick: onManage },
			],
		}}
	>
		<Button type="text" icon={<ThunderboltOutlined />}>Шаблоны</Button>
	</Dropdown>
);

const TemplateOption = ({ template }: { template: SupportTemplate; }) => (
	<div className="template-option">
		<div><b>/{template.command}</b> <span className="muted">{template.title}</span></div>
		<div className="muted small template-option-text">{template.text}</div>
	</div>
);

const Composer = ({ ticketId, onManageTemplates }: { ticketId: number; onManageTemplates: () => void; }) => {
	const { message } = App.useApp();
	const [text, setText] = useState('');
	const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
	const templates = useTemplates();
	const list = templates.data ?? [];

	const upload = useMutation({
		mutationFn: async (file: File) => {
			const kind = kindOf(file);

			if (file.size > SIZE_LIMIT[kind]) {
				throw new Error(`Файл больше ${SIZE_LIMIT[kind] / MEGABYTE} МБ`);
			}

			const saved = await api.uploadSupportFile(kind, file);

			return { kind, path: saved.path, name: saved.name, size: saved.size };
		},
		onSuccess: attachment => setAttachments(current => [...current, attachment]),
		onError: error => void message.error(errorText(error)),
	});

	const send = useMutation({
		mutationFn: () => api.replyToTicket(ticketId, text, attachments),
		onSuccess: () => {
			setText('');
			setAttachments([]);
		},
		onSettled: refresh,
	});

	const canSend = (text.trim() !== '' || attachments.length > 0) && !upload.isPending && !send.isPending;

	// Шаблон дополняет уже написанное: сотрудник мог начать ответ с приветствия
	const insert = (template: SupportTemplate) => setText(current => `${current.trimEnd()}${current.trim() ? '\n' : ''}${template.text}`.slice(0, MESSAGE_LIMIT));

	return (
		<div className="composer">
			{send.isError && <Alert type="error" title={errorText(send.error)} />}
			{attachments.length > 0 && (
				<div className="composer-files">
					{attachments.map(attachment => (
						<Tag
							key={attachment.path}
							closable
							onClose={() => setAttachments(current => current.filter(item => item.path !== attachment.path))}
						>
							{attachment.name}
						</Tag>
					))}
				</div>
			)}
			<Mentions
				prefix="/"
				value={text}
				placement="top"
				maxLength={MESSAGE_LIMIT}
				autoSize={{ minRows: 2, maxRows: 6 }}
				aria-label="Ответ пассажиру"
				placeholder="Ответ пассажиру"
				notFoundContent={null}
				popupClassName="templates-popup"
				// Косая черта внутри адреса сайта — не команда
				validateSearch={search => !/\s/.test(search) && new RegExp(`(^|\\s)/${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(text)}
				filterOption={(input, option) => String(option.value).startsWith(input.toLowerCase())}
				options={list.map(template => ({ key: String(template.id), value: template.command, label: <TemplateOption template={template} /> }))}
				onChange={setText}
				onSelect={option => {
					const template = list.find(item => item.command === option.value);

					if (template) {
						setText(current => current.replace(`/${template.command} `, template.text).slice(0, MESSAGE_LIMIT));
					}
				}}
				onPressEnter={event => {
					if (!event.shiftKey) {
						event.preventDefault();

						if (canSend) {
							send.mutate();
						}
					}
				}}
			/>
			<div className="composer-bar">
				<Upload
					accept={FILE_ACCEPT}
					multiple
					showUploadList={false}
					beforeUpload={file => {
						upload.mutate(file);
						return false;
					}}
				>
					<Tooltip title="Прикрепить файл">
						<Button type="text" icon={<PaperClipOutlined />} loading={upload.isPending} aria-label="Прикрепить файл" />
					</Tooltip>
				</Upload>
				<TemplatesMenu templates={list} onPick={insert} onManage={onManageTemplates} />
				<span className="composer-hint muted small">/ — шаблон · Enter — отправить · Shift+Enter — новая строка</span>
				<Button type="primary" icon={<SendOutlined />} disabled={!canSend} loading={send.isPending} onClick={() => send.mutate()}>Отправить</Button>
			</div>
		</div>
	);
};

const TransferModal = ({ ticket, user, onClose }: { ticket: SupportTicketDetail; user: AdminUser; onClose: () => void; }) => {
	const [target, setTarget] = useState<number | typeof QUEUE>(QUEUE);
	const staff = useQuery({ queryKey: [SUPPORT_KEY, 'staff'], queryFn: api.supportStaff });

	const transfer = useMutation({
		mutationFn: () => target === QUEUE ? api.releaseTicket(ticket.id) : api.transferTicket(ticket.id, target),
		onSuccess: onClose,
		onSettled: refresh,
	});

	return (
		<Modal
			open
			title="Передать обращение"
			okText="Передать"
			okButtonProps={{ loading: transfer.isPending }}
			onOk={() => transfer.mutate()}
			onCancel={onClose}
		>
			<Select
				className="support-transfer"
				value={target}
				onChange={setTarget}
				showSearch={{ optionFilterProp: 'label' }}
				options={[
					{ value: QUEUE, label: 'В очередь: возьмёт первый свободный' },
					...staff.data?.filter(member => member.id !== ticket.assigneeId).map(member => ({ value: member.id, label: member.id === user.id ? `${member.fullName} (я)` : member.fullName })) ?? [],
				]}
			/>
			<p className="muted">Вся переписка будет видна тому, кто продолжит работу с обращением.</p>
			{transfer.isError && <Alert type="error" title={errorText(transfer.error)} />}
		</Modal>
	);
};

const BotDialog = ({ history, open }: { history: SupportHistoryEntry[]; open: boolean; }) => {
	const total = history.reduce((sum, entry) => sum + (entry.question ? 1 : 0) + (entry.answer ? 1 : 0), 0);

	return (
		<Collapse
			className="bot-dialog"
			size="small"
			defaultActiveKey={open ? ['bot'] : []}
			items={[{
				key: 'bot',
				label: <><RobotOutlined /> Диалог с ботом до обращения</>,
				extra: <span className="muted small">{total} {plural(total, ['сообщение', 'сообщения', 'сообщений'])} · {formatTime(history.at(-1)!.at)}</span>,
				children: (
					<div className="bot-messages">
						{history.map(entry => (
							<div key={entry.at} className="bot-step">
								{entry.question && <div className="message passenger">{entry.question}</div>}
								{entry.answer && (
									<div className="message bot">
										{entry.answer}
										<div className="message-meta"><RobotOutlined /> Бот · {formatTime(entry.at)}</div>
									</div>
								)}
							</div>
						))}
					</div>
				),
			}]}
		/>
	);
};

const CREATED_REASONS: Record<SupportReason, string> = {
	unrecognized: 'бот не понял вопрос',
	noOption: 'нет подходящего варианта',
	asked: 'пассажир попросил оператора',
};

const ThreadTag = ({ ticket, mine, now }: { ticket: SupportTicketDetail; mine: boolean; now: number; }) => {
	if (ticket.status === 'queue') {
		return <Tag color="processing">Свободно · {waitText(minutesSince(ticket.waitingSince ?? ticket.createdAt, now))}</Tag>;
	}

	if (ticket.status === 'closed') {
		return <Tag>Закрыто</Tag>;
	}

	return mine ? <Tag color="success">В работе у вас</Tag> : <Tag>Ведёт {shortName(ticket.assigneeName ?? '')}</Tag>;
};

const Thread = ({ ticket, user, onManageTemplates }: { ticket: SupportTicketDetail; user: AdminUser; onManageTemplates: () => void; }) => {
	const { message } = App.useApp();
	const now = useNow();
	const [transferring, setTransferring] = useState(false);
	const bottom = useRef<HTMLDivElement>(null);

	const onError = useCallback((error: Error) => void message.error(errorText(error)), [message]);
	const take = useMutation({ mutationFn: () => api.takeTicket(ticket.id), onError, onSettled: refresh });
	const close = useMutation({ mutationFn: () => api.closeTicket(ticket.id), onError, onSettled: refresh });

	const mine = ticket.status === 'active' && ticket.assigneeId === user.id;
	const canManage = ticket.status === 'active' && (mine || isManager(user.role));
	const lastMessage = ticket.messages.at(-1)?.id;
	const reason = reasonLabel(ticket);

	useEffect(() => {
		bottom.current?.scrollIntoView();
	}, [ticket.id, lastMessage]);

	const takeButton = <Button type="primary" loading={take.isPending} onClick={() => take.mutate()}>Взять в работу</Button>;

	return (
		<section className="support-thread" aria-label="Переписка">
			<div className="thread-head">
				<PersonAvatar initials={passengerInitials(ticket.passenger)} seed={ticket.passenger} />
				<div className="thread-title">
					<div className="thread-name">
						<h2>{ticket.passenger}</h2>
						<ThreadTag ticket={ticket} mine={mine} now={now} />
					</div>
					<div className="muted">
						Обращение №{ticket.id} · с {formatWhen(ticket.createdAt).replace('сегодня, ', '')}{reason && ` · ${reason}`}
					</div>
				</div>
				{ticket.status === 'queue' && takeButton}
				{canManage && (
					<div className="row-actions">
						<Button icon={<SwapOutlined />} onClick={() => setTransferring(true)}>Передать</Button>
						<Button icon={<CheckOutlined />} loading={close.isPending} onClick={() => close.mutate()}>Закрыть обращение</Button>
					</div>
				)}
			</div>
			<div className="thread-messages" onLoadCapture={() => bottom.current?.scrollIntoView()}>
				{ticket.history.length > 0 && <BotDialog history={ticket.history} open={ticket.status !== 'closed'} />}
				{ticket.reason && (
					<span className="system-line"><ClockCircleOutlined /> Обращение создано: {CREATED_REASONS[ticket.reason]} · {formatTime(ticket.createdAt)}</span>
				)}
				{ticket.messages.map(item => <Message key={item.id} message={item} />)}
				<div ref={bottom} />
			</div>
			{mine && <Composer key={ticket.id} ticketId={ticket.id} onManageTemplates={onManageTemplates} />}
			{ticket.status === 'queue' && (
				<div className="thread-note">
					<InfoCircleOutlined className="note-icon" />
					<span>Возьмите обращение в работу, чтобы ответить пассажиру</span>
					{takeButton}
				</div>
			)}
			{ticket.status === 'active' && !mine && (
				<div className="thread-note">
					<InfoCircleOutlined className="note-icon" />
					<span>Обращение ведёт {ticket.assigneeName}. Передайте его себе, чтобы ответить</span>
				</div>
			)}
			{transferring && <TransferModal ticket={ticket} user={user} onClose={() => setTransferring(false)} />}
		</section>
	);
};

const CardRow = ({ label, children }: { label: string; children: React.ReactNode; }) => (
	<div className="card-row">
		<span className="muted">{label}</span>
		<span>{children}</span>
	</div>
);

const PassengerCard = ({ ticket }: { ticket: SupportTicketDetail; }) => (
	<aside className="support-card" aria-label="Пассажир">
		<div className="passenger-head">
			<PersonAvatar initials={passengerInitials(ticket.card.name)} seed={ticket.card.name} size={64} />
			<h2>{ticket.card.name}</h2>
			<div className="muted">Пассажир в MAX</div>
		</div>
		{ticket.card.isBlocked && <Alert type="warning" title="Пассажир заблокировал бота: сообщения до него не дойдут" />}
		<div className="card-rows">
			{ticket.card.username && <CardRow label="Имя в MAX">@{ticket.card.username}</CardRow>}
			<CardRow label="Номер в MAX">{ticket.card.userId}</CardRow>
			{ticket.card.firstSeenAt && <CardRow label="Пишет боту с">{formatDay(ticket.card.firstSeenAt, new Date(0))}</CardRow>}
			<CardRow label="Первое обращение">{formatDay(ticket.card.firstTicketAt, new Date(0))}</CardRow>
			<CardRow label="Всего обращений">{ticket.card.ticketCount}</CardRow>
			<CardRow label="Вопросов боту">{ticket.card.botQuestions}</CardRow>
		</div>
		<Divider className="card-divider" />
		<div className="past-title"><ClockCircleOutlined /> Прошлые обращения</div>
		{ticket.past.length === 0 && <p className="muted">Не было</p>}
		{ticket.past.map(past => (
			<Link key={past.id} className="past-ticket" to={`/support/${past.id}`}>
				<span className="past-topic">
					<span>{past.topic ?? 'Без сообщений'}</span>
					<RightOutlined className="muted" />
				</span>
				<span className="muted small">
					{formatDay(past.closedAt ?? past.createdAt)} · закрыто{past.assigneeName && ` · ${shortName(past.assigneeName)}`}
				</span>
			</Link>
		))}
	</aside>
);

export const SupportPage = ({ user }: { user: AdminUser; }) => {
	const params = useParams();
	const navigate = useNavigate();
	const [templatesOpen, setTemplatesOpen] = useState(false);
	const ticketId = Number(params.ticketId);

	const ticket = useQuery({
		queryKey: [SUPPORT_KEY, 'ticket', ticketId],
		queryFn: () => api.supportTicket(ticketId),
		enabled: Number.isInteger(ticketId) && ticketId > 0,
	});

	// Обращение закрыли или передали, и оно больше не доступно этому сотруднику
	// Пока идет повторный запрос, ошибка может быть старой: сотруднику уже вернули это обращение
	const lost = ticket.isError && !ticket.isFetching;

	useEffect(() => {
		if (lost) {
			void navigate('/support', { replace: true });
		}
	}, [lost, navigate]);

	return (
		<>
			<PageHeader
				title="Чат поддержки"
				extra={<Button icon={<ThunderboltOutlined />} onClick={() => setTemplatesOpen(true)}>Мои шаблоны</Button>}
			/>
			<main className="page-body support-page">
				<Card className="support">
					<TicketList user={user} selectedId={ticketId} />
					{ticket.data
						? <Thread ticket={ticket.data} user={user} onManageTemplates={() => setTemplatesOpen(true)} />
						: <section className="support-thread support-none muted">Выберите обращение слева</section>}
					{ticket.data ? <PassengerCard ticket={ticket.data} /> : <aside className="support-card" />}
				</Card>
			</main>
			<TemplatesDrawer open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
		</>
	);
};
