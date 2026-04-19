# Compounding Memory Visuals

Simple diagrams for explaining the architecture before implementation planning.

## 1. Raw history -> warehouse -> compiled pages

```mermaid
flowchart LR
    A[Raw history<br/>threads, messages, tools, artifacts] --> B[Normalized warehouse<br/>Hindsight-backed in v1]
    B --> C[Compiled pages<br/>Aurora-primary]
    C --> D[Agent reads + product surfaces]
    C --> E[Markdown export]
```

### Plain-English takeaway
- Raw history is the source stream.
- The warehouse is the canonical retained memory layer.
- Compiled pages are downstream, readable, and rebuildable.

## 2. 7 warehouse record types vs 3 compiled page types

```mermaid
flowchart LR
    subgraph W[Warehouse record types]
        W1[EventFact]
        W2[PreferenceOrConstraint]
        W3[Experience]
        W4[Observation]
        W5[EntityProfileFragment]
        W6[DecisionRecord]
        W7[UnresolvedMention]
    end

    subgraph P[Compiled page types]
        P1[Entity page]
        P2[Topic page]
        P3[Decision page]
    end

    W --> P
```

### Plain-English takeaway
- The warehouse stores durable ingredients.
- The compiled layer stores a smaller set of readable outputs.
- `Topic` is a compiled page type, not a warehouse record type.

## 3. Unresolved mention -> page lifecycle

```mermaid
flowchart TD
    A[New mention or fragment] --> B{Strong enough now?}
    B -- No --> C[Unresolved mention]
    C --> D{More evidence arrives?}
    D -- Not yet --> C
    D -- Yes --> E{Best target?}
    B -- Yes --> E
    E -- Existing page --> F[Update page]
    E -- New durable subject --> G[Create page]
    G --> H[Compiled page]
    F --> H
    H --> I[Rebuildable downstream output]
```

### Plain-English takeaway
- The middle state matters.
- Weak signal should not be dropped, and it should not instantly become page spam.
- Updating should be easier than creating, and creating should be easier than promotion.

## Framing lines to pair with these visuals

- Raw history tells you what happened.
- The warehouse tells you what should be remembered.
- Compiled pages tell you what we know overall.
- Use Hindsight to help remember. Use ThinkWork to decide what that memory becomes.
