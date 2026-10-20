# Issue completeness criteria

Optional, repository-specific guidance for the issue worker.

Copy this file to `.github/agentic-workflows/issue-completeness.md` in a consuming repository and edit it. The issue worker reads that file when it exists and uses it to decide what makes an issue meaningful in that repository.

If the file is absent, the worker falls back to generic criteria (reproduction steps, expected vs actual, environment).

## Example (edit per repository)

An issue is meaningful when it includes:

- Clear description of the problem or requested change
- Steps to reproduce (for bugs) or acceptance criteria (for enhancements)
- Expected vs actual behavior
- Environment details relevant to this project (version, OS, configuration flags, etc.)
- For this repository specifically: …

An issue may be treated as not urgent when:

- …

An issue may be closed when:

- …
