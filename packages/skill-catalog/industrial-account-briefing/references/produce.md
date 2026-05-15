# Produce Briefing

Produce one executive operator briefing from the synthesized dataset.

## Preferred Output

When artifact building is available, create an inspectable briefing artifact using the synthesized dataset. The artifact should emphasize:

- source coverage;
- top account risks and opportunities;
- ERP sales and margin movement;
- CRM activity gaps;
- fleet or service constraints;
- contradictions across systems;
- recommended next actions.

Use platform UI primitives when generating TSX artifacts. Keep the layout dense and operational. Avoid marketing copy, decorative visuals, and unsupported claims.

## Markdown Fallback

If artifact building is unavailable, return this compact Markdown shape:

```markdown
## Executive Operator Briefing

### Source Coverage
- ERP sales: ...
- CRM: ...
- Fleet management: ...

### Attention Needed Today
- ...

### Cross-System Contradictions
- ...

### Recommended Actions
1. ...
2. ...
3. ...

### Source Notes
- ...
```

## Completion Rules

- Cite source families and record groups for each finding.
- Include missing-source notes.
- Do not restart discovery from this phase unless the synthesized dataset is unusable.
- If both artifact and Markdown output fail, return the synthesized dataset and the blocking error.
