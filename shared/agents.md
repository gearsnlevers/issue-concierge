<!--
Template for AGENTS.md at the ROOT of the consuming repository (not under .github/agentic-workflows/).
Coding agents (the Copilot cloud agent, Copilot CLI, code review and others) load AGENTS.md on their own, and the
Concierge's plan and PR gates read it from the default branch. Nothing else needs wiring.
Keep it short, 60 lines or fewer: it is loaded into every agent run and every token costs credits. Put commands
first, show one real snippet instead of describing it, and move rules for one part of the code into
.github/instructions/ (see the last section). Delete this comment and every placeholder you do not need.
-->

# <Project>: instructions for coding agents

<What the project is, in one sentence, and the stack with versions, for example "TypeScript, Node.js 24, Jest".>

## Commands

```console
<install>                     # for example: npm ci
<build>                       # for example: npm run build
<lint and format check>       # for example: npm run check
<tests: all, and one file>    # for example: npm test, npm test -- path/to/file.test.js
```

Run the lint and test commands before you finish. <Say which step must come first, for example "rebuild before the end-to-end tests".>

## Testing

<Where the tests live, which kinds exist, and what a new feature needs: a unit test, a snapshot, a recording.>

## Project structure

| Path    | What     |
| ------- | -------- |
| `src/`  | <what>   |
| `test/` | <what>   |

## Code style

<The few rules a linter does not catch. One real snippet of good code beats a paragraph describing it.>

## Git and pull requests

<Branch and title conventions, what the description must say, whether the changelog is generated or edited by hand.>

## Boundaries

- **Always:** <for example run the checks, follow the naming rules in `.github/instructions/`>
- **Ask first:** <for example change a public API, add a dependency, change the CI pipeline>
- **Never:** commit secrets or keys, edit generated files, <anything else that must not happen>.
- **Never edit the Repo Concierge's files** (its workflow definitions, scripts and the pin in `.github/concierge.yml`).
  The updater overwrites them. They are listed with their destinations in `release-manifest.json` of the pinned release.

## Decisions

Design decisions live in `docs/decisions/` (or `decisions/` at the repository root when `docs/` is generated) as records
`NNNN-short-title.md`, listed in the `README.md` of that folder. An accepted record binds until a newer record
supersedes it. Read the matching record before you change a decided behaviour; a change to it needs a new or superseding
record in the same pull request (template: `shared/decision-record.md` of the Repo Concierge). Decisions that bind
several repositories are listed here with a link: <none, or the list>.

## Component rules

Rules that apply to one part of the code live in `.github/instructions/<name>.instructions.md`. Each file starts with
frontmatter `applyTo: '<glob>'` (comma-separated globs), and agents load it when they edit a matching file.
Link them here: [<name>](.github/instructions/<name>.instructions.md).
