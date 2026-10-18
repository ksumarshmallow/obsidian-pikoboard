'use strict';
const { Modal, FuzzySuggestModal, Notice } = require('obsidian');
const { el, button, icon } = require('./elements.js');
const { errorMessage } = require('./format.js');

class AskModal extends Modal {
  constructor(
    app,
    title,
    placeholder,
    callback,
    value = '',
    allowEmpty = false,
    multiline = false,
  ) {
    super(app);
    Object.assign(this, { heading: title, placeholder, callback, value, allowEmpty, multiline });
  }
  onOpen() {
    this.modalEl.addClass('pb-prompt');
    this.contentEl.addClass('pikoboard');
    const form = el(this.contentEl, 'form');
    const input = el(form, this.multiline ? 'textarea' : 'input', 'pb-input');
    input.value = this.value;
    input.placeholder = this.placeholder;
    input.setAttribute('aria-label', this.heading);
    input.required = !this.allowEmpty;
    const send = icon(form, 'arrow-right', 'Подтвердить', () => form.requestSubmit());
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (this.busy || (!input.value.trim() && !this.allowEmpty)) return;
      this.busy = true;
      send.disabled = true;
      try {
        await this.callback(input.value.trim());
        this.close();
      } catch (err) {
        new Notice(errorMessage(err));
        send.disabled = false;
        this.busy = false;
      }
    };
    setTimeout(() => input.focus(), 30);
  }
}
class DeleteConfirmModal extends Modal {
  constructor(app, title, resolve) {
    super(app);
    this.taskTitle = title;
    this.resolve = resolve;
    this.confirmed = false;
  }
  onOpen() {
    this.modalEl.addClass('pb-delete-modal');
    this.contentEl.addClass('pikoboard');
    el(this.contentEl, 'h3', '', 'Удалить задачу?');
    el(this.contentEl, 'p', 'pb-delete-name', this.taskTitle);
    el(this.contentEl, 'p', 'pb-delete-hint', 'Файл будет перемещён в корзину хранилища.');
    const actions = el(this.contentEl, 'div', 'pb-delete-actions');
    const cancel = button(actions, 'Отмена', () => this.close());
    button(
      actions,
      'Удалить',
      () => {
        this.confirmed = true;
        this.close();
      },
      'pb-danger',
    );
    cancel.focus();
  }
  onClose() {
    this.contentEl.empty();
    this.resolve(this.confirmed);
  }
}
class ConfirmMessageModal extends Modal {
  constructor(app, heading, text, label, resolve, danger = false) {
    super(app);
    Object.assign(this, { heading, text, label, resolve, danger });
    this.confirmed = false;
  }
  onOpen() {
    this.modalEl.addClass('pb-delete-modal');
    this.contentEl.addClass('pikoboard');
    el(this.contentEl, 'h3', '', this.heading);
    el(this.contentEl, 'p', 'pb-delete-name', this.text);
    const actions = el(this.contentEl, 'div', 'pb-delete-actions');
    const cancel = button(actions, 'Отмена', () => this.close());
    button(
      actions,
      this.label,
      () => {
        this.confirmed = true;
        this.close();
      },
      this.danger ? 'pb-danger' : 'pb-new',
    );
    cancel.focus();
  }
  onClose() {
    this.resolve(this.confirmed);
  }
}
class EditMessageModal extends Modal {
  constructor(app, update, save) {
    super(app);
    Object.assign(this, { update, save });
  }
  onOpen() {
    this.modalEl.addClass('pb-message-editor');
    this.contentEl.addClass('pikoboard');
    el(this.contentEl, 'h3', '', 'Изменить запись');
    const input = el(this.contentEl, 'textarea', 'pb-message-edit-input');
    input.value = this.update.text;
    input.setAttribute('aria-label', 'Текст записи');
    const actions = el(this.contentEl, 'div', 'pb-delete-actions');
    button(actions, 'Отмена', () => this.close());
    const save = button(
      actions,
      'Сохранить',
      async () => {
        if (this.busy || !input.value.trim()) return;
        this.busy = true;
        save.disabled = true;
        try {
          await this.save(input.value.trim());
          this.close();
        } catch (e) {
          new Notice(errorMessage(e));
          this.busy = false;
          save.disabled = false;
        }
      },
      'pb-new',
    );
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        save.click();
      }
    };
    input.focus();
  }
}
class PickModal extends FuzzySuggestModal {
  constructor(app, items, callback, placeholder) {
    super(app);
    this.items = items;
    this.callback = callback;
    this.setPlaceholder(placeholder);
  }
  getItems() {
    return this.items;
  }
  getItemText(i) {
    return i.label;
  }
  onChooseItem(i) {
    Promise.resolve(this.callback(i)).catch((e) => new Notice(errorMessage(e)));
  }
}

module.exports = { AskModal, DeleteConfirmModal, ConfirmMessageModal, EditMessageModal, PickModal };
