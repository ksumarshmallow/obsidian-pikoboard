'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { bundle } = require('./bundle.js');

function artifacts(root) {
  const source = path.join(root, 'src');
  const licenses = ['LICENSE', 'THIRD-PARTY-LICENSES.txt']
    .map((name) => fs.readFileSync(path.join(root, name), 'utf8').trim()).join('\n\n');
  // Directory installations download only the three runtime assets. Keep the
  // full MIT notices in main.js as well as the standalone license files.
  const banner = '/*!\n' + licenses.replace(/\*\//g, '* /') + '\n*/\n';
  return {
    'main.js': banner + bundle(path.join(source, 'plugin.js'), source),
    'styles.css': fs.readFileSync(path.join(source, 'styles/pikoboard.css'), 'utf8'),
  };
}
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  for (const [name, contents] of Object.entries(artifacts(root)))
    fs.writeFileSync(path.join(root, name), contents);
  console.log('Built main.js and styles.css');
}
module.exports = { artifacts };
