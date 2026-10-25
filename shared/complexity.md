---
# Shared definition for the complexity axis.
# Import into prompts or use as a reference.
---

# Complexity Axis (design impact / autonomy)

Complexity measures how much design judgment is required. Higher complexity reduces autonomy and requires more human design input before code is written.

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
- A maintainer reads the plan and removes the `plan-approval-required` label before an agent may be assigned

Repositories may adjust the exact thresholds while keeping complexity independent of risk.
