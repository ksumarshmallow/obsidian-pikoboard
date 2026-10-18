'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function scripts(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? scripts(filename) : filename.endsWith('.js') ? [filename] : [];
  });
}
const files = [
  path.join(root, 'main.js'),
  ...['src', 'scripts', 'tests'].flatMap((directory) => scripts(path.join(root, directory))),
];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Checked ${files.length} JavaScript files`);
