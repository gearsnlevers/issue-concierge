# {{name}}: instructions for coding agents

A sandbox command line app (JavaScript, Node.js 20 or later, ES modules) that reads a JSON file, calls a function of the library `{{other}}` and prints the result.

## Commands

```console
npm test                          # all tests
node --test test/format.test.js   # one file
node --check src/cli.js           # syntax check of the entry point
```

Run the tests before you finish. The tests do not install the library: they cover the code in this repository only.

## Testing

Tests live in `test/`, one file per source file, written with `node:test`. A new output format needs a test file.

## Project structure

| Path | What |
| ---- | ---- |
| `src/cli.js` | the entry point: reads arguments and a file, calls the library, prints |
| `src/format.js` | turns a list into the text that is printed |
| `test/` | `node:test` files, named after the source file |
| `docs/decisions/` | decision records |

## Code style

Keep `src/cli.js` thin: it reads, calls, prints and returns an exit code. Example:

```js
const lines = command === 'tree' ? flattenTree(data) : listWidgets(data).map((widget) => widget.name);
process.stdout.write(formatLines(lines));
```

## Git and pull requests

Branch `feat/<short>` or `fix/<short>`. Title in conventional-commit form, for example `feat: print a tree with indentation`. The description says what changed and why. Do not edit a changelog or the version: nothing is released from this repository.

## Boundaries

- **Always:** run `npm test`.
- **Ask first:** add a command, change what is printed, add a dependency.
- **Never:** commit secrets or keys. Copy logic from the library instead of calling it.
- **Never edit the Issue Concierge's files** (its workflow definitions, scripts and the pin in `.github/concierge.yml`). The updater overwrites them.

## Layers

This app owns the command line: reading files, arguments, printing, exit codes and error messages. The library in `{{other}}` owns every function that computes a result: the tree walk and the widget list. A report about how the data is shown or about a command belongs here; a report about wrong or missing data belongs there. When in doubt, keep the issue here.

## Decisions

Design decisions live in `docs/decisions/` as records `NNNN-short-title.md`, listed in the `README.md` of that folder. An accepted record binds until a newer record supersedes it. A change to a decided behaviour needs a new or superseding record in the same pull request. Decisions that bind both repositories: none.

## Component rules

- [source](.github/instructions/source.instructions.md)
- [tests](.github/instructions/tests.instructions.md)
