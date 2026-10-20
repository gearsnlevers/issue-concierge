# Issue completeness criteria

Optional, repository-specific guidance for the issue worker.

## Preferred source: issue template

By default the issue worker should treat the repository’s issue template as the definition of a meaningful issue.

Look for, in order:

1. `.github/ISSUE_TEMPLATE/` (any `.md` or `.yml` form templates)
2. `.github/ISSUE_TEMPLATE.md`
3. This file, if a consuming repository has copied and customized it to `.github/agentic-workflows/issue-completeness.md`

Use the fields, checklists, and required sections from the template to decide what is missing and what to ask the reporter for.

## Fallback

If no issue template and no custom completeness file exist, use generic criteria:

- Clear description
- Steps to reproduce (bugs) or acceptance criteria (enhancements)
- Expected vs actual behavior
- Environment (version, OS)

## Custom override

A repository may still place a tailored file at `.github/agentic-workflows/issue-completeness.md` when the issue template is absent or insufficient. That file takes precedence over the generic fallback but is not required when a good issue template already exists.
