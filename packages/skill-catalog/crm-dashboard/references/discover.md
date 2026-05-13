# Fetch CRM dashboard data

Fetch only the CRM records and field coverage needed to build the requested dashboard. This phase is a data collection step, not a written analysis report.

Use the narrowest available source query for the requested organization, pipeline, account set, or segment. Prefer one schema/field lookup plus one bounded records query. Do not run broad workspace searches when a connected CRM/spreadsheet source can answer the request.

Return compact JSON or short structured text under 2,000 characters with:

- Source ids/names and record counts used.
- Relevant field coverage for account, opportunity, owner, stage, amount, close date, last activity, and risk/notes.
- A bounded `CrmDashboardData` draft: `snapshot`, `kpis`, `stageExposure`, `staleActivity`, `topRisks`, `opportunities`, and `refreshNote`.
- Missing or unavailable sources as short strings, not long caveat sections.

Do not include full tables, raw records, markdown reports, or multi-page evidence registers. If data is partial, build the best bounded dataset and label the coverage in `refreshNote`.
