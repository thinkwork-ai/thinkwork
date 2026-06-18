# SendGrid Plugin

The SendGrid plugin is the package-owned source boundary for SendGrid-backed
tenant invitation email. It declares SendGrid as a standalone email provider so
operators can install and inspect it from Settings -> Plugins instead of finding
SendGrid hidden inside the Resend channel package.

Shared platform code owns credential storage, authenticated-domain discovery,
readiness checks, provider selection, and invitation delivery. This package owns
the catalog identity and provider capability contract.

## Owned Source

- `src/manifest.ts` declares the catalog manifest and email-channel capability.
- `src/provider-contract.ts` holds SendGrid provider metadata and the shared
  settings surface identity.
- `test/manifest.test.ts` validates provider scope, settings surface, and
  package descriptor boundaries.

## Verification Notes

Package-local verification:

```bash
pnpm --filter @thinkwork/plugin-sendgrid test
pnpm --filter @thinkwork/plugin-sendgrid typecheck
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
node scripts/verify-plugin-source-boundary.mjs
```
