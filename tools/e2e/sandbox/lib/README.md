# {{name}}

A sandbox library for the Issue Concierge end-to-end tests. It is not a product and nothing here is released.

It holds two small functions, `flattenTree` and `listWidgets`, and a command line app in [{{other}}](https://github.com/{{other}}) calls them. The pair mirrors a project split into a library and a command line tool, so that the Concierge's routing between two repositories can be tested.

Issues here are test data. The test runner opens and closes them, and a pull request is never merged for them. This repository is seeded from `tools/e2e/sandbox/` of the Issue Concierge, and a reseed overwrites every file in it.
