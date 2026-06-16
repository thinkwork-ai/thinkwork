# Company Brain Plugin

Company Brain is a first-party premium application plugin package for the
THNK-31 `plugins/<plugin-key>/` source boundary. Company Brain is the
customer-facing product; Cognee is the internal Brain substrate adapter and
should appear only in deployment evidence, logs, Terraform/runtime paths, or
implementation notes.

## Package Contract

- `package.json` exposes `@thinkwork/plugin-company-brain`.
- `src/index.ts` exports `companyBrainPluginPackage` with owned source
  descriptors and compatibility links.
- `src/manifest.ts` owns the Company Brain catalog manifest.
- `smoke/` owns Company Brain entitlement, operations, context engine, and
  internal substrate smoke scripts.
- `test/manifest.test.ts` keeps Company Brain premium entitlement,
  infrastructure, and customer-facing copy contracts aligned.

## Temporary Compatibility Links

The package descriptor documents the legacy Company Brain paths that still
contain plugin-specific source:

- `packages/deployment-runner/src/apps/cognee.ts` until THNK-31 U3 moves the
  internal substrate managed-app adapter into
  `plugins/company-brain/src/deployment/`.
- `terraform/modules/app/cognee` until THNK-31 U4 moves Terraform source into
  `plugins/company-brain/terraform/cognee/`.
- `packages/cognee/Dockerfile` until THNK-31 U4 moves runtime source into
  `plugins/company-brain/runtime/cognee/`.
- `apps/web/src/components/settings/SettingsCogneeApplication.tsx` until
  THNK-31 U5 renders Company Brain-owned UI from plugin detail.
- `packages/api/src/lib/company-brain`,
  `packages/api/src/lib/context-engine/providers/company-brain.ts`, and
  `packages/api/src/lib/knowledge-graph/cognee-client.ts` until THNK-31 U6
  moves plugin-specific API/runtime helpers behind package exports.

These links are migration debt, not shared platform ownership.

## Verification

```bash
pnpm --filter @thinkwork/plugin-company-brain test
pnpm --filter @thinkwork/plugin-company-brain typecheck
```
