'use strict';
const { setIcon } = require('obsidian');

function statusMark(node, value) {
  if (!value) return;
  if (/^[a-z][a-z0-9-]*$/.test(value)) setIcon(node, value);
  else node.textContent = value;
}
function tint(color, alpha) {
  const hex = color.replace('#', '');
  const parts = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${parts.join(',')},${alpha})`;
}

function el(parent, tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.append(e);
  return e;
}
function button(parent, text, action, cls = '') {
  const b = el(parent, 'button', 'pb-button ' + cls, text);
  b.type = 'button';
  b.onclick = action;
  return b;
}
function icon(parent, name, label, action) {
  const b = button(parent, '', action, 'pb-icon');
  setIcon(b, name);
  b.setAttribute('aria-label', label);
  return b;
}
function grow(input, min = 64, max = 280) {
  if (input._rich) return;
  input.style.height = 'auto';
  input.style.height = Math.max(min, Math.min(max, input.scrollHeight)) + 'px';
}
function configInput(parent, title, value, type = 'text') {
  const label = el(parent, 'label', 'pb-config-field');
  el(label, 'span', '', title);
  const input = el(label, 'input', 'pb-config-input');
  input.type = type;
  input.value = value ?? '';
  input.setAttribute('aria-label', title);
  return input;
}

module.exports = { statusMark, tint, el, button, icon, grow, configInput };
