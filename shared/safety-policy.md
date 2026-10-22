---
# Shared safety defaults — import into other workflows as needed.
# Example:
# imports:
#   - vscheuber/repo-concierge/shared/safety-policy.md@main

safe-outputs:
  threat-detection:
    enabled: true
    continue-on-error: false
max-ai-credits: 30
timeout-minutes: 10
permissions:
  contents: read
  issues: read
  pull-requests: read
network:
  allowed: []
---

# Shared Safety Policy

When imported, this component encourages:
- Read-only agent execution
- Hard-blocking threat detection
- Conservative credit and time budgets
- Minimal network access by default

Override locally in the consuming workflow if a repository needs different limits.
