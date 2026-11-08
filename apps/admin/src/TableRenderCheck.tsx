// Временная страница этапа 1: сравнение нынешних JPG с картинкой, нарисованной в браузере.
// Удаляется на этапе 3 вместе с маршрутом /table-render-check.

import { DownloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Spin } from 'antd';
import { useEffect, useState } from 'react';

import { mediaUrl } from './api';
import { PageHeader } from './page';
import { errorText } from './session';
import { renderTablesToJpeg } from './table-render';
import type { SheetTable } from './table-render';

// Данные скопированы из tools/image-generator/assets/script: админка от tools не зависит.
const CHECKS: { file: string; table: SheetTable; }[] = [
	{
		file: 'generated/tariffs.jpg',
		table: {
			title: 'Тарифы в вагонах ЖДЯ',
			description: 'На проезд в поездах №317, №327 / №318, №328',
			width: '35rem',
			grid: '2fr 1fr 1fr',
			rows: [
				['Со ст. Нижний Бестях', 'Плацкарт', 'Купе'],
				['Томмот', '2 039 ₽', 'от 2 803 ₽'],
				['Алдан', '2 261 ₽', 'от 3 145 ₽'],
				['Нерюнгри', '2 759 ₽', 'от 3 912 ₽'],
				['Тында', '3 427 ₽', 'от 4 938 ₽'],
				['Белогорск', '4 981 ₽', 'от 7 326 ₽'],
				['Благовещенск', '5 425 ₽', 'от 8 797 ₽'],
				['Хабаровск', '6 996 ₽', 'от 10 390 ₽'],
				['Уссурийск', '8 941 ₽', 'от 13 367 ₽'],
				['Владивосток', '8 941 ₽', 'от 13 367 ₽'],
				['Чита', '6 996 ₽', '-'],
				['Улан-Удэ', '8 454 ₽', '-'],
				['Иркутск', '9 426 ₽', '-'],
			],
		},
	},
	{
		file: 'generated/traffic-317.jpg',
		table: {
			title: 'Поезд №317 | Нижний Бестях – Благовещенск',
			width: '60rem',
			grid: '2fr 1fr 1fr 1fr',
			logoBlur: '1rem',
			rows: [
				['Станция', 'Прибытие', 'Стоянка', 'Отправление'],
				['Нижний Бестях', '', '', '17:00'],
				['Кюргелях', '22:01', '00:20', '22:21'],
				['Болотный', '01:46', '00:06', '01:52'],
				['Томмот', '03:06', '00:05', '03:11'],
				['Куранах', '04:10', '00:02', '04:12'],
				['Алдан', '04:50', '00:30', '05:20'],
				['Косаревский', '05:39', '00:01', '05:40'],
				['Селигдар', '06:01', '00:01', '06:02'],
				['Большой Нимныр', '06:43', '00:01', '06:44'],
				['Таежная', '07:49', '00:01', '07:50'],
				['Хатыми', '09:03', '00:01', '09:04'],
				['Чульбасс', '09:50', '00:01', '09:51'],
				['Чульман', '10:10', '00:03', '10:13'],
				['Нерюнгри-Пассажирская', '10:55', '00:40', '11:35'],
				['Беркакит', '11:49', '00:03', '11:52'],
				['Окурдан', '', '', ''],
				['Золотинка', '12:59', '00:01', '13:00'],
				['Аям', '13:27', '00:01', '13:28'],
				['Нагорная - Якутская', '', '', ''],
				['Якутский', '', '', ''],
				['Рихард - Зорге', '', '', ''],
				['Могот', '14:46', '00:01', '14:47'],
				['Тында', '16:06', '01:10', '17:16'],
				['Сети', '17:48', '00:01', '17:49'],
				['Беленькая', '18:27', '00:01', '18:28'],
				['Заболотное', '18:59', '00:01', '19:00'],
				['Аносовская', '19:38', '00:01', '19:39'],
				['Пурикан', '20:00', '00:01', '20:01'],
				['Муртыгит', '20:25', '00:02', '20:27'],
				['Штурм', '21:04', '00:01', '21:05'],
				['Сковородино', '22:10', '00:30', '22:40'],
				['Магдагачи', '01:49', '00:15', '02:04'],
				['Тыгда', '03:06', '00:02', '03:08'],
				['Шимановская', '05:12', '00:02', '05:14'],
				['Ледяная', '05:55', '00:01', '05:56'],
				['Свободный', '06:32', '00:02', '06:34'],
				['Белогорск', '07:24', '00:30', '07:54'],
				['Благовещенск', '10:01', '', ''],
			],
		},
	},
];

type Size = { width: number; height: number; bytes?: number; };

const loadSize = (src: string) => new Promise<Size>((resolve, reject) => {
	const image = new Image();
	image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
	image.onerror = () => reject(new Error('Картинка не загрузилась'));
	image.src = src;
});

const sizeText = (size?: Size) => size ? `${size.width} × ${size.height} px${size.bytes === undefined ? '' : `, ${(size.bytes / 1024).toFixed(1)} КБ`}` : '…';

const Check = ({ file, table }: { file: string; table: SheetTable; }) => {
	const [fresh, setFresh] = useState<{ url: string; size: Size; blob: Blob; }>();
	const [current, setCurrent] = useState<Size>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		let url: string | undefined;
		let cancelled = false;
		const run = async () => {
			try {
				setCurrent(await loadSize(mediaUrl(file)));
				const blob = await renderTablesToJpeg([table]);
				url = URL.createObjectURL(blob);
				const size = { ...(await loadSize(url)), bytes: blob.size };
				if (!cancelled) {
					setFresh({ url, size, blob });
				}
			} catch (e) {
				if (!cancelled) {
					setError(errorText(e));
				}
			}
		};
		void run();
		return () => {
			cancelled = true;
			if (url) {
				URL.revokeObjectURL(url);
			}
		};
	}, [file, table]);

	return (
		<Card title={file} style={{ marginBottom: 16 }}>
			{error && <Alert type="error" title={error} style={{ marginBottom: 12 }} />}
			<div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
				<div>
					<p>Сейчас: {sizeText(current)}</p>
					<img src={mediaUrl(file)} alt="Нынешняя картинка" />
				</div>
				<div>
					<p>
						В браузере: {sizeText(fresh?.size)}{' '}
						{fresh && (
							<Button size="small" icon={<DownloadOutlined />} href={fresh.url} download={file.split('/').pop()}>Скачать</Button>
						)}
					</p>
					{fresh ? <img src={fresh.url} alt="Картинка из браузера" /> : !error && <Spin />}
				</div>
			</div>
		</Card>
	);
};

export const TableRenderCheck = () => (
	<>
		<PageHeader title="Проверка отрисовки таблиц" />
		<main className="page-body">
			{CHECKS.map(check => <Check key={check.file} {...check} />)}
		</main>
	</>
);
