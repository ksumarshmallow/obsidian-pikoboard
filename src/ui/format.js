'use strict';
const C = require('../domain/tasks.js');

function fileTitle(v) {
  return C.linkTarget(v).split('/').pop();
}
function dateText(v) {
  if (!v) return 'Срок';
  const d = new Date(v.length === 10 ? v + 'T12:00:00' : v);
  return Number.isNaN(+d)
    ? v
    : d.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
        ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
      });
}
function errorMessage(e) {
  if (e.message === 'UPDATE_CONFLICT') return 'Запись уже изменена. Откройте её меню заново.';
  if (e.message === 'NEXT_CONFLICT')
    return 'Следующий шаг уже изменён. Черновик сохранён — сверьте его с текущим шагом.';
  if (e.message === 'HISTORY_FORMAT' || e.message === 'NEXT_FORMAT')
    return 'Не удалось сохранить: служебные блоки заметки повреждены. Текст остался в черновике.';
  if (e.message?.startsWith('INVALID_TAG:'))
    return 'В теге можно использовать буквы, цифры, дефис, подчёркивание и /.';
  if (e.message === 'BODY_CONFLICT')
    return 'Текст изменён в другом окне. Ваша версия сохранена как черновик.';
  return e.message || String(e);
}

module.exports = { fileTitle, dateText, errorMessage };
