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
    const send = icon(form, 'arrow-right', 'Confirm', () => form.requestSubmit());
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
    el(this.contentEl, 'h3', '', 'Delete task?');
    el(this.contentEl, 'p', 'pb-delete-name', this.taskTitle);
    el(this.contentEl, 'p', 'pb-delete-hint', 'The file will be deleted using your Obsidian deletion preference.');
    const actions = el(this.contentEl, 'div', 'pb-delete-actions');
    const cancel = button(actions, 'Cancel', () => this.close());
    button(
      actions,
      'Delete',
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
    const cancel = button(actions, 'Cancel', () => this.close());
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

module.exports = { AskModal, DeleteConfirmModal, ConfirmMessageModal, PickModal };
