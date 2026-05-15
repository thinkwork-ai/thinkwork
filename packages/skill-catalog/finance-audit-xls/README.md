# finance-audit-xls

Lifted and adapted from [`anthropic/financial-services`](https://github.com/anthropics/financial-services) under Apache-2.0. See `LICENSE-NOTES.md` for upstream attribution.

Activate when the user uploads a financial model and asks the agent to audit, QA, sanity-check, review, or debug it. Produces a findings table (severity + cell reference + suggested fix) without modifying the source workbook.

Pairs with `finance-3-statement-model` (build the model) and `finance-statement-analysis` (interpret what the model says).
