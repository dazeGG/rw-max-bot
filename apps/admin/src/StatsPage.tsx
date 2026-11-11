import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Card, Segmented, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import { useState } from 'react';

import type { StatsDay, StatsHour, StatsPeriod, StatsResponse, StatsSection } from '@rw/core';

import { api } from './api';
import { PageHeader, Stat } from './page';
import { errorText } from './session';
import { ACTIVITY_SERIES, ANSWER_SERIES, fullDate, HoursChart, LinesChart, SectionsList, StackedChart, TICKET_SERIES } from './stats-charts';

type View = 'charts' | 'tables';

const PERIODS: { label: string; value: StatsPeriod; }[] = [
	{ label: '7 дней', value: 7 },
	{ label: '30 дней', value: 30 },
	{ label: '90 дней', value: 90 },
];

const VIEWS: { label: string; value: View; }[] = [
	{ label: 'Графики', value: 'charts' },
	{ label: 'Таблицы', value: 'tables' },
];

const sum = (days: StatsDay[], pick: (day: StatsDay) => number) => days.reduce((total, day) => total + pick(day), 0);

const ticketsOf = (day: StatsDay) => day.ticketsAsked + day.ticketsNoOption + day.ticketsUnrecognized;

const questionsOf = (day: StatsDay) => day.answered + day.clarified + day.unrecognized;

const numberColumn = (title: string, dataIndex: keyof StatsDay) => ({ title, dataIndex, align: 'right' as const, className: 'numeric' });

const DAY_COLUMNS: TableColumnsType<StatsDay> = [
	{ title: 'Дата', dataIndex: 'date', fixed: 'left', render: fullDate },
	...[...ACTIVITY_SERIES, ...ANSWER_SERIES, ...TICKET_SERIES].map(series => numberColumn(series.name, series.key)),
];

const SECTION_COLUMNS: TableColumnsType<StatsSection> = [
	{ title: 'Раздел', dataIndex: 'title' },
	{ title: 'Открыли', dataIndex: 'opens', align: 'right', className: 'numeric' },
];

const HOUR_COLUMNS: TableColumnsType<StatsHour> = [
	{ title: 'Час', dataIndex: 'hour', render: (hour: number) => `${String(hour).padStart(2, '0')}:00` },
	{ title: 'Сообщений', dataIndex: 'events', align: 'right', className: 'numeric' },
];

const Tiles = ({ stats }: { stats: StatsResponse | undefined; }) => {
	const days = stats?.days;
	const questions = days && sum(days, questionsOf);
	const answered = days && sum(days, day => day.answered);

	return (
		<div className="stat-grid stats-tiles">
			<Stat title="Всего пассажиров" value={stats?.subscribers} hint={stats ? `заблокировали бота: ${stats.blocked}` : ''} />
			<Stat title="Активных" value={stats?.activeUsers} hint="писали боту за период" />
			<Stat title="Новых" value={days && sum(days, day => day.newUsers)} hint="впервые написали за период" />
			<Stat title="Вопросов" value={questions} hint="заданных своими словами" />
			<Stat title="Ответил сразу" value={questions === undefined ? undefined : questions === 0 ? '—' : `${Math.round(answered! / questions * 100)}%`} hint="без уточнения" />
			<Stat title="Обращений" value={days && sum(days, ticketsOf)} hint="к оператору" />
		</div>
	);
};

const Charts = ({ stats }: { stats: StatsResponse; }) => (
	<div className="stats-grid">
		<Card title="Пассажиры по дням">
			<LinesChart days={stats.days} series={ACTIVITY_SERIES} empty="За период пассажиры не писали" />
		</Card>
		<Card title="Как бот понял вопросы">
			<StackedChart days={stats.days} series={ANSWER_SERIES} empty="За период вопросов своими словами не было" />
		</Card>
		<Card title="Популярные разделы">
			<SectionsList sections={stats.sections} />
		</Card>
		<Card title="Активность по часам" extra={<span className="muted small">время якутское</span>}>
			<HoursChart hours={stats.hours} />
		</Card>
		<Card title="Обращения к оператору" className="stats-wide">
			<StackedChart days={stats.days} series={TICKET_SERIES} empty="За период обращений не было" />
		</Card>
	</div>
);

const Tables = ({ stats }: { stats: StatsResponse; }) => (
	<div className="page-stack">
		<Card title="По дням">
			<Table rowKey="date" size="small" columns={DAY_COLUMNS} dataSource={[...stats.days].reverse()} pagination={false} scroll={{ x: 1100 }} />
		</Card>
		<div className="stats-grid">
			<Card title="Популярные разделы">
				<Table rowKey="code" size="small" columns={SECTION_COLUMNS} dataSource={stats.sections} pagination={false} />
			</Card>
			<Card title="По часам, время якутское">
				<Table rowKey="hour" size="small" columns={HOUR_COLUMNS} dataSource={stats.hours} pagination={false} />
			</Card>
		</div>
	</div>
);

export const StatsPage = () => {
	const [period, setPeriod] = useState<StatsPeriod>(30);
	const [view, setView] = useState<View>('charts');
	const stats = useQuery({
		queryKey: ['stats', period],
		queryFn: () => api.stats(period),
		// При смене периода остается прежняя картинка, а не пустой экран
		placeholderData: keepPreviousData,
	});

	return (
		<>
			<PageHeader title="Статистика" />
			<div className="page-body">
				<div className="page-stack">
					<div className="stats-filters">
						<Segmented options={PERIODS} value={period} onChange={setPeriod} />
						<Segmented options={VIEWS} value={view} onChange={setView} />
					</div>
					{stats.isError && <Alert type="error" title={errorText(stats.error)} />}
					<div className={stats.isPlaceholderData ? 'page-stack stats-stale' : 'page-stack'}>
						<Tiles stats={stats.data} />
						{stats.data && (view === 'charts' ? <Charts stats={stats.data} /> : <Tables stats={stats.data} />)}
					</div>
				</div>
			</div>
		</>
	);
};
