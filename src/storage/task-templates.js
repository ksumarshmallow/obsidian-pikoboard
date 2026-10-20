'use strict';
const C = require('../domain/tasks.js');
const { splitDocument, folderPath } = require('./task-store.js');

const MARKER = 'pikoboard-template';
function unchecked(text) {
  return C.parseChecklist(text).reduce(
    (body, item) => C.setChecklistItem(body, item.line, { checked: false }), text,
  );
}
function templateContent(source, parseYaml, systemTags = []) {
  const { data } = splitDocument(source, parseYaml);
  // Validate the managed blocks before stripping history.
  const note = C.readNote(source);
  C.replaceBody(source, note.body, note.body);
  const description = unchecked((note.body + note.tail).trim());
  const next = unchecked(note.nextAction);
  const details = next ? C.setNextAction(description, '', next) : description;
  return { details, tags: C.taskTags(data.tags, [], systemTags) };
}

class TaskTemplates {
  constructor(plugin, parseYaml, stringifyYaml) {
    Object.assign(this, { plugin, parseYaml, stringifyYaml });
    this.saving = Promise.resolve();
  }
  async list() {
    const folder = folderPath(this.plugin.settings.templatesFolder);
    const files = this.plugin.app.vault.getMarkdownFiles()
      .filter((f) => !folder || f.path.startsWith(folder + '/'));
    const result = [];
    for (const file of files) {
      try {
        const { data } = splitDocument(await this.plugin.app.vault.read(file), this.parseYaml);
        if (data[MARKER] === true) result.push({ label: file.basename, file });
      } catch {
        // An unrelated malformed note must not break the picker.
      }
    }
    return result.sort((a, b) => a.label.localeCompare(b.label) || a.file.path.localeCompare(b.file.path));
  }
  async read(file) {
    const source = await this.plugin.app.vault.read(file);
    if (splitDocument(source, this.parseYaml).data[MARKER] !== true)
      throw new Error('This file is no longer a template');
    return templateContent(source, this.parseYaml, this.plugin.store.systemTags());
  }
  save(name, file) {
    const work = this.saving.catch(() => {}).then(async () => {
      const content = file
        ? templateContent(await this.plugin.app.vault.read(file), this.parseYaml, this.plugin.store.systemTags())
        : { details: '', tags: [] };
      const data = { [MARKER]: true };
      if (content.tags.length) data.tags = content.tags;
      return this.plugin.uniqueNote(
        folderPath(this.plugin.settings.templatesFolder), name,
        '---\n' + this.stringifyYaml(data).trimEnd() + '\n---\n\n' + content.details,
      );
    });
    this.saving = work;
    return work;
  }
}
module.exports = { TaskTemplates, templateContent };
