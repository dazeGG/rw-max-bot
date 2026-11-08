import { toJpeg } from 'html-to-image';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import './table-sheet.css';

export type SheetTable = {
	title: string;
	description?: string;
	/** Первая строка — шапка. */
	rows: string[][];
	/** Ширина картинки, CSS-значение (`35rem`). */
	width: string;
	/** `grid-template-columns` строк таблицы. */
	grid: string;
	/** Размытие логотипа, по умолчанию `.75rem`. */
	logoBlur?: string;
};

export const TableSheet = ({ table }: { table: SheetTable; }) => {
	const [head, ...body] = table.rows;
	const row = (cells: string[], className: string, key?: number) => (
		<div key={key} className={className} style={{ gridTemplateColumns: table.grid }}>
			{cells.map((cell, index) => <div key={index} className="table__item">{cell}</div>)}
		</div>
	);
	return (
		<div className="table-sheet" style={{ width: table.width }}>
			<div className="grain-overlay" />
			<div className="table">
				<h1 className="table__title">{table.title}</h1>
				{table.description && <p className="table__description">{table.description}</p>}
				<div className="table__wrapper">
					<img className="table__logo" src="/logo.png" alt="" style={{ filter: `blur(${table.logoBlur ?? '.75rem'})` }} />
					<div className="table__body">
						{row(head, 'table__row table__head')}
						{body.map((cells, index) => row(cells, 'table__row', index))}
					</div>
				</div>
			</div>
		</div>
	);
};

/** Рисует таблицы одной картинкой друг под другом, как JPG от Chromium-скрипта. */
export const renderTablesToJpeg = async (tables: SheetTable[]): Promise<Blob> => {
	// Хост вне экрана; снимается внутренний узел, поэтому смещение хоста в картинку не попадает.
	const host = document.createElement('div');
	host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
	document.body.append(host);
	const root = createRoot(host);
	try {
		flushSync(() => root.render(
			<div style={{ display: 'flex', flexDirection: 'column', width: 'max-content' }}>
				{tables.map((table, index) => <TableSheet key={index} table={table} />)}
			</div>,
		));
		// Шрифты грузятся по факту использования: просим их явно с реальным текстом (₽, №, кириллица).
		const text = tables.flatMap(table => [table.title, table.description ?? '', ...table.rows.flat()]).join('');
		await Promise.all([
			document.fonts.load('400 16px "Open Sans"', text),
			document.fonts.load('700 16px "Open Sans"', text),
			document.fonts.load('600 32px Montserrat', text),
		]);
		await document.fonts.ready;
		const dataUrl = await toJpeg(host.firstElementChild as HTMLElement, { pixelRatio: 1, quality: 0.8, backgroundColor: '#ffffff' });
		return await (await fetch(dataUrl)).blob();
	} finally {
		root.unmount();
		host.remove();
	}
};
