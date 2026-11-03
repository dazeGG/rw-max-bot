// Картинка и файл раздела. Загрузка только кладет файл на сервер: в раздел он попадает при сохранении формы

import { useMutation } from '@tanstack/react-query';
import { Alert, Button, Upload } from 'antd';

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
	empty: boolean;
	onUploaded: (result: UploadResult) => void;
	onRemove: () => void;
};

const Picker = ({ kind, empty, onUploaded, onRemove }: PickerProps) => {
	const upload = useUpload(kind, onUploaded);

	return (
		<>
			<div className="row-actions">
				<Upload
					accept={kind === 'image' ? IMAGE_ACCEPT : FILE_ACCEPT}
					showUploadList={false}
					beforeUpload={file => {
						upload.mutate(file);
						return false;
					}}
				>
					<Button loading={upload.isPending}>{empty ? 'Загрузить' : 'Заменить'}</Button>
				</Upload>
				{!empty && <Button onClick={onRemove}>Убрать</Button>}
			</div>
			{upload.isError && <Alert className="form-alert" type="error" title={errorText(upload.error)} />}
		</>
	);
};

type ImageFieldProps = {
	readOnly: boolean;
	value?: string | null;
	onChange?: (value: string | null) => void;
};

export const ImageField = ({ readOnly, value, onChange }: ImageFieldProps) => (
	<div className="attachment-field">
		{value && <img className="attachment-image" src={mediaUrl(value)} alt="" />}
		{!value && readOnly && <span className="muted">Картинки нет</span>}
		{!readOnly && (
			<Picker
				kind="image"
				empty={!value}
				onUploaded={result => onChange?.(result.path)}
				onRemove={() => onChange?.(null)}
			/>
		)}
	</div>
);

type FileFieldProps = {
	name: string | null;
	onNameChange: (name: string | null) => void;
	value?: string | null;
	onChange?: (value: string | null) => void;
};

export const FileField = ({ name, onNameChange, value, onChange }: FileFieldProps) => (
	<div className="attachment-field">
		{value && <a href={mediaUrl(value)} download={name ?? undefined}>{name ?? value}</a>}
		<Picker
			kind="file"
			empty={!value}
			onUploaded={result => {
				onChange?.(result.path);
				onNameChange(result.name);
			}}
			onRemove={() => {
				onChange?.(null);
				onNameChange(null);
			}}
		/>
	</div>
);
