---
status: accepted
date: 2026-10-26
decision-makers:
  - maintainers
---

# The library has no runtime dependencies

## Context and problem statement

A small library that pulls in a package for a one-line job passes that package's updates, advisories and licence to every program that uses it. This sandbox library exists to be small.

## Decision

`package.json` has no `dependencies`. A function is written with the platform's own features. A request to add a package, for sorting or for walking a tree for example, is declined, or written with the platform instead.

## Consequences

Every program that uses the library installs nothing with it. A function that a package would have given for free is written and tested here. Development tools are not runtime dependencies and are not covered by this record.
