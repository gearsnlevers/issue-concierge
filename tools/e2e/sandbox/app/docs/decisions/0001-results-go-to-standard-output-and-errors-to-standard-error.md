---
status: accepted
date: 2026-10-26
decision-makers:
  - maintainers
applies-to:
  - src/**
---

# Results go to standard output and errors to standard error

## Context and problem statement

Scripts that call the app read its output. A message mixed into the results breaks the script, and an error printed to standard output looks like a result.

## Decision

A command writes its result to standard output, one item per line, and nothing else there. Every error and the usage text go to standard error, and the exit code is 1. A command never prints decoration, colour codes or progress text to standard output.

## Consequences

The output can be piped to another program. A request for friendlier output is written so that it does not change standard output unless the caller asks for it.
