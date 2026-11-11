// Графики статистики: общие для всех оси, подсказка и легенда, чтобы экран читался как одно целое

import { Empty } from 'antd';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { BarShapeProps, TooltipContentProps } from 'recharts';

import type { StatsDay, StatsHour, StatsSection } from '@rw/core';

// Первый цвет — фирменный синий. Набор и порядок проверены на различимость при нарушениях цветового зрения
const BLUE = '#2b51a9';
const ORANGE = '#eb6834';
const AQUA = '#1baf7a';
const SURFACE = '#ffffff';
const GRID = '#f0f0f0';
const AXIS = '#d9d9d9';
const TICK = { fill: 'rgba(0, 0, 0, 0.45)', fontSize: 12, style: { fontVariantNumeric: 'tabular-nums' } };
const CHART_HEIGHT = 260;
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 };
const MAX_BAR_WIDTH = 24;
const ROUNDED_TOP: [number, number, number, number] = [4, 4, 0, 0];
// На 90 столбцах просвет шириной 2 px съел бы половину столбца
const WIDE_PERIOD = 30;

type NumericKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T] & string;

type Series<T> = {
	key: NumericKey<T>;
	name: string;
	color: string;
};

export const ACTIVITY_SERIES: Series<StatsDay>[] = [
	{ key: 'activeUsers', name: 'Активные', color: BLUE },
	{ key: 'newUsers', name: 'Новые', color: ORANGE },
];

export const ANSWER_SERIES: Series<StatsDay>[] = [
	{ key: 'answered', name: 'Ответил сразу', color: BLUE },
	{ key: 'clarified', name: 'Уточнил', color: ORANGE },
	{ key: 'unrecognized', name: 'Не понял', color: AQUA },
];

export const TICKET_SERIES: Series<StatsDay>[] = [
	{ key: 'ticketsAsked', name: 'Попросил оператора', color: BLUE },
	{ key: 'ticketsNoOption', name: 'Нет подходящего варианта', color: ORANGE },
	{ key: 'ticketsUnrecognized', name: 'Бот не понял', color: AQUA },
];

// 2026-11-09 — 09.11
export const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

export const fullDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

const Legend = <T,>({ series }: { series: Series<T>[]; }) => (
	<div className="chart-legend">
		{series.map(item => (
			<span key={item.key}>
				<i style={{ background: item.color }} />
				{item.name}
			</span>
		))}
	</div>
);

const Tip = ({ title, rows, total }: { title: string; rows: { name: string; value: number; color: string; }[]; total?: number; }) => (
	<div className="chart-tip">
		<div className="chart-tip-title">{title}</div>
		{rows.map(row => (
			<div className="chart-tip-row" key={row.name}>
				<i style={{ background: row.color }} />
				<span>{row.name}</span>
				<b>{row.value}</b>
			</div>
		))}
		{total !== undefined && (
			<div className="chart-tip-row chart-tip-total">
				<span>Всего</span>
				<b>{total}</b>
			</div>
		)}
	</div>
);

// Подсказка читает всю строку дня, а не только столбики под курсором: нулевые значения тоже видны
const dayTip = (series: Series<StatsDay>[], showTotal: boolean) => ({ active, payload }: TooltipContentProps) => {
	const day = payload?.[0]?.payload as StatsDay | undefined;

	if (!active || !day) {
		return null;
	}

	const rows = series.map(item => ({ name: item.name, value: day[item.key], color: item.color }));

	return <Tip title={fullDate(day.date)} rows={rows} total={showTotal ? rows.reduce((sum, row) => sum + row.value, 0) : undefined} />;
};

const hourTip = ({ active, payload }: TooltipContentProps) => {
	const hour = payload?.[0]?.payload as StatsHour | undefined;

	return active && hour ? <Tip title={`${hourLabel(hour.hour)}–${hourLabel((hour.hour + 1) % 24)}`} rows={[{ name: 'Сообщений', value: hour.events, color: BLUE }]} /> : null;
};

const dayAxes = (
	<>
		<CartesianGrid vertical={false} stroke={GRID} />
		<XAxis dataKey="date" tickFormatter={shortDate} tickLine={false} axisLine={{ stroke: AXIS }} tick={TICK} minTickGap={24} />
		<YAxis niceTicks="snap125" allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} width={36} />
	</>
);

