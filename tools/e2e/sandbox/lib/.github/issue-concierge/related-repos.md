# Related repositories

```yaml
this: {{this}}

related:
  - role: app
    repo: {{other}}
    secret: {{secret}}
    when: |
      When the report is about a command, its arguments, how results are printed, its exit code or its error messages.

notes: |
  This library owns every function that computes a result: the tree walk and the widget list.
  The app owns the command line: reading files, arguments, printing, exit codes and error messages.
  When in doubt, keep the issue here. See AGENTS.md of each repository for the layering.
```
