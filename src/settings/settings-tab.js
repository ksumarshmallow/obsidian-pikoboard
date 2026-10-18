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
    for (const [key, label] of [
      ['boardsFolder', 'Папка новых досок'],
      ['tasksFolder', 'Папка новых задач'],
      ['attachmentsFolder', 'Папка вложений'],
      ['materialsFolder', 'Папка исследований'],
      ['projectsFolder', 'Папка проектов'],
    ])
      new Setting(containerEl)
        .setName(label)
        .setDesc('Внутри хранилища. Пустое поле — корень. Существующие файлы не переносятся.')
        .addText((field) => {
          field.setValue(this.plugin.settings[key]).setPlaceholder('Корень хранилища');
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
      .setName('Архивировать завершённые задачи')
      .setDesc('Файлы сохраняются. Задачи можно вернуть из архива.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoArchive)
          .onChange((value) => save({ autoArchive: value })),
      );
    new Setting(containerEl).setName('Дней до архивации').addText((field) => {
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
      .setName('Доска')
      .addButton((b) => b.setButtonText('Создать доску').onClick(() => this.plugin.newBoard()));
  }
}

module.exports = { PikoBoardSettings };
