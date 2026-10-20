'use strict';
const C = require('../../domain/tasks.js');
const { equal } = require('../../storage/task-change.js');

function labelFor(patch) {
  if ('archived' in patch) return patch.archived ? 'Task archived' : 'Task restored';
  if ('board' in patch || 'status' in patch) return 'Card moved';
  return 'Task properties updated';
}

// One undoable action per session. A drag changes status and order as one action.
class TaskActions {
  constructor(plugin, changed = () => {}) {
    this.plugin = plugin;
    this.changed = changed;
    this.pending = Promise.resolve();
    this.last = null;
    this.sequence = 0;
  }
  run(file, job) {
    const result = this.pending.catch(() => {}).then(() => this.plugin.queue(file, job));
    this.pending = result;
    return result;
  }
  remember(record) {
    if (!record.change && !record.order) return;
    this.last = { ...record, id: ++this.sequence };
    this.changed(this.last);
  }
  patch(file, patch) {
    return this.run(file, async () => {
      const current = await this.plugin.store.get(file.path);
      if (!current) throw new Error('Task not found');
      if (typeof patch === 'function') patch = patch(current);
      const receipt = {};
      try {
        return await this.plugin.store.update(file.path, patch, undefined, receipt);
      } finally {
        this.remember({ file, change: receipt.change, label: labelFor(patch), title: current.title });
        this.plugin.refresh();
      }
    });
  }
  async order() {
    return C.orderedTasks(await this.plugin.tasks(), this.plugin.data.order).map((t) => t.path);
  }
  async saveOrder(next) {
    const old = this.plugin.data.order;
    this.plugin.data.order = next;
    try { await this.plugin.persist(); }
    catch (error) { this.plugin.data.order = old; throw error; }
  }
  move(file, status, anchor, after) {
    return this.run(file, async () => {
      const task = await this.plugin.store.get(file.path);
      if (!task) throw new Error('Task not found');
      const before = await this.order();
      const next = C.moveTaskOrder(before, file.path, anchor, after);
      const receipt = {};
      let order;
      try {
        if (task.status !== status)
          await this.plugin.store.update(file.path, { status }, undefined, receipt);
        if (!equal(before, next)) {
          await this.saveOrder(next);
          // Keep file identities so renames cannot break the saved position.
          const files = (paths) => paths.map((p) => this.plugin.app.vault.getAbstractFileByPath(p)).filter(Boolean);
          order = { before: files(before), after: files(next) };
        }
      } finally {
        this.remember({ file, change: receipt.change, order, label: 'Card moved', title: task.title });
        this.plugin.refresh();
      }
    });
  }
  undo(expected = this.last) {
    if (!expected) return Promise.resolve(false);
    return this.run(expected.file, async () => {
      if (this.last !== expected) return false; // An old notification never undoes a newer action.
      const { file, change, order } = expected;
      const vault = this.plugin.app.vault;
      if (vault.getAbstractFileByPath(file.path) !== file)
        throw new Error('The task was deleted or replaced. Undo is unavailable.');
      const current = await this.order();
      let restored = current;
      if (order) {
        const surviving = (files) => files.filter((f) => vault.getAbstractFileByPath(f.path) === f && current.includes(f.path)).map((f) => f.path);
        const after = surviving(order.after);
        if (!equal(current.filter((p) => after.includes(p)), after))
          throw new Error('Card order changed. Undo is unavailable.');
        const before = surviving(order.before), index = before.indexOf(file.path);
        const next = before[index + 1], previous = before[index - 1];
        restored = C.moveTaskOrder(current, file.path, next || previous, !next && !!previous);
      }
      const reordered = !equal(current, restored);
      if (reordered) await this.saveOrder(restored);
      try {
        if (change) await this.plugin.store.undoChange(file, change);
      } catch (error) {
        if (reordered) {
          try { await this.saveOrder(current); }
          catch (_) {
            // The position was restored, but its rollback could not be saved.
            // Keep the remaining field change retryable instead of replaying order.
            expected.order = undefined;
            throw new Error('Position restored, but properties were not saved. Try undo again.');
          }
        }
        throw error;
      }
      this.last = null;
      this.changed(null);
      return true;
    }).finally(() => this.plugin.refresh());
  }
}
module.exports = { TaskActions };
