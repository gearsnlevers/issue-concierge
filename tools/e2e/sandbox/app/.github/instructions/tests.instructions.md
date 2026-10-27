---
applyTo: 'test/**'
---

- Use `node:test` and `node:assert/strict`. Do not add a test framework.
- Do not import the library in a test: a test here covers code in this repository.
- One test file per source file: `src/format.js` is tested by `test/format.test.js`.