const NoData = ({ children }: { children: ReactNode; }) => (
	<div className="chart-empty" style={{ height: CHART_HEIGHT }}>
		<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={children} />
	</div>
);

const hasData = <T,>(rows: T[], series: Series<T>[]) => rows.some(row => series.some(item => Number(row[item.key]) > 0));

export const LinesChart = ({ days, series, empty }: { days: StatsDay[]; series: Series<StatsDay>[]; empty: string; }) => {
	if (!hasData(days, series)) {
		return <NoData>{empty}</NoData>;
	}

	return (
		<>
			<Legend series={series} />
			<ResponsiveContainer width="100%" height={CHART_HEIGHT}>
				<LineChart data={days} margin={MARGIN}>
					{dayAxes}
					<Tooltip content={dayTip(series, false)} cursor={{ stroke: AXIS }} />
					{series.map(item => (
						<Line
							key={item.key}
							dataKey={item.key}
							name={item.name}
							type="linear"
							stroke={item.color}
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
							dot={false}
							activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2, fill: item.color }}
							isAnimationActive={false}
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</>
	);
};

export const StackedChart = ({ days, series, empty }: { days: StatsDay[]; series: Series<StatsDay>[]; empty: string; }) => {
	if (!hasData(days, series)) {
		return <NoData>{empty}</NoData>;
	}

	const gap = days.length > WIDE_PERIOD ? 1 : 2;

	// Скруглен только верхний непустой сегмент столбца
	const segment = (index: number) => (props: BarShapeProps) => {
		const day = props.payload as StatsDay;
		const isTop = series.slice(index + 1).every(item => !day[item.key]);

		return <Rectangle {...props} radius={isTop ? ROUNDED_TOP : 0} />;
	};

	return (
		<>
			<Legend series={series} />
			<ResponsiveContainer width="100%" height={CHART_HEIGHT}>
				<BarChart data={days} margin={MARGIN}>
					{dayAxes}
					<Tooltip content={dayTip(series, true)} cursor={{ fill: GRID }} />
					{series.map((item, index) => (
						<Bar
							key={item.key}
							dataKey={item.key}
							name={item.name}
							stackId="day"
							fill={item.color}
							stroke={SURFACE}
							strokeWidth={gap}
							maxBarSize={MAX_BAR_WIDTH}
							shape={segment(index)}
							isAnimationActive={false}
						/>
					))}
				</BarChart>
			</ResponsiveContainer>
		</>
	);
};

export const HoursChart = ({ hours }: { hours: StatsHour[]; }) => {
	if (!hours.some(hour => hour.events > 0)) {
		return <NoData>За период сообщений нет</NoData>;
	}

	return (
		<ResponsiveContainer width="100%" height={CHART_HEIGHT}>
			<BarChart data={hours} margin={MARGIN}>
				<CartesianGrid vertical={false} stroke={GRID} />
				<XAxis dataKey="hour" tickFormatter={hour => String(hour).padStart(2, '0')} tickLine={false} axisLine={{ stroke: AXIS }} tick={TICK} interval={2} />
				<YAxis niceTicks="snap125" allowDecimals={false} tickLine={false} axisLine={false} tick={TICK} width={36} />
				<Tooltip content={hourTip} cursor={{ fill: GRID }} />
				<Bar dataKey="events" name="Сообщений" fill={BLUE} radius={ROUNDED_TOP} maxBarSize={MAX_BAR_WIDTH} isAnimationActive={false} />
			</BarChart>
		</ResponsiveContainer>
	);
};

// Название раздела бывает длинным: обычная разметка переносит его, а подпись оси в SVG обрезала бы
export const SectionsList = ({ sections }: { sections: StatsSection[]; }) => {
	if (sections.length === 0) {
		return <NoData>За период разделы не открывали</NoData>;
	}

	const max = sections[0].opens;

	return (
		<ol className="section-bars">
			{sections.map(section => (
				<li key={section.code}>
					<span className="section-bars-title">{section.title}</span>
					<span className="section-bars-track">
						<i style={{ width: `${section.opens / max * 100}%`, background: BLUE }} />
					</span>
					<b>{section.opens}</b>
				</li>
			))}
		</ol>
	);
};
