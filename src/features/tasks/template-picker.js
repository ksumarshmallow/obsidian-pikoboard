'use strict';
const { FuzzySuggestModal } = require('obsidian');

class TemplatePicker extends FuzzySuggestModal {
  constructor(app, items, resolve) {
    super(app);
    Object.assign(this, { items, resolve });
    this.setPlaceholder('Choose template');
  }
  getItems() { return this.items; }
  getItemText(item) { return item.label; }
  onChooseItem(item) { this.resolve(item); }
  onClose() {
    super.onClose();
    // Obsidian closes its suggestion modal before calling onChooseItem.
    setTimeout(() => this.resolve(null), 0);
  }
}
async function pickTemplate(plugin) {
  const items = await plugin.templates.list();
  items.push({ label: '+ New template', create: true });
  return new Promise((resolve) => new TemplatePicker(plugin.app, items, resolve).open());
}
module.exports = { TemplatePicker, pickTemplate };
