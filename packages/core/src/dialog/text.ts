import { stem } from './stemmer';

// Служебные слова, которые не несут смысла для поиска раздела.
// «да», «нет», «не» сюда не входят: это ответы на уточняющие вопросы.
const STOP_WORDS = new Set([
	'а', 'в', 'во', 'вот', 'вы', 'вас', 'вам', 'ваш', 'ваша', 'ваше', 'же', 'и', 'или', 'из', 'к', 'ко', 'как', 'какой', 'какая', 'какие',
	'ли', 'мне', 'меня', 'мой', 'моя', 'мои', 'мы', 'нам', 'нас', 'на', 'над', 'о', 'об', 'обо', 'от', 'по', 'под', 'при', 'про', 'с', 'со',
	'у', 'я', 'для', 'до', 'за', 'то', 'это', 'эта', 'этот', 'эти', 'что', 'чтобы', 'бы', 'был', 'была', 'было', 'есть', 'где', 'куда',
	'когда', 'можно', 'нужно', 'надо', 'хочу', 'хотел', 'хотела', 'хотим', 'подскажите', 'подскажи', 'скажите', 'скажи', 'пожалуйста',
	'пж', 'плиз', 'спасибо', 'ну', 'еще', 'уже', 'так', 'там', 'тут', 'здесь', 'сейчас', 'свой', 'свою', 'свои',
	'интересует', 'узнать', 'вопрос', 'такое', 'такой', 'все', 'весь',
]);

// \b в JS не работает с кириллицей, поэтому граница слова — пробел или конец строки
const GREETING = /^(здравствуйте|здравствуй|здрасте|привет|приветствую|добрый (день|вечер)|доброе утро|доброго (дня|времени суток)|доброй ночи|hello|hi)(?= |$) ?/;

export const normalize = (text: string): string => text
	.toLowerCase()
	.replace(/ё/g, 'е')
	.replace(/<[^>]*>/g, ' ')
	.replace(/[^a-zа-я0-9\s-]/g, ' ')
	.replace(/-/g, ' ')
	.replace(/\s+/g, ' ')
	.trim();

export const stripGreeting = (text: string): { greeting: boolean; rest: string } => {
	const normalized = normalize(text);
	const match = GREETING.exec(normalized);

	if (!match) {
		return { greeting: false, rest: normalized };
	}

	return { greeting: true, rest: normalized.slice(match[0].length).trim() };
};

export const tokenize = (text: string): string[] => normalize(text)
	.split(' ')
	.filter(word => word.length > 0 && !STOP_WORDS.has(word));

export const stems = (text: string): string[] => [...new Set(tokenize(text).map(stem))];

export const escapeHtml = (text: string): string => text
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;');

// Ключ для точного совпадения: «Как сдать билет?» и «сдать билет» — одна и та же фраза
export const phraseKey = (text: string): string => tokenize(text).join(' ');
