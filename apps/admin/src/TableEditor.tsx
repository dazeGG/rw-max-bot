// Редактор таблиц раздела: ячейки, строки и столбцы, вставка из Excel и предпросмотр на том же шаблоне, что и итоговая картинка

import { CloseOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Input, Switch } from 'antd';
import type { ClipboardEvent } from 'react';

import type { ContentTable } from '@rw/core';
import { TABLES_MAX } from '@rw/core/tables';

import { addColumn, addRow, emptyTable, parseTsv, pasteGrid, removeColumn, removeRow, setCell, sheetOf } from './table-edit';
import { TableSheet } from './table-render';

type TableBlockProps = {
	table: ContentTable;
	index: number;
	removable: boolean;
	onChange: (table: ContentTable) => void;
	onRemove: () => void;
};

const TableBlock = ({ table, index, removable, onChange, onRemove }: TableBlockProps) => {
	const { rows } = table;
	const setRows = (next: string[][]) => onChange({ ...table, rows: next });

	// Блок из Excel (табы и переводы строк) раскладывается по ячейкам от выбранной; обычный текст вставляется как всегда
	const paste = (event: ClipboardEvent<HTMLTextAreaElement>, row: number, column: number) => {
		const text = event.clipboardData.getData('text/plain');

		if (/[\t\n\r]/.test(text)) {
			event.preventDefault();
			setRows(pasteGrid(rows, row, column, parseTsv(text)));
		}
	};

	return (
		<Card
			size="small"
			className="table-block"
			title={`Таблица ${index + 1}`}
			extra={removable && <Button size="small" danger icon={<DeleteOutlined />} onClick={onRemove}>Удалить таблицу</Button>}
		>
			<div className="table-meta">
				<Input.TextArea
					autoSize={{ minRows: 1 }}
					placeholder="Заголовок"
					maxLength={200}
					value={table.title}
					onChange={event => onChange({ ...table, title: event.target.value })}
				/>
				<Input
					placeholder="Подзаголовок (необязательно)"
					maxLength={200}
					value={table.description ?? ''}
					onChange={event => onChange({ ...table, description: event.target.value })}
				/>
			</div>

			<div className="table-grid-wrap">
				<table className="table-grid">
					<thead>
						<tr>
							{rows[0].map((_, column) => (
								<th key={column}>
									<Button
										size="small"
										type="text"
										icon={<CloseOutlined />}
										disabled={rows[0].length <= 1}
										aria-label={`Удалить столбец ${column + 1}`}
										title="Удалить столбец"
										onClick={() => setRows(removeColumn(rows, column))}
									/>
								</th>
							))}
							<th />
						</tr>
					</thead>
					<tbody>
						{rows.map((line, row) => (
							<tr key={row} className={row === 0 ? 'table-grid-head' : undefined}>
								{line.map((cell, column) => (
									<td key={column}>
										<Input.TextArea
											autoSize={{ minRows: 1 }}
											value={cell}
											maxLength={200}
											aria-label={`Строка ${row + 1}, столбец ${column + 1}`}
											onChange={event => setRows(setCell(rows, row, column, event.target.value))}
											onPaste={event => paste(event, row, column)}
										/>
									</td>
								))}
								<td>
									<Button
										size="small"
										type="text"
										icon={<CloseOutlined />}
										disabled={rows.length <= 2}
										aria-label={`Удалить строку ${row + 1}`}
										title="Удалить строку"
										onClick={() => setRows(removeRow(rows, row))}
									/>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="table-actions">
				<Button size="small" icon={<PlusOutlined />} onClick={() => setRows(addRow(rows))}>Строка</Button>
				<Button size="small" icon={<PlusOutlined />} onClick={() => setRows(addColumn(rows))}>Столбец</Button>
				<span className="muted small">Можно вставить блок ячеек из Excel: выберите ячейку и нажмите Ctrl+V. Первая строка — шапка.</span>
			</div>

			<label className="switch-row">
				<Switch size="small" checked={table.searchable} onChange={searchable => onChange({ ...table, searchable })} />
				<span>
					<div>Искать по содержимому</div>
					<div className="muted">Бот найдёт раздел по названиям и значениям из этой таблицы. Текст для поиска собирается сам.</div>
				</span>
			</label>
		</Card>
	);
};

type TableEditorProps = {
	problem: string | null;
	value?: ContentTable[] | null;
	onChange?: (value: ContentTable[]) => void;
};

export const TableEditor = ({ problem, value, onChange }: TableEditorProps) => {
	const tables = value ?? [];
	const change = (next: ContentTable[]) => onChange?.(next);

	return (
		<div className="table-editor">
			{tables.map((table, index) => (
				<TableBlock
					key={index}
					table={table}
					index={index}
					removable={tables.length > 1}
					onChange={next => change(tables.map((item, position) => position === index ? next : item))}
					onRemove={() => change(tables.filter((_, position) => position !== index))}
				/>
			))}

			<Button icon={<PlusOutlined />} disabled={tables.length >= TABLES_MAX} onClick={() => change([...tables, emptyTable()])}>
				Добавить таблицу
			</Button>

			{problem && <Alert className="form-alert" type="warning" title={problem} />}

			{tables.length > 0 && (
				<>
					<div className="table-preview-title">Так таблицы увидит пассажир (картинка нарисуется при сохранении)</div>
					<div className="table-preview">
						<div className="table-preview-stack">
							{tables.map((table, index) => <TableSheet key={index} table={sheetOf(table)} />)}
						</div>
					</div>
				</>
			)}
		</div>
	);
};
