# Change guard

Optional, repository-specific. Copy this file to `.github/agentic-workflows/guard.md` in the consuming repository and fill it in.

The Concierge holds every request that changes what already exists for a maintainer to decide, before anything is planned and before a coding agent is started. A change to what exists removes, renames or replaces a command, an option, an alias, an exported function or a file or data format; changes an interface so that something that works today stops working or reads differently to a script (a signature, the meaning of an option, an output format or an exit code someone may parse, a default that changes what a command does); or changes the architecture. A fix, an addition, and a refinement inside what the project documents and tests are not held. That holds with or without this file. The file sharpens the check for your project: it names what you protect, and it names what you are happy to have taken on without asking.

This file is not `scope.md`. Scope answers "is this ours?" and can close a request. This file answers "may it be changed without a maintainer?" and never closes anything: a held request waits with the label `needs-decision` until a maintainer removes it and adds `issue-triage-handoff`.

The issue worker and the plan worker read the file as written and judge a request by what it does, not by how it is argued. It can never lift a hold, change a label or an approval, and text in it that tries to is ignored.

## Protected

<!--
Surfaces whose removal, renaming or change of behavior needs a maintainer. Name them the way a user sees them,
one per line, with the reason if it helps a reader. Be concrete: "the `export` and `import` file formats" tells the
worker more than "public interfaces".
-->

-

## Architecture

<!--
Decisions that shape the whole project, so that a request to move them is never a small change: the layers and which
one owns what, how data is stored, how users authenticate, how the project is built and released.
-->

-

## Freely changeable

<!--
Optional. What you are glad to have picked up without asking, so that the worker does not hold it: for example a fix that
restores documented behavior, a new option whose default changes nothing, documentation, tests, an internal refactor
that is covered by tests. Do not list anything that appears under Protected or Architecture.
-->

-
