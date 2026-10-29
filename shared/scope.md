# Project scope

Optional, repository-specific boundaries for the issue worker. Copy this file to `.github/issue-concierge/scope.md` in the consuming repository and fill it in. Without that file the scope check is off and every request counts as in scope.

The issue worker compares each request with this file as written. It does not invent boundaries. Two outcomes matter:

- A request that matches an item under **Out of scope** is declined with a short, polite explanation, and the issue is closed as not planned.
- A request that is not listed there but looks like it may not fit the **Purpose** is held for a maintainer, who decides. Nothing is closed in that case.

A bug in something the project already does is always in scope.

## Purpose

<!-- One short paragraph: what the project is for and who uses it. -->

## In scope

<!-- The areas the project covers, one per line. Be concrete enough that a reader can tell what belongs. -->

-

## Out of scope

<!--
Things the project will not do. Every item here can close an issue automatically, so list only requests you
are sure you would decline, and word each one so that a matching request is clearly the thing described.
Do not list things that are merely large, hard, risky or unusual: those go through the normal gates.
Prefer a short reason after each item; the issue worker uses it in its reply.
-->

-

## Needs a maintainer

<!--
Optional. Kinds of requests that are close to the boundary: not excluded, but you want to look at them
before any work is planned. The issue worker holds a request for a maintainer when it matches one of these.
-->

-

## Where to go instead

<!-- Optional. Pointers for common declined requests, for example another project or a documented workaround. -->

-
