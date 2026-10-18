'use strict';
const { Notice } = require('obsidian');
const { el } = require('../../ui/elements.js');
const { errorMessage } = require('../../ui/format.js');

// One journal draft per task, shared by the board and the open task window.
class JournalModel {
  constructor(plugin, file) {
    this.plugin = plugin;
    this.file = file;
    const d = plugin.draft(file.path);
    this.update = d.update || '';
    this.nextDraft = d.nextDraft;
    this.nextBase = d.nextBase;
    this.next = '';
    this.retry = d.updateId ? { id: d.updateId, text: d.updateSentText } : null;
    this.listeners = new Set();
    this.error = '';
    this.busy = false;
  }
  notify() {
    for (const fn of this.listeners) fn();
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn();
    return () => this.listeners.delete(fn);
  }
  save() {
    if (this.deleted) return Promise.resolve();
    return this.plugin.setDraft(this.file.path, {
      update: this.update || undefined,
      updateId: this.retry?.id,
      updateSentText: this.retry?.text,
      nextDraft: this.nextDraft,
      nextBase: this.nextDraft === undefined ? undefined : this.nextBase,
    });
  }
  setText(mode, text) {
    if (mode === 'next') {
      this.nextDraft = text;
      this.nextRevision = (this.nextRevision || 0) + 1;
    } else this.update = text;
    this.error = '';
    this.conflict = false;
    this.notify();
    this.save().catch((e) => this.fail(e));
  }
  fail(e) {
    this.error = errorMessage(e);
    this.conflict = e.message === 'NEXT_CONFLICT';
    this.notify();
    new Notice(this.error);
  }
  syncNext(value = '') {
    this.next = value;
    if (this.nextDraft === undefined || this.nextDraft === this.nextBase) {
      this.nextBase = value;
      if (this.nextDraft !== undefined) this.nextDraft = value;
    }
    this.notify();
  }
  async prepareNext() {
    const revision = this.nextRevision || 0,
      note = await this.plugin.note(this.file);
    this.syncNext(note.nextAction || '');
    if ((this.nextRevision || 0) === revision && !this.nextDraft?.trim()) {
      this.nextDraft = this.next;
      this.nextBase = this.next;
      this.error = '';
      this.conflict = false;
      await this.save();
    }
    this.notify();
  }
  async rebaseNext() {
    const note = await this.plugin.note(this.file);
    this.next = note.nextAction || '';
    this.nextBase = this.next;
    this.error = '';
    this.conflict = false;
    await this.save();
    this.notify();
  }
  async submit(mode) {
    if (this.busy || this.checkPending) return false;
    const original = mode === 'next' ? this.nextDraft : this.update;
    if (original === undefined || !original.trim()) return false;
    this.busy = true;
    this.error = '';
    this.notify();
    try {
      if (mode === 'next') {
        await this.plugin.setNext(this.file, this.nextBase || '', original.trim());
        if (this.nextDraft === original) {
          this.nextDraft = undefined;
          this.nextBase = undefined;
        } else this.nextBase = original.trim();
        this.next = original.trim();
      } else {
        if (!this.retry || this.retry.text !== original.trim())
          this.retry = { id: crypto.randomUUID(), text: original.trim() };
        await this.save();
        await this.plugin.addUpdate(this.file, this.retry.text, this.retry.id);
        if (this.update === original) this.update = '';
        this.retry = null;
      }
      await this.save();
      this.plugin.refresh();
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    } finally {
      this.busy = false;
      this.notify();
    }
  }
  async toggleNextCheck(expected, line, checked) {
    if (this.busy) return false;
    this.checkPending = (this.checkPending || 0) + 1;
    this.notify();
    try {
      const next = await this.plugin.toggleNextCheck(this.file, expected, line, checked);
      this.syncNext(next);
      await this.save();
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    } finally {
      this.checkPending--;
      this.notify();
    }
  }
  async clearNext() {
    if (this.busy || this.checkPending || !this.next) return;
    const expected = this.next;
    this.busy = true;
    this.error = '';
    this.notify();
    try {
      await this.plugin.setNext(this.file, expected, '');
      this.next = '';
      if (this.nextDraft !== undefined && this.nextDraft !== expected) this.nextBase = '';
      else {
        this.nextDraft = undefined;
        this.nextBase = undefined;
      }
      await this.save();
      this.plugin.refresh();
      const fragment = document.createDocumentFragment();
      el(fragment, 'span', '', 'Следующий шаг убран. ');
      const undo = el(fragment, 'button', 'pb-notice-undo', 'Вернуть');
      undo.onclick = async () => {
        undo.disabled = true;
        try {
          await this.plugin.setNext(this.file, '', expected);
          this.syncNext(expected);
          notice.hide();
        } catch (e) {
          undo.disabled = false;
          this.fail(e);
        }
      };
      const notice = new Notice(fragment, 8000);
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = false;
      this.notify();
    }
  }
}

module.exports = { JournalModel };
