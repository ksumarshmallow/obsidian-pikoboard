'use strict';
const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { errorMessage } = require('../ui/format.js');

class PikoBoardSettings extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const save = (patch) =>
      this.plugin.saveSettings(patch).catch((e) => new Notice(errorMessage(e)));
    new Setting(containerEl)
      .setName('Appearance')
      .addDropdown((field) => {
        field.addOption('obsidian', 'System');
        field.addOption('piko', 'pikoboard-dark');
        field.addOption('piko-light', 'pikoboard-light');
        field.setValue(this.plugin.settings.appearance);
        field.onChange(async (appearance) => {
          field.selectEl.disabled = true;
          try {
            await this.plugin.saveSettings({ appearance });
          } catch (error) {
            field.setValue(this.plugin.settings.appearance);
            new Notice(errorMessage(error));
          } finally {
            field.selectEl.disabled = false;
          }
        });
      });
    for (const [key, label] of [
      ['boardsFolder', 'New boards folder'],
      ['tasksFolder', 'New tasks folder'],
      ['attachmentsFolder', 'Attachments folder'],
      ['materialsFolder', 'Research folder'],
      ['projectsFolder', 'Projects folder'],
      ['templatesFolder', 'Task templates folder'],
    ])
      new Setting(containerEl)
        .setName(label)
        .setDesc('Inside the vault. Leave empty for the vault root. Existing files stay in place.')
        .addText((field) => {
          field.setValue(this.plugin.settings[key]).setPlaceholder('Vault root');
          field.inputEl.addEventListener('change', async () => {
            try {
              await this.plugin.saveSettings({ [key]: field.getValue().trim() });
            } catch (e) {
              field.setValue(this.plugin.settings[key]);
              new Notice(errorMessage(e));
            }
          });
        });
    new Setting(containerEl)
      .setName('Archive completed tasks')
      .setDesc('Task files are kept. You can restore tasks from the archive.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoArchive)
          .onChange((value) => save({ autoArchive: value })),
      );
    new Setting(containerEl).setName('Days before archiving').addText((field) => {
      field.setValue(String(this.plugin.settings.archiveDays));
      field.inputEl.type = 'number';
      field.inputEl.min = '1';
      field.inputEl.addEventListener('change', () => {
        const days = Number(field.getValue());
        if (!Number.isFinite(days) || days < 1) {
          field.setValue(String(this.plugin.settings.archiveDays));
          return;
        }
        save({ archiveDays: days });
      });
    });
    new Setting(containerEl)
      .setName('Task templates')
      .setDesc('Save any task as a template from its menu, or start with a blank note.')
      .addButton((b) => b.setButtonText('New template').onClick(() => this.plugin.newTemplate()));
    new Setting(containerEl)
      .setName('Board')
      .addButton((b) => b.setButtonText('Create board').onClick(() => this.plugin.newBoard()));
  }
}

module.exports = { PikoBoardSettings };
