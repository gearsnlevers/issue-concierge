#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { flattenTree, listWidgets } from '{{other_name}}';
import { formatLines } from './format.js';

const USAGE = 'usage: {{name}} tree <file.json> | widgets <file.json>';

function main(argv) {
  const [command, file] = argv;
  if (!['tree', 'widgets'].includes(command) || !file) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`cannot read ${file}: ${error.message}\n`);
    return 1;
  }
  const lines = command === 'tree' ? flattenTree(data) : listWidgets(data).map((widget) => widget.name);
  process.stdout.write(formatLines(lines));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
