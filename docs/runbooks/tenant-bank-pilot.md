# Tenant Bank pilot — operator runbook (THINK-261 / company-brain plan U11)

The Tenant Bank (`tenant_<tenantId>`) is the company-scope memory bank. Every
tenant member's agent recalls it on every turn (labeled `[company]`); content
enters only through Governed Promotion. This runbook covers operating the
pilot: promoting, inspecting, retracting, and measuring.

## Promote

```bash
# Source memory ids come from the space memory inspector or SQL.
thinkwork memory promote -s dev -t <tenant-slug> \
  --space <space-uuid> \
  --ids <unit-uuid>,<unit-uuid>,... \
  --justification "why this is company knowledge"
```

- Requires the tenant owner/admin role AND read access to the source space
  (KTD-8 — both checked server-side; the call is audited to `activity_log`
  with actor + justification).
- Idempotent per source memory: re-running reports `alreadyPromoted` instead
  of duplicating.
- The copy is verbatim (embedding included) with original timestamps; the
  source rows stay in the space bank.

## Inspect (provenance in one step)

```bash
thinkwork memory bank -s dev -t <tenant-slug> --limit 100
```

Lists every Tenant Bank unit with `sourceBankId`, `sourceMemoryId`,
`promotedBy/At`, justification, and `access_count` (the consumption signal).
GraphQL equivalent: `tenantBankMemories(tenantId, limit)`.

## Retract (verify-then-delete)

Hindsight has no per-memory delete API; retraction is a scoped SQL delete on
the dedicated `thinkwork_hindsight` database. **Never delete by bare id** —
verify the row is one of this tenant's promoted copies first (mirrors
`deleteMobileMemoryCapture`'s inspect-then-verify pattern):

```sql
-- 1. Verify: must return exactly the row you mean to retract, with the
--    provenance keys present.
SELECT id, bank_id, left(text, 80), metadata->>'sourceBankId' AS src
FROM memory_units
WHERE id = '<unit-uuid>'
  AND bank_id = 'tenant_<tenantId>'
  AND metadata->>'sourceMemoryId' IS NOT NULL;

-- 2. Delete the promoted copy (the space-bank source is untouched).
DELETE FROM memory_units
WHERE id = '<unit-uuid>'
  AND bank_id = 'tenant_<tenantId>'
  AND metadata->>'sourceMemoryId' IS NOT NULL;
```

Then reconcile the derived layer so observations/mental models rebuild
without the retracted evidence:

```bash
aws lambda invoke --function-name thinkwork-<stage>-api-brain-dream-state \
  --payload '{"manual": true, "bankId": "tenant_<tenantId>"}' /tmp/out.json
```

## Measure (R11 — consumption, not storage)

Raw `access_count` deltas alone cannot pass the pilot: recall fan-out
inflates surfacing by construction. Pair both signals:

1. **access_count deltas** — `thinkwork memory bank` (or SQL) at the start
   and end of the pilot window; record per-unit deltas for tenant-bank units
   and space-bank units.
2. **Sampled transcripts** — collect N real turns where a `[team: …]` or
   `[company]` memory demonstrably shaped the response (the agent used or
   cited it, not merely received it).
3. **The live scenario** (plan Success Criteria): one thread where the agent
   recalls a space-bank memory and a tenant-bank memory and distinguishes the
   two scopes in its answer.

## Standing probes (spike caveats)

- Watch `consolidation_failed_at` on tenant-bank units (upstream #2453) and
  mental-model content length across refreshes (upstream #2501).
- Mental models on the Tenant Bank: set `refresh_after_consolidation: true`
  (the demonstrated trigger); validate cron triggers via the vendor HTTP API
  from inside the VPC before relying on them.
- First in-VPC opportunity: smoke-test mental-model creation through the
  HTTP API (`/v1/default/banks/tenant_<id>/mental-models`) — the spike
  created models via SQL, so the API-create path is still unexercised.
