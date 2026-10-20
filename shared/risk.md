---
# Shared definition for the risk axis.
# Import into prompts or use as a reference.
---

# Risk Axis (blast radius)

Risk measures the potential impact of a change if it is incorrect. Higher risk tightens constraints on what may be changed automatically and requires stronger review gates.

### risk/low
- Limited blast radius
- Examples: documentation, tests, pure internal refactors with strong existing coverage

### risk/medium
- Ordinary code changes
- Normal review expectations

### risk/high
- Touches security, authentication, authorization, data integrity, availability, or public API surface
- Tighter path and change constraints
- Human review is always required
- Auto-merge is not appropriate

Repositories may adjust the exact thresholds while keeping risk independent of complexity.
