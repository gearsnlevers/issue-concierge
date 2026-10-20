# Multi-Gate Design

Each stage is a gate. A worker agent produces an artifact and signals completion with a label. A separate triage agent reacts to that label, classifies the artifact, and signals the next gate with a hand-off label.

## Label convention

Worker completion signals use `<worker-name>-ready`.  
Triage hand-off signals use `<triage-name>-handoff`.

| Step | Label |
|------|-------|
| `issue-worker` finished | `issue-worker-ready` |
| `issue-triage` opens plan gate | `issue-triage-handoff` |
| `plan-worker` finished | `plan-worker-ready` |
| `plan-triage` opens PR gate | `plan-triage-handoff` |
| coding agent finished | `pr-worker-ready` |
| `pr-triage` finished | `pr-triage-handoff` |

Blocking labels use the form `<thing>-required`. Removing the label is the human signal to continue.

Two independent axes are applied by the triage agents:

- **Complexity** — design impact / autonomy
- **Risk** — blast radius

## Plan comment identity

The plan lives as a single comment on the issue.  
gh-aw injects a non-spoofable marker:

```html
<!-- gh-aw-workflow-id: plan-worker -->
```

`plan-triage` classifies only the comment that contains that marker.

## Human interaction

Reporter interaction stays in the issue phase.

The plan phase is a classification prerequisite. For high complexity it adds `plan-approval-required` and stops. A maintainer removes that label to resume; no new label needs to be chosen from a long list.

Maintainer interaction on the actual change happens in the PR phase.

## Gates

### 1. Issue gate
**Worker** → `issue-worker-ready`  
**Triage** → quality/priority labels + `issue-triage-handoff` when actionable.

### 2. Plan gate
**Worker** → rough plan + `plan-worker-ready`  
**Triage** → complexity and risk labels.  
If complexity is high, add `plan-approval-required` and do not emit `plan-triage-handoff` while the label is present.  
When the label is absent, emit `plan-triage-handoff`.

### 3. PR gate
**Worker** → assigns coding agent (triggered by `plan-triage-handoff`)  
**Triage** → re-evaluates against the diff, emits `pr-triage-handoff`.

### Environment agent
Optional. Any worker may invoke it if the consuming repository defines it.

### Merge
Branch protection and auto-merge rules act on the final labels.
