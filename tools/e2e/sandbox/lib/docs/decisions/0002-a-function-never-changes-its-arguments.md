---
status: accepted
date: 2026-10-26
decision-makers:
  - maintainers
applies-to:
  - src/**
---

# A function never changes its arguments

## Context and problem statement

A function that sorts or edits the list it was given surprises the caller who still holds that list. The program that calls the library cannot see inside it to find out.

## Decision

An exported function returns a new value. It does not sort, push to, delete from or assign to an argument, or to anything reachable from one. A test pins this for every function that takes a list or an object.

## Consequences

A function copies before it changes anything. A caller may pass frozen data. A request for a function that edits its input in place is declined or written to return a new value.
