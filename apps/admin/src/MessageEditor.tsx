import { UndoRedo } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import { Button, Form, Input, Modal, Space, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

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

type FormatButton = {
	key: string;
	label: ReactNode;
	hint: string;
	toggle: (editor: Editor) => void;
};

const MARK_BUTTONS: FormatButton[] = [
	{ key: 'bold', label: <b>Ж</b>, hint: 'Жирный (Ctrl+B)', toggle: editor => editor.chain().focus().toggleBold().run() },
	{ key: 'italic', label: <i>К</i>, hint: 'Курсив (Ctrl+I)', toggle: editor => editor.chain().focus().toggleItalic().run() },
	{ key: 'underline', label: <u>Ч</u>, hint: 'Подчеркнутый (Ctrl+U)', toggle: editor => editor.chain().focus().toggleUnderline().run() },
	{ key: 'strike', label: <s>З</s>, hint: 'Зачеркнутый (Ctrl+Shift+S)', toggle: editor => editor.chain().focus().toggleStrike().run() },
	{ key: 'highlight', label: <mark>М</mark>, hint: 'Выделение маркером (Ctrl+Shift+H)', toggle: editor => editor.chain().focus().toggleHighlight().run() },
	{ key: 'code', label: <code>Код</code>, hint: 'Моноширинный: номера и коды, которые удобно скопировать (Ctrl+E). Другая разметка с ним не сочетается', toggle: editor => editor.chain().focus().toggleCode().run() },
];

const Toolbar = ({ editor }: { editor: Editor; }) => {
	const [linkOpen, setLinkOpen] = useState(false);

	const state = useEditorState({
		editor,
		selector: ({ editor: current }) => ({
			active: Object.fromEntries(MARK_BUTTONS.map(({ key }) => [key, current.isActive(key)])),
			link: current.isActive('link'),
			heading: current.isActive('heading'),
			quote: current.isActive('blockquote'),
			canHeading: current.can().toggleHeading({ level: 1 }),
			canQuote: current.can().toggleBlockquote(),
			hasSelection: !current.state.selection.empty,
			canUndo: current.can().undo(),
			canRedo: current.can().redo(),
		}),
	});

	return (
		<div className="editor-toolbar">
			<Space.Compact>
				{MARK_BUTTONS.map(({ key, label, hint, toggle }) => (
					<Tooltip key={key} title={hint}>
						<Button size="small" type={state.active[key] ? 'primary' : 'default'} aria-pressed={state.active[key]} aria-label={hint} onClick={() => toggle(editor)}>{label}</Button>
					</Tooltip>
				))}
				<Tooltip title={state.link || state.hasSelection ? 'Ссылка' : 'Сначала выделите текст'}>
					<Button size="small" type={state.link ? 'primary' : 'default'} disabled={!state.link && !state.hasSelection} onClick={() => setLinkOpen(true)}>Ссылка</Button>
				</Tooltip>
			</Space.Compact>
			<Space.Compact>
				<Button size="small" type={state.heading ? 'primary' : 'default'} aria-pressed={state.heading} disabled={!state.canHeading} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>Заголовок</Button>
				<Button size="small" type={state.quote ? 'primary' : 'default'} aria-pressed={state.quote} disabled={!state.canQuote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Цитата</Button>
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
