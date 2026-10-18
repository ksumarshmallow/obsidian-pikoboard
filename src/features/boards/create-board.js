'use strict';
const { Modal } = require('obsidian');
const { el, button, configInput } = require('../../ui/elements.js');
const { errorMessage } = require('../../ui/format.js');

class CreateBoardModal extends Modal {
  constructor(plugin, folder) {
    super(plugin.app);
    this.plugin = plugin;
    this.folder = folder;
  }
  onOpen() {
    this.modalEl.addClass('pb-config-modal');
    this.contentEl.addClass('pikoboard');
    el(this.contentEl, 'h2', '', 'Новая доска');
    const form = el(this.contentEl, 'form', 'pb-config-form');
    const name = configInput(form, 'Название', 'Моя доска');
    const folder = configInput(form, 'Папка', this.folder === '/' ? '' : this.folder);
    folder.placeholder = 'Корень хранилища';
    const error = el(form, 'div', 'pb-error');
    error.setAttribute('role', 'alert');
    const actions = el(form, 'div', 'pb-config-actions');
    button(actions, 'Отмена', () => this.close());
    const save = button(actions, 'Создать доску', () => form.requestSubmit(), 'pb-new');
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      try {
        const result = await this.plugin.boards.create({
          title: name.value.trim(),
          folder: folder.value.trim(),
          id: crypto.randomUUID(),
        });
        this.close();
        await this.plugin.openBoard(result.file);
      } catch (e) {
        error.textContent = errorMessage(e);
        save.disabled = false;
      }
    };
    name.focus();
    name.select();
  }
}

module.exports = { CreateBoardModal };
