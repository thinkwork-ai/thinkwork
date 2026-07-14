# McPherson `thinkwork_warehouse / raw_jde` schema-scoped registration runbook (THINK-283)

Operator checklist for the production step that motivated THINK-283:
registering McPherson's `raw_jde` schema as an Analyst data source **without
a `public` proxy view and without exposing `platform`**. Execute against the
McPherson stage only after the THINK-283 units (U1–U7 + UI) are deployed
there. Do NOT create test objects in McPherson's warehouse — prove
add/remove refresh semantics in a controlled dev database first.

## Register

1. Sign in to the McPherson web app as a tenant owner/admin →
   Settings → MCP Servers → Register data source → **Internal**.
2. Select the warehouse cluster → database `thinkwork_warehouse`.
3. The schema list should show `raw_jde` and `platform` with live table
   counts and `public` as "(no eligible tables)" (disabled, explained).
4. Select `raw_jde`, accept/adjust the name + slug, register. The
   confirmation reports the modeled table count.

## Verify (each item must pass)

- **Model/docs are qualified**: the source's `SCHEMA.md`
  (`tenants/mcpherson/analyst-sources/<slug>/SCHEMA.md` in the workspace
  bucket) names tables as `raw_jde.<table>`, never bare names.
- **Broker can query**: ask the agent a question against a known `raw_jde`
  table; the query executes and audits normally.
- **Isolation is enforced in the database**, not instructions — as the
  provisioned reader role:
  ```sql
  SELECT * FROM platform.mirror_batch LIMIT 1;   -- must fail: permission denied
  ```
- **No future-object default ACL** exists for the reader (repairs any
  pre-THINK-283 attempt):
  ```sql
  SELECT * FROM pg_default_acl d
    JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE pg_get_userbyid(d.defaclrole) IS NOT NULL
     AND array_to_string(d.defaclacl, ',') LIKE '%<reader_role>%';
  -- must return 0 rows for the reader role
  ```
- **Source health is OK**: the detail page shows no withhold; the scheduled
  reconciler stamps an `ok` probe within its 30-minute cadence.

## Refresh contract (for McPherson's DBA + operators)

- New tables in `raw_jde` are NOT readable until an operator runs
  **Refresh source** on the source's detail page. Supported sequence for
  external-style changes: make the schema change, then refresh immediately.
- During refresh the source is withheld; a failed refresh stays visibly
  withheld with the failing step and is safe to retry (no credential
  rotation, no artifact cleanup).

## Rollback

Disable the source (detail page → Enabled off) to withdraw it from the agent
without deleting the registration. Deleting the row removes the connector;
the provisioned reader role and secret can then be cleaned up by a DBA if the
registration will not be retried.
