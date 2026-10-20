'use strict';

const LABELS = {
  inbox: 'Inbox', 'circle-dashed': 'In progress', 'circle-check': 'Done',
  clock: 'Clock', star: 'Star', flag: 'Flag', bookmark: 'Bookmark',
  lightbulb: 'Idea', 'flask-conical': 'Research', rocket: 'Rocket',
  heart: 'Heart', coffee: 'Coffee', 'briefcase-business': 'Work', house: 'Home',
  'book-open': 'Book', plane: 'Travel', 'message-circle': 'Message',
  pause: 'Pause', eye: 'Review', archive: 'Archive',
};
// Search hints supplement the icon names supplied by Obsidian; no external icon data.
const KEYWORDS = {
  book: 'книга книги чтение читать учеба обучение английский',
  graduation: 'учеба обучение курс университет', brain: 'мозг знания обучение',
  school: 'школа учеба', notebook: 'блокнот заметки', library: 'библиотека книги',
  house: 'дом жилье квартира', home: 'дом жилье', building: 'здание офис',
  briefcase: 'работа портфель', laptop: 'ноутбук работа компьютер',
  monitor: 'экран компьютер', code: 'код программирование', terminal: 'терминал код',
  calendar: 'календарь дата срок', clock: 'часы время', timer: 'таймер время',
  alarm: 'будильник напоминание', hourglass: 'ожидание время песочные часы',
  check: 'галочка готово сделано', list: 'список задачи чеклист',
  inbox: 'входящие задачи', circle: 'круг', square: 'квадрат',
  star: 'звезда избранное', heart: 'сердце здоровье любовь',
  stethoscope: 'врач здоровье медицина', pill: 'таблетка здоровье лекарство',
  tooth: 'зуб стоматолог', activity: 'здоровье активность',
  plane: 'самолет путешествие поездка', train: 'поезд путешествие',
  bus: 'автобус поездка', car: 'машина автомобиль', map: 'карта путешествие',
  compass: 'компас направление', luggage: 'багаж чемодан поездка',
  wallet: 'кошелек деньги', banknote: 'деньги финансы', bank: 'банк деньги',
  credit: 'карта деньги банк', shopping: 'покупки магазин', gift: 'подарок',
  coffee: 'кофе отдых', utensils: 'еда ресторан', cake: 'торт праздник',
  message: 'сообщение комментарий общение', mail: 'письмо почта',
  phone: 'телефон звонок', users: 'люди команда', user: 'человек пользователь',
  lightbulb: 'идея лампочка', flask: 'исследование ресерч эксперимент',
  search: 'поиск исследование', microscope: 'исследование наука',
  rocket: 'ракета запуск', target: 'цель мишень', flag: 'флаг цель',
  bookmark: 'закладка', archive: 'архив', folder: 'папка проект',
  file: 'файл документ', paperclip: 'вложение скрепка материалы', link: 'ссылка связь',
  image: 'картинка изображение фото', camera: 'камера фото',
  music: 'музыка', headphones: 'наушники музыка', film: 'кино фильм',
  palette: 'цвет палитра дизайн', brush: 'кисть рисование', pencil: 'карандаш писать',
  pen: 'ручка писать', cat: 'кот кошка', dog: 'собака', paw: 'лапа питомец',
  leaf: 'лист природа', flower: 'цветок', sprout: 'рост развитие',
  sun: 'солнце день', moon: 'луна ночь', cloud: 'облако',
  smile: 'улыбка эмоция', eye: 'глаз просмотр проверка',
  pause: 'пауза ожидание', play: 'начать играть', lock: 'замок закрыто',
  settings: 'настройки', trash: 'корзина удалить', bell: 'уведомление колокол',
  arrow: 'стрелка', chevron: 'стрелка', plus: 'плюс добавить', minus: 'минус убрать',
};
const normalize = (value) => String(value).toLowerCase().replace(/ё/g, 'е').replace(/[-_]/g, ' ');
const iconId = (value) => typeof value === 'string' ? value.replace(/^lucide-/, '') : '';

function iconCatalog(registered) {
  // Other plugins may register icons too. Only offer the built-in Lucide namespace.
  return [...new Set(registered.filter((id) => /^lucide-[a-z0-9-]+$/.test(id)).map(iconId))]
    .sort()
    .map((id) => ({
      id,
      label: LABELS[id] || id.replace(/-/g, ' '),
      search: normalize([id, LABELS[id] || '', ...id.split('-').map((part) => KEYWORDS[part] || '')].join(' ')),
    }));
}
function searchIcons(catalog, query) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return words.length ? catalog.filter((item) => {
    const terms = item.search.split(/\s+/);
    return words.every((word) => terms.some((term) => term.startsWith(word)));
  }) : catalog;
}
function iconPreferences(raw = {}) {
  const clean = (list, limit) => [...new Set((Array.isArray(list) ? list : [])
    .filter((id) => typeof id === 'string' && /^(?:lucide-)?[a-z][a-z0-9-]*$/.test(id))
    .map(iconId))].slice(0, limit);
  return { favorites: clean(raw?.favorites, 200), recent: clean(raw?.recent, 24) };
}

module.exports = { iconCatalog, searchIcons, iconPreferences, iconId };
