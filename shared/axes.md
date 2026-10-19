---
# Shared definitions for the two independent axes.
# Import into prompts or use as a reference.
---

# Complexity and Risk Axes

Complexity and risk are assessed separately.

## Complexity (design impact / autonomy)

### complexity/low
- Mechanical or trivial design impact
- Narrow scope (typically one to three files)
- High autonomy is acceptable

### complexity/medium
- Some design decisions required but the space is bounded
- Moderate autonomy; human review of the resulting change is expected

### complexity/high
- Architectural, cross-cutting, or poorly specified
- Significant design impact
- Design discussion and the `design-approved` label are required before an agent may be assigned

## Risk (blast radius)

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

Repositories may adjust the exact thresholds and the routing matrix while keeping the two axes independent.
