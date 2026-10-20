# Related repositories

Optional configuration for split-repo projects.

Copy this file to `.github/agentic-workflows/related-repos.md` in a consuming repository when issues are frequently reported in the wrong place.

## Schema

```yaml
# This repository (informational)
this: owner/repo

# One or more related repositories.
# Each entry has a role and a repo.
related:
  - role: library          # free-form role name (library, cli, docs, examples, …)
    repo: owner/other-repo
    when: |
      Most functional bugs, API behavior, data handling, and core logic belong here.
      Suggest transfer when the issue is about these topics.
  - role: cli
    repo: owner/cli-repo
    when: |
      Argument parsing, help text, output formatting, packaging, and distribution only.

notes: |
  Optional free-text guidance for the issue worker.
```

### Rules
- `related` is a list. You may have zero or more entries.
- Each entry must have `role` and `repo`.
- `when` is optional but recommended; it tells the worker when to suggest that repository.
- There is no special `primary` or `library` key. Use `role` for whatever distinction you need.
- The file is read only by the issue worker. If it is absent, no transfer suggestions are made.

## Example (frodo-cli)

```yaml
this: rockcarver/frodo-cli
related:
  - role: library
    repo: rockcarver/frodo-lib
    when: |
      Functional bugs, API behavior, authentication flows, data handling,
      and anything that is not purely CLI surface (args, help, formatting, packaging).
notes: |
  Most issues reported here actually belong in the library.
  Only keep issues that are strictly about the CLI wrapper.
```
