# Discover Source Coverage

Fetch only the ERP sales, CRM, and fleet-management evidence needed for the requested account or segment. This phase determines source coverage and field usefulness; it is not a written briefing.

## Required Source Families

Check each family and record coverage:

- **ERP sales:** customer/account identifiers, orders, invoices, revenue, margin, pricing, product/category, branch, territory, open receivables if available.
- **CRM:** account owner, contacts, opportunities, activities, notes, next steps, last touch, expected close, relationship status.
- **Fleet management:** vehicles/assets, utilization, availability, maintenance status, dispatch/load/service capacity, delivery or service exceptions, operating cost if available.

## Bounded Search Rules

- Prefer connected data sources or explicit workspace exports over broad text search.
- Search for the requested account or segment first, then expand only to nearby branch/territory context if needed.
- Stop after enough evidence exists to label each source family as `available`, `partial`, or `unavailable`.
- Preserve source identifiers and timestamps for citations.
- Do not fabricate source coverage. If fleet data is absent, mark fleet as unavailable and continue.

## Discovery Output

Return a compact working dataset with:

- requested account or segment;
- review window;
- source coverage by family;
- relevant records grouped by ERP, CRM, and fleet;
- obvious identifier mapping issues;
- missing fields that limit the briefing.
