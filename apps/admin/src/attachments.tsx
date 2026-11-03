// Картинка и файл раздела. Загрузка только кладет файл на сервер: в раздел он попадет при сохранении

import { FileOutlined, InboxOutlined, PictureOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Upload } from 'antd';
import type { ReactNode } from 'react';

import type { UploadKind, UploadResult } from '@rw/core';

import { api, mediaUrl } from './api';
import { errorText } from './session';

const MEGABYTE = 1024 * 1024;
// Лимиты сервера: здесь, чтобы не ждать загрузки большого файла ради отказа
const SIZE_LIMIT: Record<UploadKind, number> = { image: 10 * MEGABYTE, file: 50 * MEGABYTE };
// Больше MAX не примет, и пассажир получит сообщение без картинки
const MAX_IMAGE_SIDE = 7680;

const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.gif';
const FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.rtf,.txt,.csv,.zip,.jpg,.jpeg,.png';

const assertSize = (kind: UploadKind, file: File) => {
	if (file.size > SIZE_LIMIT[kind]) {
		throw new Error(`Файл больше ${SIZE_LIMIT[kind] / MEGABYTE} МБ`);
	}
};

const assertImage = async (file: File) => {
	const url = URL.createObjectURL(file);

	try {
		const image = new Image();
		image.src = url;
		await image.decode().catch(() => {
			throw new Error('Файл не открывается как картинка');
		});

		if (image.naturalWidth > MAX_IMAGE_SIDE || image.naturalHeight > MAX_IMAGE_SIDE) {
			throw new Error(`Картинка больше ${MAX_IMAGE_SIDE} точек по стороне: MAX ее не примет`);
		}
	} finally {
		URL.revokeObjectURL(url);
	}
};

const useUpload = (kind: UploadKind, onUploaded: (result: UploadResult) => void) => useMutation({
	mutationFn: async (file: File) => {
		assertSize(kind, file);

		if (kind === 'image') {
			await assertImage(file);
		}

		return api.upload(kind, file);
	},
	onSuccess: onUploaded,
});

type PickerProps = {
	kind: UploadKind;
	icon: ReactNode;
	hint: string;
	// Что загружено сейчас. Пока ничего нет, вместо него только приглашение загрузить
	current: ReactNode;
	onUploaded: (result: UploadResult) => void;
	onRemove: () => void;
};

const Picker = ({ kind, icon, hint, current, onUploaded, onRemove }: PickerProps) => {
	const upload = useUpload(kind, onUploaded);

	return (
		<div className="attachment-field">
			<Upload.Dragger
				accept={kind === 'image' ? IMAGE_ACCEPT : FILE_ACCEPT}
				showUploadList={false}
				disabled={upload.isPending}
				beforeUpload={file => {
					upload.mutate(file);
					return false;
				}}
			>
				{current ?? <div className="attachment-icon">{icon}</div>}
				<div>{upload.isPending ? 'Загружаем…' : current ? 'Перетащите или нажмите, чтобы заменить' : 'Перетащите или нажмите'}</div>
				<div className="muted small">{hint}</div>
			</Upload.Dragger>
			{current && <Button size="small" onClick={onRemove}>Убрать</Button>}
			{upload.isError && <Alert type="error" title={errorText(upload.error)} />}
		</div>
	);
};

type ImageFieldProps = {
	readOnly: boolean;
	value?: string | null;
	onChange?: (value: string | null) => void;
};

export const ImageField = ({ readOnly, value, onChange }: ImageFieldProps) => {
	const image = value ? <img className="attachment-image" src={mediaUrl(value)} alt="" /> : null;

	if (readOnly) {
		return (
			<div className="attachment-field">
				{image ?? <span className="muted">Картинки нет</span>}
				<span className="muted small">Менять может только суперадмин</span>
			</div>
		);
	}

	return (
		<Picker
			kind="image"
			icon={<PictureOutlined />}
			hint="JPG, PNG или GIF до 10 МБ. Приходит вместе с текстом"
			current={image}
			onUploaded={result => onChange?.(result.path)}
			onRemove={() => onChange?.(null)}
		/>
	);
};

type FileFieldProps = {
	name: string | null;
	onNameChange: (name: string | null) => void;
	value?: string | null;
	onChange?: (value: string | null) => void;
};

export const FileField = ({ name, onNameChange, value, onChange }: FileFieldProps) => (
	<Picker
		kind="file"
		icon={<InboxOutlined />}
		hint="PDF, документ, таблица или архив до 50 МБ. Приходит отдельным сообщением"
		current={value
			? (
				<a className="attachment-file" href={mediaUrl(value)} download={name ?? undefined} onClick={event => event.stopPropagation()}>
					<FileOutlined /> {name ?? value}
				</a>
			)
			: null}
		onUploaded={result => {
			onChange?.(result.path);
			onNameChange(result.name);
		}}
		onRemove={() => {
			onChange?.(null);
			onNameChange(null);
		}}
	/>
);
