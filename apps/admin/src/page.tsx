// Общее для страниц админки: шапка с заголовком и вкладками, аватар с инициалами

import { Avatar, Tabs } from 'antd';
import type { AvatarProps, TabsProps } from 'antd';
import type { ReactNode } from 'react';

type PageHeaderProps = {
	title: string;
	// Рядом с заголовком: статус или главное действие страницы
	extra?: ReactNode;
	tabs?: TabsProps['items'];
	activeTab?: string;
	onTab?: (key: string) => void;
	// Справа от вкладок
	tabsExtra?: ReactNode;
};

export const PageHeader = ({ title, extra, tabs, activeTab, onTab, tabsExtra }: PageHeaderProps) => (
	<header className={tabs ? 'page-header with-tabs' : 'page-header'}>
		<div className="page-title">
			<h1>{title}</h1>
			{extra}
		</div>
		{tabs && (
			<div className="page-tabs">
				<Tabs activeKey={activeTab} items={tabs} onChange={onTab} />
				{tabsExtra}
			</div>
		)}
	</header>
);

// Как в дизайне: синий, оранжевый, зеленый и фиолетовый. Один человек всегда одного цвета
const AVATAR_COLORS = [
	{ background: '#eef2fb', color: '#2b51a9' },
	{ background: '#fff7e6', color: '#d46b08' },
	{ background: '#f6ffed', color: '#389e0d' },
	{ background: '#f9f0ff', color: '#722ed1' },
];

const colorOf = (seed: string) => AVATAR_COLORS[[...seed].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_COLORS.length];

const firstLetters = (words: string[]) => words.map(word => word[0] ?? '').join('').toUpperCase();

// Пассажир в MAX: «Мария Кузьмина» — МК
export const passengerInitials = (name: string) => firstLetters(name.trim().split(/\s+/).slice(0, 2));

// В ФИО сотрудника сначала фамилия: «Иванова Анна» — АИ
export const staffInitials = (name: string) => firstLetters(name.trim().split(/\s+/).slice(0, 2).reverse());

// «Петров Сергей Иванович» — «Петров С.»
export const shortName = (name: string) => {
	const [surname, firstName] = name.trim().split(/\s+/);

	return firstName ? `${surname} ${firstName[0]}.` : surname;
};

type PersonAvatarProps = {
	initials: string;
	// От него зависит цвет: у двух людей с одними инициалами цвета могут быть разными
	seed: string;
	size?: AvatarProps['size'];
};

export const PersonAvatar = ({ initials, seed, size }: PersonAvatarProps) => (
	<Avatar className="person-avatar" size={size} style={colorOf(seed)}>{initials}</Avatar>
);
