'use strict';

const SOON_DAYS = 3;
const DAY = 86400000;

function calendarDay(date) {
  // Compare calendar dates, not elapsed hours across daylight-saving changes.
  const utc = new Date(0);
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return utc.getTime() / DAY;
}

function dueDate(value) {
  if (typeof value !== 'string') return null;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (!parts) return null;
  const [, year, month, day] = parts.map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null;
  if (value.length === 10) return date;
  // Existing timestamp deadlines use the same local date as their displayed label.
  const timestamp = new Date(value);
  return Number.isFinite(+timestamp) ? timestamp : null;
}

function dueState(task, now = new Date()) {
  const date = dueDate(task.due);
  if (!date || !Number.isFinite(+now)) return '';
  if (task.archived || (task.isCompleted ?? task.status === 'done')) return '';
  const days = calendarDay(date) - calendarDay(now);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= SOON_DAYS ? 'soon' : '';
}

module.exports = { dueDate, dueState, SOON_DAYS };
