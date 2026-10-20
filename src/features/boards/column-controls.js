'use strict';
const { el, button } = require('../../ui/elements.js');
const { symbolPicker } = require('../../ui/icon-picker.js');

function columnColors(parent, column, onChange) {
  const colors = ['#9ba8c4', '#a99bea', '#83aa96', '#c5a374', '#c28ea7', '#7baabd'];
  const palette = el(parent, 'div', 'pb-color-palette');
  const paint = () =>
    palette
      .querySelectorAll('[data-color]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === column.color)));
  for (const value of colors) {
    const swatch = button(
      palette,
      '',
      () => {
        column.color = value;
        custom.value = value;
        paint();
        onChange();
      },
      'pb-color-swatch',
    );
    swatch.style.setProperty('--swatch', value);
    swatch.dataset.color = value;
    swatch.setAttribute('aria-label', 'Цвет ' + value);
  }
  const custom = el(palette, 'input', 'pb-color-custom');
  custom.type = 'color';
  custom.value = column.color;
  custom.setAttribute('aria-label', 'Свой цвет');
  custom.oninput = () => {
    column.color = custom.value;
    paint();
    onChange();
  };
  paint();
  return palette;
}

module.exports = { symbolPicker, columnColors };
