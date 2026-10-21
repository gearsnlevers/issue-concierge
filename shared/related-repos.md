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
    release:
      requires_consumer_release: true
      pins: "@owner/other-package"    # dependency this repo pins

notes: |
  Optional free-text guidance.
```

### Rules
- `related` is a list (zero or more entries).
- Each entry needs `role` and `repo`; `when` is recommended.
- `secret` is the name of the Actions secret that can create issues in that repository.
  Each related repository can name its own secret. The same name may be reused when one token covers several repositories.
- `release.requires_consumer_release`: when true, the original issue stays open after the canonical issue is fixed. It closes only when a release of `this` includes that fix.
- `release.pins`: the package name this repository pins, used to match a release to the related repository's fix.
- No other fixed key names beyond `this`, `related`, `role`, `repo`, `secret`, `when`, `release`, `notes`.

## Linked-issue behavior

When the issue worker decides an issue belongs in a related repository:

1. It creates a **canonical** issue in that repository.
2. It cross-links both issues with plain-language comments.
3. It applies the internal label `related-repo` to the **original** (non-canonical) issue and does not start planning there.
4. The original issue stays open.
5. When the canonical issue is closed:
   - If `release.requires_consumer_release` is set, the original issue stays open and gets `waiting-for-release`. It closes when a release of this repository includes the fix.
   - Otherwise `related-repo-closer` closes the original issue with a short notice.

The label `related-repo` is internal. Reporters never see or manage it.
