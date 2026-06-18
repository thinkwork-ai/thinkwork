# Resend Channel Plugin

The Resend Channel plugin is the package-owned source boundary for the
Resend-backed tenant-owned agent and Space email channel. V1 recommends Resend
for new tenant-owned email channels and keeps SES as the AWS-native
compatibility provider while shared platform code owns installation, settings
GraphQL, database state, provider execution, and runtime gates.

SendGrid is intentionally represented by its own `@thinkwork/plugin-sendgrid`
package so operators see it as a separate installable provider in the plugin
catalog.

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
- SendGrid, SMTP, Postmark, Mailgun, and other providers are separate or
  deferred packages.

## Verification Notes

Package-local verification:

```bash
pnpm --filter @thinkwork/plugin-email-channel test
pnpm --filter @thinkwork/plugin-email-channel typecheck
pnpm --filter @thinkwork/plugin-catalog test
pnpm --filter @thinkwork/plugin-catalog typecheck
node scripts/verify-plugin-source-boundary.mjs
```
