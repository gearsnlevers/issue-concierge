# {{name}}: instructions for coding agents

A sandbox library (JavaScript, Node.js 20 or later, ES modules, no dependencies) that computes data. The command line app in `{{other}}` calls it and prints the result.

## Commands

```console
npm test                          # all tests
node --test test/tree.test.js     # one file
```

Run the tests before you finish.

## Testing

Tests live in `test/`, one file per source file, written with `node:test`. A new exported function needs a test file, and a changed behaviour needs a changed test.

## Project structure

| Path | What |
| ---- | ---- |
| `src/` | the exported functions; `src/index.js` lists the public API |
| `test/` | `node:test` files, named after the source file |
| `docs/decisions/` | decision records |

## Code style

Functions are small and pure. Example:

```js
export function listWidgets(widgets) {
  return [...widgets].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
```

## Git and pull requests

Branch `feat/<short>` or `fix/<short>`. Title in conventional-commit form, for example `fix: list a repeated node under every parent`. The description says what changed and why. Do not edit a changelog or the version: nothing is released from this repository.

## Boundaries

- **Always:** run `npm test`.
- **Ask first:** change what an exported function returns, add a dependency.
- **Never:** commit secrets or keys.
- **Never edit the Repo Concierge's files** (its workflow definitions, scripts and the pin in `.github/concierge.yml`). The updater overwrites them.

## Layers

This library owns every function that computes a result: the tree walk and the widget list. The app in `{{other}}` owns the command line: reading files, arguments, printing, exit codes and error messages. A report about wrong or missing data belongs here; a report about how the data is shown or about a command belongs there. When in doubt, keep the issue here.

## Decisions

Design decisions live in `docs/decisions/` as records `NNNN-short-title.md`, listed in the `README.md` of that folder. An accepted record binds until a newer record supersedes it. A change to a decided behaviour needs a new or superseding record in the same pull request. Decisions that bind both repositories: none.

## Component rules

- [source](.github/instructions/source.instructions.md)
- [tests](.github/instructions/tests.instructions.md)
