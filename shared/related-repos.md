# Related repositories

Optional configuration for split-repo projects.

Copy this file to `.github/agentic-workflows/related-repos.md` in a consuming repository when issues are frequently reported in the wrong place.

## Schema

```yaml
this: owner/repo

related:
  - role: library          # free-form role name
    repo: owner/other-repo
    secret: OTHER_REPO_ISSUES_TOKEN   # Actions secret used to create issues there
    when: |
      When an issue reported here should be tracked in the other repository.

notes: |
  Optional free-text guidance.
```

### Rules
- `related` is a list (zero or more entries).
- Each entry needs `role` and `repo`; `when` is recommended.
- `secret` is the name of the Actions secret that can create issues in that repository.
  Each related repository can name its own secret. The same name may be reused when one token covers several repositories.
- No other fixed key names beyond `this`, `related`, `role`, `repo`, `secret`, `when`, `notes`.

## Linked-issue behavior

When the issue worker decides an issue belongs in a related repository:

1. It creates a **canonical** issue in that repository.
2. It cross-links both issues with plain-language comments.
3. It applies the internal label `related-repo` to the **original** (non-canonical) issue and does not start planning there.
4. The original issue stays open.
5. When the canonical issue is closed, `related-repo-closer` closes the original issue with a short notice.

The label `related-repo` is internal. Reporters never see or manage it.
