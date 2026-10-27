---
status: accepted
date: 2026-10-26
decision-makers:
  - maintainers
---

# The app calls the library and does not copy its logic

## Context and problem statement

When a program copies a function of its library, the two copies drift apart, and a fix in one is missing from the other. The app only reads, calls and prints.

## Decision

Any result that a library function can compute is computed by calling that function. The app does not reimplement it, not even a small part of it. A defect in a result is fixed in the library, and a defect in how the result is read or shown is fixed in the app.

## Consequences

A fix that changes a result needs a change in the library first. The app may need a newer library before a fix reaches its users.
