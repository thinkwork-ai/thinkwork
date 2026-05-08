# Changelog

Each row is a merged PR and the capability it shipped. Append a row when shipping new compliance work.

| PR | Date merged | Unit | Capability | Deploy to dev | Deploy to prod |
|----|-------------|------|-----------|---------------|----------------|
| [#880](https://github.com/thinkwork-ai/thinkwork/pull/880) | 2026-05-07 | U1 | `compliance.*` schema (`audit_outbox`, `audit_events`, `actor_pseudonym`, `export_jobs`) + immutability triggers (DELETE/TRUNCATE blocked) | (next deploy) | (pending prod deploy) |
| [#887](https://github.com/thinkwork-ai/thinkwork/pull/887) | 2026-05-07 | U2 | Aurora roles (`compliance_writer`/`compliance_drainer`/`compliance_reader`) + Secrets Manager containers + GRANT migration | (next deploy) | (pending prod deploy) |
| [#890](https://github.com/thinkwork-ai/thinkwork/pull/890) | 2026-05-07 | U3 | `emitAuditEvent` helper (`packages/api/src/lib/compliance/emit.ts`) + per-event-type redaction allow-list | (next deploy) | (pending prod deploy) |
| [#893](https://github.com/thinkwork-ai/thinkwork/pull/893) | 2026-05-07 | U4 | Outbox drainer Lambda (single-writer, reserved-concurrency=1) computing per-tenant SHA-256 chain | (next deploy) | (pending prod deploy) |
| [#895](https://github.com/thinkwork-ai/thinkwork/pull/895) | 2026-05-07 | U2 fix | Unblock compliance role bootstrap | (next deploy) | (pending prod deploy) |
| [#903](https://github.com/thinkwork-ai/thinkwork/pull/903) | 2026-05-07 | U5 | Wired `emitAuditEvent` at the 9 SOC2 starter-slate call sites (auth, agent CRUD, user CRUD, MCP, workspace governance, data export) | (next deploy) | (pending prod deploy) |
| [#905](https://github.com/thinkwork-ai/thinkwork/pull/905) | 2026-05-07 | infra | Temporarily disabled the post-deploy migration drift gate (re-enable when stable) | (next deploy) | (pending prod deploy) |
| [#911](https://github.com/thinkwork-ai/thinkwork/pull/911) | 2026-05-07 | U6 | Strands runtime audit emit path (Python `ComplianceClient` + REST `POST /api/compliance/events` + idempotency on UUIDv7 event_id) | (next deploy) | (pending prod deploy) |
| [#917](https://github.com/thinkwork-ai/thinkwork/pull/917) | 2026-05-07 | U7 | S3 Object Lock anchor bucket Terraform module + IAM role (inert until U8a) | (next deploy) | (pending prod deploy) |
| [#921](https://github.com/thinkwork-ai/thinkwork/pull/921) | 2026-05-07 | U8a | Anchor Lambda inert + EventBridge Scheduler (`rate(15 minutes)`) + watchdog Lambda + alarm | (next deploy) | (pending prod deploy) |
| [#925](https://github.com/thinkwork-ai/thinkwork/pull/925) | 2026-05-07 | U8a fix | Normalize anchor timestamps | (next deploy) | (pending prod deploy) |
| [#927](https://github.com/thinkwork-ai/thinkwork/pull/927) | 2026-05-07 | U8b | Anchor Lambda live: real S3 PutObject with Object Lock retention | (next deploy) | (pending prod deploy) |
| [#932](https://github.com/thinkwork-ai/thinkwork/pull/932) | 2026-05-08 | U9 | Standalone `audit-verifier` CLI: Merkle verification + retention check + per-tenant chain walk | (next deploy) | (pending prod deploy) |
| [#937](https://github.com/thinkwork-ai/thinkwork/pull/937) | 2026-05-08 | U10 | GraphQL read API + reader role + auth scoping (`requireComplianceReader`) | (next deploy) | (pending prod deploy) |
| [#939](https://github.com/thinkwork-ai/thinkwork/pull/939) | 2026-05-08 | U10 | Frontend backend extensions: `complianceOperatorCheck`, `complianceTenants`, format guard on `complianceEventByHash` | (next deploy) | (pending prod deploy) |
| [#941](https://github.com/thinkwork-ai/thinkwork/pull/941) | 2026-05-08 | U10 | Admin Compliance SPA: list, detail, walk-back, cross-tenant toggle, URL-cursor pagination | (next deploy) | (pending prod deploy) |
| [#942](https://github.com/thinkwork-ai/thinkwork/pull/942) | 2026-05-08 | UX | Move Compliance above Billing in admin sidebar | (next deploy) | (pending prod deploy) |
| [#944](https://github.com/thinkwork-ai/thinkwork/pull/944) | 2026-05-08 | U11 | `createComplianceExport` mutation + `complianceExports` query + 10/hour rate limit + 90-day filter cap | (next deploy) | (pending prod deploy) |
| [#948](https://github.com/thinkwork-ai/thinkwork/pull/948) | 2026-05-08 | U11.U2 | Terraform: `compliance-exports-bucket` (7-day lifecycle, no Object Lock) + SQS queue + DLQ + alarm + standalone runner Lambda (inert stub) | (next deploy) | (pending prod deploy) |
| [#950](https://github.com/thinkwork-ai/thinkwork/pull/950) | 2026-05-08 | U11.U3 | Live runner Lambda body: `pg.Cursor` stream + RFC 4180 CSV / NDJSON writers + S3 multipart upload + 15-min presigned URL | (next deploy) | (pending prod deploy) |
| [#951](https://github.com/thinkwork-ai/thinkwork/pull/951) | 2026-05-08 | U11.U4 | Admin Exports page: request dialog + status table + 3s polling + Download/Re-export | (next deploy) | (pending prod deploy) |

## Notes

- "Deploy to dev" populates after the first dev deploy that includes each PR.
- "Deploy to prod" populates post-prod-launch (the master arc has not yet shipped to a production tenant).
- A small number of fixes that touch compliance code but were not part of the master arc roster (e.g., #895, #925) are included for traceability.
