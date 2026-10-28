# Project scope

## Purpose

{{name}} is a small sandbox library that computes data: it flattens a tree of nodes into a list and sorts a list of widgets. A command line app calls it. It exists to test the Issue Concierge and is not used for anything else.

## In scope

- Functions that take a tree or a list of widgets and return a new value
- Fixes for wrong, missing or surprising results of those functions
- Tests and documentation for them

## Out of scope

- A web page, a dashboard or any other graphical interface for the library. The library only returns data; showing it is the job of a program that calls it.
- Reading or writing files, or calling a network service, from a library function. The functions are pure.

## Where to go instead

- A command line, or any way of showing the data, belongs in `{{other}}`.
