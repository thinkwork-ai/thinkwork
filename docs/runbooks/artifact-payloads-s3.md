# Artifact payloads in S3

Artifact rows in Aurora are metadata and indexes. Large payloads live in the
workspace S3 bucket, addressed by `s3_key`.

## Payload locations

- Durable artifact content:
  `tenants/<tenantId>/artifact-payloads/artifacts/<artifactId>/content.md`
- Message artifact content:
  `tenants/<tenantId>/artifact-payloads/message-artifacts/<messageArtifactId>/content`
- Applet state JSON:
  `tenants/<tenantId>/applets/<appId>/state/<instanceHash>/<keyHash>.json`

Applet source already uses the applet S3 path and continues to use
`artifacts.s3_key` for source. Do not hydrate applet source through the generic
artifact content path.

## Rollout

1. Deploy the API and runtime changes.
2. Verify all active API/read deployments include S3 hydration for artifacts,
   message artifacts, and applet state. Do not run write traffic or backfill
   against a version that can still be rolled back to DB-only artifact readers.
   After any S3-backed write lands, rollback must stay at or above this reader
   version unless you first restore payloads from S3 to the DB columns.
3. Run a dry run:

   ```bash
   pnpm artifact-payloads:backfill
   ```

4. Run the write pass in bounded batches:

   ```bash
   pnpm artifact-payloads:backfill -- --write --limit=500
   ```

5. Repeat until the counters return zero.

The backfill only mutates rows after the corresponding S3 write succeeds. It is
safe to rerun because rows with existing `s3_key` values are skipped.

## Verification queries

```sql
select count(*)
from artifacts
where content is not null
  and s3_key is null
  and type not in ('applet', 'applet_state');

select count(*)
from artifacts
where type = 'applet_state'
  and s3_key is null
  and metadata ? 'value';

select count(*)
from message_artifacts
where content is not null
  and s3_key is null;
```

All three counts should be zero after the final write pass.
