# Related repositories

```yaml
this: {{this}}

related:
  - role: library
    repo: {{other}}
    secret: {{secret}}
    when: |
      When the report is about a result that is wrong or missing, such as the order or the content of a list of nodes or widgets.

notes: |
  The app owns the command line: reading files, arguments, printing, exit codes and error messages.
  The library owns every function that computes a result: the tree walk and the widget list.
  When in doubt, keep the issue here. See AGENTS.md of each repository for the layering.
```
