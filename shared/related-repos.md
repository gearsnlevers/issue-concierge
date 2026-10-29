# Related repositories

Optional configuration for split-repo projects.

Copy this file to `.github/issue-concierge/related-repos.md` in a consuming repository when issues are frequently reported in the wrong place.

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

When the issue worker decides an issue belongs in a related repository (it decides from the report text and keeps the issue here by default; it routes only when the report itself names the failing component in the other repository, it quotes those words, and it does not search to decide):

1. It creates a **canonical** issue in that repository, which starts with the hold label `plan-approval-required` until a maintainer has read its plan, and with the label `original-in-related-repo`, which marks it as opened from an issue in another repository.
2. It cross-links both issues with plain-language comments.
3. It applies the internal label `related-repo` to the **original** (non-canonical) issue and does not start planning there.
4. The original issue stays open.
5. When the canonical issue is closed as completed:
   - If `release.requires_consumer_release` is set, the original issue stays open and gets `waiting-for-release`. It closes when a release of this repository includes the fix.
   - Otherwise `related-repo-closer` closes the original issue with a short notice.
   - A canonical issue closed as not planned or as a duplicate changes nothing: a maintainer decides what the original says.

The labels `related-repo` and `original-in-related-repo` are internal. Reporters never see or manage them. `related-repo-closer` is a script, not a model: it starts only for a closed issue that carries `original-in-related-repo`, so a canonical issue opened by hand needs that label too.

## Writing `when` and `notes`

The issue worker uses these as a guide to where to look, never as proof. Say which code lives where, because the worker decides from this text and from the report, and does not search the code to decide, and not how often an issue belongs somewhere:

- Name what each repository owns in terms of code (for example "the library owns the facade and the API calls; the CLI owns prompts, terminal input and output, the interactive mode, packaging and the commands that wrap the library") and point at the repository's `AGENTS.md` or decision records for the layering. When they say which layer owns what, the worker applies that statement over the `when` text.
- Do not write a keyword rule ("authentication flows go to the library") or a prior ("most issues belong in the library"): an error message produced by one layer is often only the wrapper around a failure from the other, and a prior sends every borderline issue the same way. Say instead "when in doubt, keep the issue here".
- Keep the two files of a split project symmetrical: each names what the other repository owns, so that an issue can be routed back.
