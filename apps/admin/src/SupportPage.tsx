// Чат поддержки: слева обращения, по центру переписка, справа карточка пассажира.
// Новые события приходят через SSE, а данные читаются обычными запросами с проверкой входа и роли

import { useMutation, useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Input, Modal, Select, Tabs, Tag, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import type { AdminUser, SupportAttachment, SupportEvent, SupportMessage, SupportTab, SupportTicketDetail, SupportTicketSummary } from '@rw/core';

import { api, supportFileUrl } from './api';
import { formatDate } from './labels';
import { errorText, isManager, queryClient } from './session';

const SUPPORT_KEY = 'support';
const TITLE = 'ЖДЯ-бот';
const MESSAGE_LIMIT = 3900;
const RECONNECT_MS = 5000;
const SILENCE_MS = 70_000;
const MEGABYTE = 1024 * 1024;
const SIZE_LIMIT = { image: 10 * MEGABYTE, file: 50 * MEGABYTE };
const IMAGE_EXTENSION = /\.(jpe?g|png|gif)$/i;
const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.rtf,.txt,.csv,.zip,.jpg,.jpeg,.png,.gif';

const STATUS_LABELS: Record<SupportTicketSummary['status'], string> = {
	queue: 'В очереди',
	active: 'В работе',
	closed: 'Закрыто',
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

const TicketItem = ({ ticket, selected }: { ticket: SupportTicketSummary; selected: boolean; }) => (
	<Link className={selected ? 'support-item selected' : 'support-item'} to={`/support/${ticket.id}`}>
		<div className="support-item-head">
			<span className="support-item-name">{ticket.passenger}</span>
			{ticket.waiting && ticket.status === 'active' && <Tag color="gold">ждет ответа</Tag>}
		</div>
		<div className="support-item-preview">{ticket.preview ?? 'Пассажир еще ничего не написал'}</div>
		<div className="support-message-meta">
			{formatDate(ticket.status === 'closed' && ticket.closedAt ? ticket.closedAt : ticket.lastMessageAt)}
			{ticket.assigneeName && ` · ${ticket.assigneeName}`}
		</div>
	</Link>
);

const TicketList = ({ user, selectedId }: { user: AdminUser; selectedId: number; }) => {
	const { message } = App.useApp();
	const [tab, setTab] = useState<SupportTab>('queue');
	const tickets = useQuery({ queryKey: [SUPPORT_KEY, 'list', tab], queryFn: () => api.supportTickets(tab) });
	const counts = useQuery({ queryKey: [SUPPORT_KEY, 'counts'], queryFn: api.supportCounts });

	const releaseAll = useMutation({
		mutationFn: api.releaseMyTickets,
		onSuccess: ({ released }) => void message.success(`В очередь передано: ${released}`),
		onError: error => void message.error(errorText(error)),
		onSettled: refresh,
	});

	return (
		<aside className="support-list">
			<Tabs
				className="support-tabs"
				activeKey={tab}
				onChange={key => setTab(key as SupportTab)}
				items={[
					{ key: 'queue', label: `Очередь${counts.data?.queue ? ` (${counts.data.queue})` : ''}` },
					{ key: 'mine', label: `Мои${counts.data?.mine ? ` (${counts.data.mine})` : ''}` },
					{ key: 'closed', label: 'Закрытые' },
					...isManager(user.role) ? [{ key: 'all', label: 'Все' }] : [],
				]}
			/>
			<div className="support-items">
				{tickets.isError && <Alert type="error" title={errorText(tickets.error)} />}
				{tickets.data?.length === 0 && <p className="center muted">Здесь пусто</p>}
				{tickets.data?.map(ticket => <TicketItem key={ticket.id} ticket={ticket} selected={ticket.id === selectedId} />)}
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
		</aside>
	);
};

const Attachment = ({ attachment }: { attachment: SupportAttachment; }) => {
	if (attachment.kind === 'unavailable') {
		return <div className="muted">{attachment.name}</div>;
	}

	const url = supportFileUrl(attachment.path);

	return attachment.kind === 'image'
		? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.name} /></a>
		: <div><a href={url} download={attachment.name}>{attachment.name}</a></div>;
};

const DELIVERY_LABELS = { pending: 'Отправляется…', sent: 'Доставлено', failed: 'Не доставлено: пассажир не получил это сообщение' };

const Message = ({ message }: { message: SupportMessage; }) => {
	if (message.sender === 'system') {
		return <div className="support-system">{message.text} · {formatDate(message.createdAt)}</div>;
	}

	return (
		<div className={`support-message ${message.sender}${message.delivery === 'failed' ? ' failed' : ''}`}>
			{message.attachments.map(attachment => <Attachment key={`${attachment.path}${attachment.name}`} attachment={attachment} />)}
			{message.text}
			<div className="support-message-meta">
				{message.authorName && `${message.authorName} · `}{formatDate(message.createdAt)}
			</div>
			{message.delivery && (
				<div className={message.delivery === 'failed' ? 'support-message-meta error' : 'support-message-meta'}>{DELIVERY_LABELS[message.delivery]}</div>
			)}
		</div>
	);
};

const kindOf = (file: File) => IMAGE_EXTENSION.test(file.name) ? 'image' as const : 'file' as const;

const Composer = ({ ticketId }: { ticketId: number; }) => {
	const { message } = App.useApp();
	const [text, setText] = useState('');
	const [attachments, setAttachments] = useState<SupportAttachment[]>([]);

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

	return (
		<div className="support-composer">
			{send.isError && <Alert className="form-alert" type="error" title={errorText(send.error)} />}
			{attachments.length > 0 && (
				<div className="support-composer-files">
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
			<div className="support-composer-row">
				<Upload
					accept={FILE_ACCEPT}
					multiple
					showUploadList={false}
					beforeUpload={file => {
						upload.mutate(file);
						return false;
					}}
				>
					<Button loading={upload.isPending}>Файл</Button>
				</Upload>
				<Input.TextArea
					value={text}
					maxLength={MESSAGE_LIMIT}
					autoSize={{ minRows: 1, maxRows: 6 }}
					placeholder="Ответ пассажиру. Enter — отправить, Shift+Enter — новая строка"
					onChange={event => setText(event.target.value)}
					onPressEnter={event => {
						if (!event.shiftKey) {
							event.preventDefault();

							if (canSend) {
								send.mutate();
							}
						}
					}}
				/>
				<Button type="primary" disabled={!canSend} loading={send.isPending} onClick={() => send.mutate()}>Отправить</Button>
			</div>
		</div>
	);
};

const TransferModal = ({ ticket, user, onClose }: { ticket: SupportTicketDetail; user: AdminUser; onClose: () => void; }) => {
	const [adminId, setAdminId] = useState<number>();
	const staff = useQuery({ queryKey: [SUPPORT_KEY, 'staff'], queryFn: api.supportStaff });

	const transfer = useMutation({
		mutationFn: () => api.transferTicket(ticket.id, adminId!),
		onSuccess: onClose,
		onSettled: refresh,
	});

	return (
		<Modal
			open
			title="Передать коллеге"
			okText="Передать"
			okButtonProps={{ disabled: !adminId, loading: transfer.isPending }}
			onOk={() => transfer.mutate()}
			onCancel={onClose}
		>
			<Select
				className="support-transfer"
				value={adminId}
				onChange={setAdminId}
				placeholder="Выберите сотрудника"
				showSearch={{ optionFilterProp: 'label' }}
				options={staff.data?.filter(member => member.id !== ticket.assigneeId).map(member => ({ value: member.id, label: member.id === user.id ? `${member.fullName} (я)` : member.fullName }))}
			/>
			<p className="muted">Обращение останется в работе, вся переписка будет видна коллеге.</p>
			{transfer.isError && <Alert type="error" title={errorText(transfer.error)} />}
		</Modal>
	);
};

const Thread = ({ ticket, user }: { ticket: SupportTicketDetail; user: AdminUser; }) => {
	const { message } = App.useApp();
	const [transferring, setTransferring] = useState(false);
	const bottom = useRef<HTMLDivElement>(null);

	const onError = useCallback((error: Error) => void message.error(errorText(error)), [message]);
	const take = useMutation({ mutationFn: () => api.takeTicket(ticket.id), onError, onSettled: refresh });
	const release = useMutation({ mutationFn: () => api.releaseTicket(ticket.id), onError, onSettled: refresh });
	const close = useMutation({ mutationFn: () => api.closeTicket(ticket.id), onError, onSettled: refresh });

	const mine = ticket.status === 'active' && ticket.assigneeId === user.id;
	const canManage = ticket.status === 'active' && (mine || isManager(user.role));
	const lastMessage = ticket.messages.at(-1)?.id;

	useEffect(() => {
		bottom.current?.scrollIntoView();
	}, [ticket.id, lastMessage]);

	return (
		<section className="support-thread">
			<div className="support-thread-head">
				<span className="support-thread-title">
					{ticket.passenger} <Tag>{STATUS_LABELS[ticket.status]}</Tag>
					{ticket.status === 'active' && !mine && <span className="muted">ведет {ticket.assigneeName}</span>}
				</span>
				{ticket.status === 'queue' && <Button type="primary" loading={take.isPending} onClick={() => take.mutate()}>Взять</Button>}
				{canManage && (
					<>
						<Button onClick={() => setTransferring(true)}>Передать коллеге</Button>
						<Button loading={release.isPending} onClick={() => release.mutate()}>В очередь</Button>
						<Button loading={close.isPending} onClick={() => close.mutate()}>Закрыть</Button>
					</>
				)}
			</div>
			<div className="support-messages" onLoadCapture={() => bottom.current?.scrollIntoView()}>
				{ticket.history.length > 0 && (
					<details className="support-history" open={ticket.status !== 'closed'}>
						<summary className="muted">Что было с ботом до обращения</summary>
						{ticket.history.map(entry => (
							<div key={entry.at}>
								{entry.question && <div className="support-history-question">Пассажир: {entry.question}</div>}
								{entry.answer && <div className="support-history-answer">Бот: {entry.answer}</div>}
							</div>
						))}
					</details>
				)}
				{ticket.messages.map(item => <Message key={item.id} message={item} />)}
				<div ref={bottom} />
			</div>
			{mine && <Composer key={ticket.id} ticketId={ticket.id} />}
			{transferring && <TransferModal ticket={ticket} user={user} onClose={() => setTransferring(false)} />}
		</section>
	);
};

const PassengerCard = ({ ticket }: { ticket: SupportTicketDetail; }) => (
	<aside className="support-card">
		<h3>{ticket.card.name}</h3>
		{ticket.card.isBlocked && <Alert type="warning" title="Пассажир заблокировал бота: сообщения до него не дойдут" />}
		<dl>
			{ticket.card.username && (
				<>
					<dt>Имя в MAX</dt>
					<dd>@{ticket.card.username}</dd>
				</>
			)}
			<dt>Номер в MAX</dt>
			<dd>{ticket.card.userId}</dd>
			{ticket.card.firstSeenAt && (
				<>
					<dt>Пишет боту с</dt>
					<dd>{formatDate(ticket.card.firstSeenAt)}</dd>
				</>
			)}
		</dl>
		<h3>Прошлые обращения</h3>
		{ticket.past.length === 0 && <p className="muted">Не было</p>}
		{ticket.past.map(past => (
			<Link key={past.id} className="support-past" to={`/support/${past.id}`}>
				{formatDate(past.closedAt ?? past.createdAt)}
				<div className="muted">{past.preview ?? 'Без сообщений'}</div>
			</Link>
		))}
	</aside>
);

export const SupportPage = ({ user }: { user: AdminUser; }) => {
	const params = useParams();
	const navigate = useNavigate();
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
		<div className="support">
			<TicketList user={user} selectedId={ticketId} />
			{ticket.data
				? <Thread ticket={ticket.data} user={user} />
				: <section className="support-thread center muted">Выберите обращение слева</section>}
			{ticket.data ? <PassengerCard ticket={ticket.data} /> : <aside className="support-card" />}
		</div>
	);
};
