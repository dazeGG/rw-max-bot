// Evaluation-only fixtures. No runtime routing imports this module.
// Free text from the production Telegram bot (metric_messages, 2025-08-18 … 2026-10-29), without user ids.
// That bot is button-only, so every message is a standalone first question: nobody saw an answer to follow up on.
// Commands, admin codes, dates without context and forwarded news are dropped; a few spam/noise samples check rejection.
// Labels are what the passenger needed. `// ?` marks labels awaiting review.
import { direct } from './fixtures';
import type { Example, Step } from './fixtures';

export const REAL_TG_VERSION = '2026-10-30-draft';
const tg = (step: Step): Example => ({ name: `tg: ${step.text}`, domain: 'railway', steps: [step] });

export const realTgExamples: Example[] = [
	// Purchase
	direct('Где купить билет', 'buy'),
	direct('Как купить билет', 'buy'),
	direct('как купить', 'buy'),
	direct('Купить', 'buy'),
	direct('Buy', 'buy'),
	direct('Онлайн', 'buy-online'),
	direct('Как купить билет на поезд в владивосток', 'buy', 'buy-online'),
	direct('Онлайн с Алдана до Нижнего Бестяха с трансфером до Якутска', 'buy-online', 'transfer-how'), // ?
	direct('График работы касс', 'buy-offline'),
	direct('Расписание кассы', 'buy-offline'),
	direct('Кассы в Якутске', 'buy-yakutsk'),
	direct('Нужен телефон ЖД кассы в г.томмот', 'buy-tommot'),
	direct('глубина продаж билетов', 'faq-sale-start'),
	direct('глубина продаж билетов на декабрь', 'faq-sale-start'),
	// Fares
	direct('Цена билета?', 'tariffs'),
	direct('Тарифы на детский билет', 'faq-child'),
	direct('Нижний Бестях - Иркутск цена билета?', 'tariffs', 'tariffs-yakutia'), // ?
	direct('Билет до владивостока', 'tariffs', 'tariffs-yakutia', 'buy', 'schedule-direct-vladivostok'), // ?
	direct('Стоимость постельного белья на плацкарт', 'faq-price-includes', 'tariffs-yakutia'), // ?
	direct('Стоимость постельного бельч', 'faq-price-includes', 'tariffs-yakutia'), // ?
	direct('Общая стоимость билета на плацкарт (туда и обратно) плюс постельное белье (туда и обратно)?  Ниже добавь расценки по каждой категории.', 'tariffs-yakutia', 'faq-price-includes'), // ?
	direct('Какие есть билеты нижний бестях - Хабаровск?', 'tariffs', 'tariffs-yakutia'), // ?
	// Schedule
	direct('Расписание', 'schedule'),
	direct('Расписание поездов', 'schedule', 'schedule-trains'),
	direct('Расписание на Иркутск', 'schedule-direct-irkutsk'),
	direct('Расписание Алдан Белогорск', 'schedule-train-317318', 'schedule-direct-blagoveshensk'), // ?
	direct('Благовещенск нижний бестях', 'schedule-train-317318', 'schedule-traffic-318', 'schedule-direct-blagoveshensk'),
	direct('Алдан Нижний бестях', 'schedule', 'schedule-trains'), // ?
	direct('Время прибытия поезда 328', 'schedule-traffic-328', 'schedule-train-327328'),
	direct('поезд 317Ь/318Ь Благовещенск — Нижний Бестях во сколько прибывает?', 'schedule-traffic-318', 'schedule-train-317318'),
	direct('Во сколько сегодня 18 августа 2026 года отправление поезда с Алдана в Благовещенск', 'schedule-traffic-317', 'schedule-train-317318'),
	direct('Во сколько пришел сегодня поезд из Нерюнгри', 'schedule-traffic', 'schedule-trains'), // ?
	direct('Время в пути', 'schedule'), // ?
	direct('Время отправки', 'schedule'), // ?
	direct('Когда появится маршрут Нижний Бистяха-Владивосток', 'schedule-direct-vladivostok'), // ?
	// Delays and complaints: no real-time data in the content, contacts are the useful answer
	direct('Как узнать, на сколько опаздывает поезд', 'support'), // ?
	direct('Можно ди уточнить с каким опозданием будет поезд Н. Бестях- Благовещенск 18 аагуста', 'support'), // ?
	direct('Поезд опаздывает на 4 часа', 'support'), // ?
	direct('почему не едет поезд 317?', 'support'), // ?
	direct('Почему на сайте не находит мои приобретенные билеты?  Номер заказа №266652857. Могу ли я быть уверена, что мой заказ действительно существует? Дата отправления 26 октября 2025', 'support', 'question'), // ?
	direct('Здравствуйте, как написать отзыв?', 'question', 'support'), // ?
	direct('Куда можно направить благодарность при поездке в поезде?', 'question', 'support'), // ?
	direct('Куда направить благодарность после поездки?', 'question', 'support'), // ?
	// Refund and exchange
	direct('Обмен билетов', 'refund', 'faq-refund'), // ?
	direct('Как поменять онлайн билет на другую дату', 'refund', 'faq-refund', 'rules-5'), // ?
	// Transfer
	direct('Трансфер', 'transfer'),
	direct('Трагсфер', 'transfer'),
	direct('Якутск до жд вокзала как добираться', 'transfer'),
	direct('Трансфер с якутска откуда?', 'transfer-addresses'),
	direct('Я купила трансфер с н-бестях до Якутска, на том берегу будет встречать тоже автобус иди самим добираться?', 'transfer', 'transfer-how'), // ?
	direct('Расписание теплохода Московский', 'transfer-schedule'), // ?
	// Onboard and rules
	direct('В поезде Нижний Бестях - Владивосток как питаться 2 дня 17 часов?', 'onboard-dining'),
	direct('Сколько стоит меню по рационам', 'onboard-dining'),
	direct('Можно провезти кота в плацкартном вагоне от станции Благовещенск до станции Нижний Бестях?', 'faq-pets'),
	direct('Добрый день. Для многодетных семей есть льготы?', 'privileges'),
	direct('Перевозка организованный групп детей', 'rules-1', 'unrecognized'), // ?
	direct('Есть ли вай фай?', 'faq-free', 'unrecognized'), // ?
	direct('Как в поезде работает туалет', 'unrecognized'), // ?
	// Outside the content
	direct('Вакансии', 'unrecognized'),
	direct('Отдел кадров', 'unrecognized'),
	direct('Где узнать про вакансии? Здравствуйте', 'unrecognized'),
	direct('Номер отдела кадров как узнать?', 'unrecognized'),
	direct('Сколько пассажирских вагонов принадлежит ЖДЯ?', 'unrecognized'),
	direct('Ходит ли трамвай', 'unrecognized'),
	// Noise and spam
	direct('你好', 'unrecognized'),
	direct('Аап', 'unrecognized'),
	direct('afwaw', 'unrecognized'),
	direct('<>{}[]|\\`~!@#$%^&*()', 'unrecognized'),
	direct('老师免费上榜，更有全网最赚钱推荐模式（消费就返👇）', 'unrecognized'),
].map(tg);
