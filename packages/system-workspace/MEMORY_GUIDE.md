# Memory System

You have persistent long-term memory that spans all conversations. AgentCore managed memory is **always on** — the platform automatically retains every turn into long-term memory in the background. You do NOT need to call `remember()` for routine facts. The managed memory tools (`remember`, `recall`, `forget`) are always available. When Hindsight is enabled as an add-on, you also get `hindsight_retain`, `hindsight_recall`, and `hindsight_reflect` for advanced semantic + graph retrieval.

## Automatic retention (always on)

After every turn, the platform emits a `CreateEvent` containing both the user message and your response into AgentCore Memory. Background strategies extract facts into four namespaces:

- **semantic** — facts about the user, their projects, and their context
- **preferences** — user-stated preferences and standing instructions
- **summaries** — rolling session summaries
- **episodes** — remembered events and prior interactions

You never need to trigger this — it happens automatically after your turn completes. Assume the facts you learn in one conversation will be available via `recall()` in future conversations within a minute or two (strategy processing has a small delay).

## Managed memory tools (always available)

- **remember(fact, category)** — Store an explicit memory when the user *specifically asks you to remember something* ("please remember that my office is closed on Fridays"). Also usable for important durable facts you want immediately searchable before the background strategies catch up. Categories: `preference`, `context`, `instruction`, or `general`. Do NOT call this on every turn — the automatic retention already handles that.
- **recall(query, scope, strategy)** — Search long-term memory.
  - `scope`: `memory` (default, your memory only), `all` (memory + knowledge bases + knowledge graph), `knowledge` (knowledge bases only), `graph` (knowledge graph entities only).
  - `strategy`: optional filter — `semantic`, `preferences`, `episodes`, or empty for all.
- **forget(query)** — Archive a memory by searching for it semantically. Archived memories are permanently deleted after 30 days.

## Hindsight add-on tools (when enabled)

When your deployment has `enable_hindsight = true`, you ALSO have these tools alongside the managed ones:

- **hindsight_retain(content)** — Store important facts, preferences, or instructions to Hindsight. Hindsight extracts entities and relationships automatically, so write complete natural-language sentences rather than terse labels. The `remember()` tool dual-writes to both backends, so you only need to call `hindsight_retain` directly when you want Hindsight-only storage.
- **hindsight_recall(query)** — Search Hindsight memory using multi-strategy retrieval (semantic + BM25 + entity graph + temporal) with cross-encoder reranking. Use this for factual questions about people, companies, and projects — often returns richer results than `recall()` alone.
- **hindsight_reflect(query)** — Synthesize a reasoned answer from many stored memories at once. More expensive than `hindsight_recall` — prefer recall for simple lookups, reflect for narrative synthesis across many facts.

## Knowledge Bases

Knowledge-base documents (if any are attached to your agent) are retrieved automatically into your context. You do not need a separate tool call to search them. You can also use `recall(query, scope="knowledge")` to search them explicitly.

## When to call remember() explicitly

Automatic retention handles most of this for you. Only call `remember()` when:

- The user literally asks you to remember something ("remember that..." / "please note...")
- A critical fact came up that you want searchable immediately (before strategy processing catches up — usually unnecessary)

**Do NOT call remember() to journal every turn** — that is already happening automatically and would create duplicate records.

## When to Recall

- At the start of a new topic to check for relevant context
- When the user references something from a past conversation ("remember when...")
- Before making assumptions — check if you already know the user's preference
- When a task would benefit from historical context

## Guidelines

- Be concise in what you store — save the insight, not the full conversation
- Recall before storing when you're not sure whether something is already known
- Prefer complete sentences over fragments for better retrieval quality
- Tags are applied automatically (agent, tenant, env) — you do not need to pass them
