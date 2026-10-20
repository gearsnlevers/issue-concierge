# Related repositories

Optional configuration for split-repo projects.

Copy this file to `.github/agentic-workflows/related-repos.md` in a consuming repository when issues are frequently reported in the wrong repository.

## Example (frodo)

```yaml
primary: rockcarver/frodo-cli
library: rockcarver/frodo-lib
notes: |
  Most functional bugs belong in the library.
  CLI issues are limited to argument parsing, help text, output formatting, and packaging.
  When an issue reported in the CLI is clearly a library problem, suggest transferring it.
```

The issue worker reads this file when present and uses it to decide whether to recommend moving the issue.
