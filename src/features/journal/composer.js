'use strict';
const { Menu, setIcon } = require('obsidian');
const C = require('../../domain/tasks.js');
const { el, button, icon, grow } = require('../../ui/elements.js');

class JournalComposer {
  constructor(plugin, file, parent) {
    this.plugin = plugin;
    this.file = file;
    this.model = plugin.journal(file);
    this.mode = 'note';
    this.disposed = false;
    this.form = el(parent, 'form', 'pb-journal-composer');
    const modes = el(this.form, 'div', 'pb-composer-modes');
    this.noteButton = button(modes, 'Запись', () => this.setMode('note'), 'pb-composer-mode');
    this.nextButton = button(
      modes,
      'Следующий шаг',
      () => this.setMode('next'),
      'pb-composer-mode',
    );
    this.input = el(this.form, 'textarea', 'pb-comment-input');
    this.input.rows = 1;
    const actions = el(this.form, 'div', 'pb-composer-actions');
    this.attach = icon(actions, 'paperclip', 'Прикрепить к записи', (e) => this.attachMenu(e));
    this.attach.classList.add('pb-attach');
    this.checklist = button(actions, '', () => this.addChecklist(), 'pb-compose-checklist');
    setIcon(el(this.checklist, 'span', 'pb-menu-icon'), 'list-checks');
    el(this.checklist, 'span', '', 'Чеклист');
    this.checklist.setAttribute('aria-label', 'Добавить пункт чеклиста');
    this.send = icon(actions, 'arrow-up', 'Записать', () => this.form.requestSubmit());
    this.send.classList.add('pb-send');
    this.error = el(this.form, 'div', 'pb-compose-error');
    this.error.setAttribute('role', 'status');
    this.rebase = button(
      this.form,
      'Сверить с текущим шагом',
      () => this.model.rebaseNext().catch((e) => this.model.fail(e)),
      'pb-rebase',
    );
    this.rebase.hidden = true;
    this.input.oninput = () => this.model.setText(this.mode, this.input.value);
    this.input.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (this.mode === 'next' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        const edit = C.continueChecklist(
          this.input.value,
          this.input.selectionStart,
          this.input.selectionEnd,
        );
        if (edit) {
          e.preventDefault();
          e.stopPropagation();
          this.model.setText('next', edit.value);
          this.input.setSelectionRange(edit.cursor, edit.cursor);
          return;
        }
      }
      if (!e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        this.form.requestSubmit();
      }
    };
    this.input.onblur = () => this.model.save().catch((e) => this.model.fail(e));
    this.form.onsubmit = (e) => {
      e.preventDefault();
      this.submit();
    };
    this.unsubscribe = this.model.subscribe(() => this.paint());
  }
  addChecklist() {
    if (this.mode !== 'next') return;
    try {
      const value = C.addChecklistItem(this.input.value, '');
      this.model.setText('next', value);
      this.input.focus();
      const cursor = value.replace(/\r?\n$/, '').length;
      this.input.setSelectionRange(cursor, cursor);
    } catch (e) {
      this.model.fail(e);
    }
  }
  async submit() {
    const mode = this.mode,
      seq = this.modeSeq;
    const ok = await this.model.submit(mode);
    if (
      ok &&
      mode === 'next' &&
      !this.disposed &&
      this.mode === 'next' &&
      this.modeSeq === seq &&
      this.model.nextDraft === undefined
    ) {
      this.mode = 'note';
      this.paint();
      this.input.blur();
    }
  }
  paint() {
    if (this.disposed) return;
    const isNext = this.mode === 'next',
      value = isNext ? (this.model.nextDraft ?? this.model.next) : this.model.update;
    if (this.input.value !== value) this.input.value = value;
    this.input.placeholder = isNext ? 'Что сделать дальше?' : 'Что изменилось?';
    this.input.setAttribute('aria-label', isNext ? 'Следующий шаг' : 'Комментарий');
    this.noteButton.classList.toggle('is-active', !isNext);
    this.nextButton.classList.toggle('is-active', isNext);
    this.noteButton.setAttribute('aria-pressed', String(!isNext));
    this.nextButton.setAttribute('aria-pressed', String(isNext));
    this.form.classList.toggle('has-text', !!value.trim());
    this.checklist.hidden = !isNext;
    this.send.disabled =
      this.model.busy ||
      this.model.checkPending ||
      (isNext
        ? !value.trim() ||
          this.model.nextDraft === undefined ||
          this.model.nextDraft.trim() === (this.model.nextBase || '')
        : !value.trim());
    this.send.setAttribute('aria-label', isNext ? 'Сохранить шаг' : 'Записать');
    this.send.classList.toggle('pb-save-step', isNext);
    if (this.sendMode !== this.mode) {
      this.sendMode = this.mode;
      if (isNext) this.send.textContent = 'Сохранить шаг';
      else {
        this.send.textContent = '';
        setIcon(this.send, 'arrow-up');
      }
    }
    this.attach.setAttribute(
      'aria-label',
      isNext ? 'Прикрепить к следующему шагу' : 'Прикрепить к записи',
    );
    this.error.textContent = this.model.error;
    this.error.hidden = !this.model.error;
    this.rebase.hidden = !this.model.conflict;
    grow(this.input, 32, 120);
  }
  async setMode(mode) {
    const seq = (this.modeSeq = (this.modeSeq || 0) + 1);
    if (mode === 'next') {
      try {
        await this.model.prepareNext();
      } catch (e) {
        this.model.fail(e);
        return;
      }
    }
    if (this.disposed || seq !== this.modeSeq) return;
    this.mode = mode;
    this.paint();
    this.input.focus();
  }
  appendLink(target, mode) {
    const link = this.plugin.app.fileManager.generateMarkdownLink(target, this.file.path);
    const text = mode === 'next' ? (this.model.nextDraft ?? this.model.next) : this.model.update;
    this.model.setText(mode, text.trimEnd() + (text.trim() ? '\n' : '') + link);
    if (!this.disposed) {
      this.mode = mode;
      this.paint();
      this.input.focus();
    }
  }
  attachMenu(e) {
    const mode = this.mode,
      menu = new Menu();
    menu.addItem((i) =>
      i
        .setTitle('Заметка или исследование')
        .setIcon('file-text')
        .onClick(() =>
          this.plugin.chooseNote(this.file, (target) => this.appendLink(target, mode)),
        ),
    );
    menu.addItem((i) =>
      i
        .setTitle('Файл')
        .setIcon('paperclip')
        .onClick(() =>
          this.plugin
            .uploadMaterial((target) => this.appendLink(target, mode), this.file)
            .catch((err) => this.model.fail(err)),
        ),
    );
    menu.showAtMouseEvent(e);
  }
  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.model.save().catch(console.error);
  }
}

module.exports = { JournalComposer };
