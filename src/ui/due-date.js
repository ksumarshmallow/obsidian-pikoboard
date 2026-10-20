'use strict';
const { dueState } = require('../domain/due-dates.js');
const { dateText } = require('./format.js');

function duePresentation(task, now = new Date()) {
  const state = dueState(task, now);
  const date = dateText(task.due, now);
  const context = { overdue: 'Просрочено', today: 'Сегодня', soon: 'Скоро' }[state] || 'Срок';
  return {
    state,
    text: state === 'today' ? 'Сегодня' : date,
    label: task.due ? `${context} · ${date}` : 'Срок',
  };
}

function applyDueAppearance(node, presentation) {
  for (const state of ['overdue', 'today', 'soon'])
    node.classList.toggle('pb-due-' + state, presentation.state === state);
  node.setAttribute('aria-label', presentation.label);
  node.setAttribute('title', presentation.label);
}

module.exports = { duePresentation, applyDueAppearance };
