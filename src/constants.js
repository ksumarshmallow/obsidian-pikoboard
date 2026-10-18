'use strict';
const { DEFAULT_COLUMNS } = require('./storage/board-store.js');

const TYPE = 'pikoboard-view';
const FILE_TYPE = 'pikoboard-file-view';
const CONTEXT = { source: 'pikoboard' };
const statuses = DEFAULT_COLUMNS;

module.exports = { TYPE, FILE_TYPE, CONTEXT, statuses };
