'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { bundle } = require('./bundle.js');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src');
const script = bundle(path.join(source, 'plugin.js'), source);
const styles = fs.readFileSync(path.join(source, 'styles/pikoboard.css'), 'utf8');

fs.writeFileSync(path.join(root, 'main.js'), script);
fs.writeFileSync(path.join(root, 'styles.css'), styles);
console.log('Built main.js and styles.css');
