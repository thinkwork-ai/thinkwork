---
module: packages/agentcore-pi
date: 2026-07-25
last_updated: 2026-07-25
category: architecture-patterns
problem_type: design_pattern
component: knowledge_base
severity: medium
related_components:
  - bedrock
  - retrieval
  - agent_runtime
applies_when:
  - "Retrieving from a Bedrock knowledge base over a corpus of near-identical documents (SOPs, runbooks, policies)"
  - "The answer to a question lives in a short document competing against long ones on the same topic"
  - "Evaluating whether a retrieval change helped, using presence of the right document as the metric"
  - "A knowledge base has been rebuilt and the content is verifiably correct but answers are still wrong"
tags:
  - bedrock
  - retrieval
  - hybrid-search
  - semantic-search
  - ranking
  - evaluation
---

# Rank, not presence, is the retrieval metric on SOP corpora

## Context

McPherson's CX knowledge base is 80 standard operating procedures that all
discuss overlapping subject matter — a dozen documents mention "credit and
rebill." After page-level transcription made every document's content
retrievable, the canonical test question still produced a materially wrong
answer.

The content was present. The **ranking** was the problem, and presence-based
checks could not see it.

## The failure

Pure semantic retrieval ranked the one-page document that actually answers
"how do I set up a new reason code" **8th out of 8** — the last slot in the
tool's retrieval window (`MAX_RESULTS_PER_KB = 8`).

It squeaked in, so the answer happened to be right. One rephrasing would have
pushed it out and restored the wrong answer, with nothing in the system
indicating a regression.

This is structural, not specific to one document. Embedding distance rewards
documents that _discuss_ a topic at length over the short, terse page that
_answers_ it. In a corpus where the distinguishing signal is a literal
identifier — a code, a form number, a screen name — semantic similarity is
close to blind to exactly the token that matters.

## The fix

Set `overrideSearchType: "HYBRID"` on the retrieval configuration in
`packages/agentcore-pi/agent-container/src/tools/knowledge.ts`. Hybrid combines
semantic similarity with keyword matching, so literal identifiers count.

Measured on the live knowledge base (Aurora pgvector, 760 page documents):

| Query                                                        | Semantic                           | Hybrid     |
| ------------------------------------------------------------ | ---------------------------------- | ---------- |
| "how do I set up a new reason code for a credit and rebill?" | rank **8**                         | rank **1** |
| "where do I add a new reason code in the list?"              | rank **8**                         | rank **1** |
| "setting up a new reason code"                               | rank **8**                         | rank **1** |
| "how do I create the credit and rebill report?"              | **wrong document first**           | correct    |
| "what are the credit and rebill reason codes?"               | correct doc **missing from top 3** | rank **1** |

Hybrid matched or beat semantic on every query tested. The last two rows are
the important ones: they are outright correctness bugs that were **not** being
looked for — they surfaced only because the comparison ran a spread of
queries rather than the single failing one.

### No fallback path is needed

`packages/api/knowledge-base-manager.ts` hardcodes `type: "RDS"`, so every
knowledge base the platform creates is Aurora pgvector, which supports HYBRID.
There is no store variant that can reject it. Confirm this is still true before
assuming it.

## The transferable lesson

**"Did the right document come back?" is the wrong question. Ask "at what
rank, and how much margin is there?"**

A document sitting at the edge of the retrieval window passes every
presence-based test and fails in production the moment phrasing shifts. When
verifying a retrieval change:

1. Assert on **rank**, not membership.
2. Run **several phrasings** of the same question — a stable answer across
   rephrasings is the actual property you want.
3. Run **unrelated queries** as a regression check. The two correctness bugs
   above were found this way.
4. Treat a correct answer retrieved at the window's edge as a **latent
   failure**, not a pass.

## Related

- `packages/agentcore-pi/agent-container/src/tools/knowledge.ts` — retrieval config
- [Bedrock KB custom ingestion silent failures](../integration-issues/bedrock-kb-custom-ingestion-silent-failures-2026-07-25.md)
- PR #4100
