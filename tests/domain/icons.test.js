'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { iconCatalog, searchIcons, iconPreferences } = require('../../src/domain/icons.js');

test('icon library accepts only registered Lucide icons and searches names plus Russian hints', () => {
  const library = iconCatalog(['lucide-book-open', 'lucide-book-heart', 'lucide-house', 'lucide-book-open', 'external-pack-book', 'plugin-secret', 'book']);
  assert.deepEqual(library.map((i) => i.id), ['book-heart', 'book-open', 'house']);
  assert.deepEqual(searchIcons(library, 'КНИГА').map((i) => i.id), ['book-heart', 'book-open']);
  assert.deepEqual(searchIcons(library, 'book open').map((i) => i.id), ['book-open']);
  assert.deepEqual(searchIcons(library, 'дом').map((i) => i.id), ['house']);
  const homeLibrary = iconCatalog(['lucide-bell', 'lucide-house', 'lucide-house-heart']);
  assert.deepEqual(searchIcons(homeLibrary, 'дом').map((i) => i.id), ['house', 'house-heart']);
  assert.deepEqual(searchIcons(homeLibrary, 'увед').map((i) => i.id), ['bell']);
  assert.equal(searchIcons(library, 'missing').length, 0);
});

test('preferences handle malformed input and retain unknown favorites for devices on older Obsidian versions', () => {
  assert.deepEqual(iconPreferences(null), { favorites: [], recent: [] });
  assert.deepEqual(iconPreferences({ favorites: ['lucide-house', 'house', null, 'new-icon'], recent: 'invalid' }), { favorites: ['house', 'new-icon'], recent: [] });
  assert.equal(iconPreferences({ recent: Array.from({ length: 100 }, (_, i) => 'icon-' + i) }).recent.length, 24);
});
