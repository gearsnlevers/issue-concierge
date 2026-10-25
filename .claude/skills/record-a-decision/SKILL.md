---
name: record-a-decision
description: Use when a change settles something that will outlive it (a rule contributors must follow, a design principle, a policy), when a pull request changes a behaviour an accepted decision record covers, or when you need to supersede or deprecate a record. Covers when a record is warranted, numbering, front matter, the fixed sections, how to write it so it stays true, the index, the sensitivity screen and the validator.
---

# Record a decision

A decision record says **what we chose and why**, as a rule a reviewer can check. The records are binding; a skill like this one says how to write one. The authoritative text is [docs/decisions/README.md](../../../docs/decisions/README.md); this is the order to do it in.

## 1. Decide whether you need one

- Write a record for a decision that outlives the change that prompted it: a rule contributors must follow, a design principle, a policy. Not for an implementation note, a refactor or a bug fix. When in doubt, ask in the issue.
- An accepted record is binding. Read the index in `docs/decisions/README.md` first; the `applies-to` column says which paths each one covers.
- If your task conflicts with an accepted record, stop and say so in the issue or pull request. Do not override it or work around it.
- A pull request that changes a decided behaviour adds a new record or supersedes the old one, in the same pull request.
- These records are the Concierge's own and are not delivered. A deployment writes its own records in its own `docs/decisions/`, which the gates read.

## 2. Write it

```console
ls docs/decisions                                   # the highest number is the last record
cp docs/decisions/template.md docs/decisions/NNNN-short-title.md
```

- **File name:** `NNNN-short-title.md`, four digits, the next number (counted up from `0001`, never reused, no gaps), lowercase words joined by hyphens.
- **Front matter:** `status` (`proposed`, `accepted`, `rejected`, `deprecated` or `superseded by NNNN`), `date` (the day the status last changed, `YYYY-MM-DD`), `decision-makers` (roles such as `maintainers`, never private data), optionally `applies-to` (a list of path globs the decision binds) and `issues` (`owner/repo#number`). No other keys.
- **Body:** a title and the sections `Context and problem statement`, `Decision`, `Consequences`, and optionally `Known deviations` and `Alternatives considered`, in that order and no others.
- **Decision as rules**, in plain language: what is allowed, what is not, and the one or two exceptions. A reviewer must be able to check it.
- ****Write what stays true.** A decision outlives the code around it, and an accepted record is not edited when a number moves, so a record that states a changing value is wrong sooner or later. State the rule, not the value: "budgets follow measured runs, e.g. 8 credits for one gate", not "the budget is currently 8 credits". Avoid "currently", "now", "today", "the latest" and any current version, count, size, budget or line number. Say "e.g." or "for example" when an example helps. When a fact is part of why you decided, put it in the context with its date ("when this was decided, on 2026-10-24, the pin was ..."): a dated fact is a measurement and stays true. For a value that changes, name where it lives (the file, the command, the test) instead of copying it. Before you finish, read each sentence and ask whether it could become false while the decision stands. If so, reword it or date it.
- **Keep it short:** at most 60 lines. Say what must be kept in sync (tests, docs) under `Consequences`.
- **Status:** `accepted` is for a decision the maintainers have made. If nobody with that authority has decided it yet, write the record as `proposed` and say so in the pull request.

## 3. Add it to the index

Add a row to the table under "Index" in `docs/decisions/README.md`: the number linked to the file, the title exactly as in the record, and the status exactly as in the record.

## 4. Screen it for sensitive content

The repository is public, and so is everything in a record, its history and its pull request.

- No secrets, keys, tokens, passwords, customer or tenant names, private URLs, e-mail addresses, or names of people. Roles instead.
- No details of a security weakness, an incident or an unfixed bug. Say it in general terms at most, or leave it out and ask a maintainer how to record it.

Write the pull request description the same way, and check it before you publish it: an edit history keeps earlier revisions of a description.

## 5. Supersede or deprecate

- Accepted records are not edited, except for a typo and for a `Known deviations` section, a status note that may be added, edited or removed in the pull request that fixes the deviation or opens its tracking issue. If an accepted record already states a changing fact as permanent, do not edit it yourself: tell a maintainer, who decides whether it is a wording fix or needs a new record.
- To change a decision, write a new record that says which one it replaces, and set the old record's status to `superseded by NNNN` (its only other edit). Update both index rows.

## 6. Run the validator

```console
node tools/validate-decision-records.mjs
```

It checks the file names and numbering, the front matter keys and statuses, the section order, the 60-line limit, credentials and e-mail addresses, and that every record has an index row with the right status. It cannot judge what a decision says: that is for the reviewer.

## Stop and ask when

- your task conflicts with an accepted record;
- you are not sure the decision is the maintainers' to make;
- the record would need private or sensitive detail to make sense.
