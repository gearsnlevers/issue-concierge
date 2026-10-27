# {{name}}

A sandbox command line app for the Repo Concierge end-to-end tests. It is not a product and nothing here is released.

It reads a JSON file and prints the result of a function from [{{other}}](https://github.com/{{other}}): `{{name}} tree tree.json` prints the node ids of a tree, one per line, and `{{name}} widgets widgets.json` prints the widget names in order. The pair mirrors a project split into a library and a command line tool, so that the Concierge's routing between two repositories can be tested.

Issues here are test data. The test runner opens and closes them, and a pull request is never merged for them. This repository is seeded from `tools/e2e/sandbox/` of the Repo Concierge, and a reseed overwrites every file in it.
