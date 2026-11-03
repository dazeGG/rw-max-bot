// Весь вид админки задается здесь: основной цвет — синий с логотипа, остальное — компоненты Ant Design

import type { ThemeConfig } from 'antd';

const PRIMARY = '#2b51a9';
const PRIMARY_HOVER = '#4a6fc2';
const PRIMARY_SOFT = '#eef2fb';

export const theme: ThemeConfig = {
	token: {
		colorPrimary: PRIMARY,
		colorPrimaryHover: PRIMARY_HOVER,
		colorPrimaryBg: PRIMARY_SOFT,
		colorPrimaryBgHover: '#dfe7f7',
		colorPrimaryBorder: '#a9bbe3',
		colorLink: PRIMARY,
		colorLinkHover: PRIMARY_HOVER,
		colorBgLayout: '#f5f5f5',
		controlItemBgActive: PRIMARY_SOFT,
		borderRadius: 6,
	},
	components: {
		Layout: { siderBg: '#fff', headerBg: '#fff', triggerBg: '#fff', triggerColor: 'rgba(0, 0, 0, 0.65)' },
		Menu: { itemSelectedBg: PRIMARY_SOFT, itemSelectedColor: PRIMARY, itemBorderRadius: 8, activeBarBorderWidth: 0 },
		Tree: { nodeSelectedBg: PRIMARY_SOFT },
	},
};
