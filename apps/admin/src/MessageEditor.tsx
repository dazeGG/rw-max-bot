import { UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Button, Form, Input, Modal, Space, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';

import { editorDocToMessage, messageExtensions, messageParseOptions, messageToEditorHtml } from './message-format';

const LINK_HINT = 'Адрес сайта с https://, телефон с tel: (tel:88005500620) или почта с mailto:';

const isMessageLink = (url: string) => {
	try {
		return ['http:', 'https:', 'tel:', 'mailto:'].includes(new URL(url).protocol);
	} catch {
		return false;
	}
};

const LinkModal = ({ editor, onClose }: { editor: Editor; onClose: () => void; }) => {
	const current = editor.getAttributes('link').href as string | undefined;

	const save = ({ url }: { url: string; }) => {
		editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
		onClose();
	};

	const remove = () => {
		editor.chain().focus().extendMarkRange('link').unsetLink().run();
		onClose();
	};

	return (
		<Modal
			open
			title="Ссылка в тексте"
			okText="Сохранить"
			okButtonProps={{ htmlType: 'submit', form: 'message-link' }}
			onCancel={onClose}
			destroyOnHidden
			footer={(_, { OkBtn, CancelBtn }) => (
				<>
					{current && <Button danger onClick={remove}>Убрать ссылку</Button>}
					<CancelBtn />
					<OkBtn />
				</>
			)}
		>
			<Form id="message-link" layout="vertical" initialValues={{ url: current ?? 'https://' }} onFinish={save}>
				<Form.Item
					name="url"
					label="Куда ведет"
					extra={LINK_HINT}
					rules={[{
						validator: (_, value: string) => isMessageLink(value.trim()) ? Promise.resolve() : Promise.reject(new Error('Проверьте адрес')),
					}]}
				>
					<Input autoFocus />
				</Form.Item>
			</Form>
		</Modal>
	);
};

const Toolbar = ({ editor }: { editor: Editor; }) => {
	const [linkOpen, setLinkOpen] = useState(false);

	const state = useEditorState({
		editor,
		selector: ({ editor: current }) => ({
			bold: current.isActive('bold'),
			italic: current.isActive('italic'),
			link: current.isActive('link'),
			hasSelection: !current.state.selection.empty,
			canUndo: current.can().undo(),
			canRedo: current.can().redo(),
		}),
	});

	return (
		<div className="editor-toolbar">
			<Space.Compact>
				<Tooltip title="Жирный (Ctrl+B)">
					<Button size="small" type={state.bold ? 'primary' : 'default'} aria-pressed={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>Ж</b></Button>
				</Tooltip>
				<Tooltip title="Курсив (Ctrl+I)">
					<Button size="small" type={state.italic ? 'primary' : 'default'} aria-pressed={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i>К</i></Button>
				</Tooltip>
				<Tooltip title={state.link || state.hasSelection ? 'Ссылка' : 'Сначала выделите текст'}>
					<Button size="small" type={state.link ? 'primary' : 'default'} disabled={!state.link && !state.hasSelection} onClick={() => setLinkOpen(true)}>Ссылка</Button>
				</Tooltip>
			</Space.Compact>
			<Space.Compact>
				<Button size="small" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>Отменить</Button>
				<Button size="small" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>Вернуть</Button>
			</Space.Compact>
			{linkOpen && <LinkModal editor={editor} onClose={() => setLinkOpen(false)} />}
		</div>
	);
};

type MessageEditorProps = {
	value?: string;
	onChange?: (value: string) => void;
};

// Поле формы. Пока сотрудник не изменил текст по сути, форма получает исходную строку символ в символ:
// сохранение не перепишет разметку раздела, который никто не правил
export const MessageEditor = ({ value = '', onChange }: MessageEditorProps) => {
	const original = useRef(value);
	const originalInEditor = useRef('');

	const editor = useEditor({
		extensions: [...messageExtensions, UndoRedo],
		content: messageToEditorHtml(value),
		parseOptions: messageParseOptions,
		onCreate: ({ editor: created }) => {
			originalInEditor.current = editorDocToMessage(created.getJSON());
		},
		onUpdate: ({ editor: updated }) => {
			const text = editorDocToMessage(updated.getJSON());
			onChange?.(text === originalInEditor.current ? original.current : text);
		},
	});

	return (
		<div className="message-editor">
			<Toolbar editor={editor} />
			<EditorContent editor={editor} />
		</div>
	);
};

// Только показ: та же схема, что в редакторе, поэтому HTML из БД не попадает на страницу напрямую
export const MessageView = ({ text }: { text: string; }) => {
	const editor = useEditor({
		extensions: messageExtensions,
		editable: false,
		content: messageToEditorHtml(text),
		parseOptions: messageParseOptions,
	});

	useEffect(() => {
		editor.commands.setContent(messageToEditorHtml(text), {
			parseOptions: messageParseOptions,
			emitUpdate: false,
		});
	}, [editor, text]);

	return <EditorContent className="message-view" editor={editor} />;
};
