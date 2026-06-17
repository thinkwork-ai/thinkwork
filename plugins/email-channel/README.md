# Resend Channel Plugin

The Resend Channel plugin is the package-owned source boundary for
tenant-owned agent and Space email. V1 is Resend-backed by default and keeps SES
as the AWS-native compatibility provider while shared platform code owns
installation, settings GraphQL, database state, provider execution, and runtime
gates.

This package is intentionally inert in U1. It publishes the catalog identity,
provider declarations, and reserved settings surface that later units wire into
email-channel schema, provider adapters, readiness checks, first-send approval,
inbound authorization, and ledger evidence.

## Owned Source

- `src/manifest.ts` declares the catalog manifest and email-channel capability.
- `src/provider-contract.ts` holds provider keys and channel contract metadata
  that package-local tests and shared platform code can import without reaching
  into the manifest shape.
- `test/manifest.test.ts` validates provider scope, settings surface, and
  package descriptor boundaries.

## Provider Scope

V1 provider options are deliberately narrow:

- Resend is recommended for new tenant-owned email channels.
- SES remains the AWS-native compatibility and migration provider.
- SMTP, Postmark, Mailgun, and other providers are deferred.

## Verification Notes

Package-local verification:

```bash
pnpm --filter @thinkwork/plugin-email-channel test
pnpm --filter @thinkwork/plugin-email-channel typecheck
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
node scripts/verify-plugin-source-boundary.mjs
```
