'use strict';
const { normalizeFilters, renamedProject } = require('../domain/filters.js');

class SavedFilters {
  constructor(plugin) {
    this.plugin = plugin;
    this.pending = Promise.resolve();
  }
  list(scope) {
    const records = this.plugin.data.savedFilters;
    return (Array.isArray(records) ? records : [])
      .filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string' && x.scope === scope)
      .map((x) => ({ ...x, filters: normalizeFilters(x.filters), archive: !!x.archive }));
  }
  change(update) {
    this.pending = this.pending.catch(() => {}).then(async () => {
      const previous = this.plugin.data.savedFilters;
      const next = update(Array.isArray(previous) ? previous : []);
      this.plugin.data.savedFilters = next;
      try {
        await this.plugin.persist();
      } catch (error) {
        this.plugin.data.savedFilters = previous;
        throw error;
      }
      this.plugin.refresh();
    });
    return this.pending;
  }
  save(scope, name, filters, archive, id) {
    const snapshot = normalizeFilters(filters);
    return this.change((records) => {
      const label = String(name || '').trim();
      if (!label || label.length > 80) throw new Error('Название подборки – от 1 до 80 символов.');
      if (records.some((x) => x.scope === scope && x.id !== id && x.name.toLocaleLowerCase() === label.toLocaleLowerCase()))
        throw new Error('Подборка с таким названием уже есть.');
      if (id && !records.some((x) => x.id === id && x.scope === scope))
        throw new Error('Подборка уже удалена.');
      const entry = { id: id || crypto.randomUUID(), scope, name: label, filters: snapshot, archive: !!archive };
      return id ? records.map((x) => x.id === id && x.scope === scope ? entry : x) : [...records, entry];
    });
  }
  remove(scope, id) {
    return this.change((records) => records.filter((x) => x.scope !== scope || x.id !== id));
  }
  renameProject(oldPath, newPath) {
    const records = this.plugin.data.savedFilters;
    if (!Array.isArray(records) || !records.some((x) => {
      const p = normalizeFilters(x.filters).project;
      return renamedProject(p, oldPath, newPath) !== p;
    })) return Promise.resolve();
    return this.change((current) => current.map((x) => {
      const filters = normalizeFilters(x.filters);
      return { ...x, filters: { ...filters, project: renamedProject(filters.project, oldPath, newPath) } };
    }));
  }
}
module.exports = { SavedFilters };
