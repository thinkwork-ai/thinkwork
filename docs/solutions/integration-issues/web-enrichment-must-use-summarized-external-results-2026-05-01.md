---
title: Web enrichment must use summarized external results
date: 2026-05-01
category: docs/solutions/integration-issues
module: Brain enrichment / Context Engine
problem_type: integration_issue
component: service_object
symptoms:
  - "Web Search was tenant-enabled but did not appear as a Context Engine adapter in Admin Sources."
  - "Mobile Brain enrichment review showed raw site chrome such as filters, prices, and back links as candidate content."
  - "Switching Exa to summaries initially timed out, producing no Web candidates."
  - "Thread review overemphasized run metadata and provider status above the actual enrichment candidates."
root_cause: wrong_api
resolution_type: code_fix
severity: medium
related_components:
  - "apps/mobile"
  - "apps/admin"
  - "packages/api"
  - "packages/react-native-sdk"
tags: [brain-enrichment, context-engine, web-search, exa, mobile, admin]
---

# Web enrichment must use summarized external results

## Problem

Brain page enrichment can combine internal Brain context with explicitly selected Web context. The first wired version proved that Web Search participated, but the actual review experience was poor: the Admin adapter was hard to find, Exa results carried scraped page chrome into candidate suggestions, and the mobile thread review spent scarce screen space on run details instead of reviewable updates.

This is an integration problem across Exa, Context Engine, GraphQL enrichment, Admin operator verification, and the native mobile review surface. A unit test that only proves hits exist is not enough.

## Symptoms

- Admin Sources did not show an obvious Web Search Context Engine adapter even though the tenant had the built-in configured.
- A mobile review candidate for Paris Opera rendered raw navigation/filter text like `# back`, `My special offers`, `By date`, `Prices`, `0`, `300`, `0€`, and `300€`.
- Requesting Exa summaries fixed content quality but exceeded the original timeout, causing `builtin:web-search` to return `state: error` and zero Web candidates.
- The thread review screen opened with title/path/reason/provider cards above the candidate list, making the actual review feel secondary.

## What Didn't Work

- Treating a successful Web provider status as sufficient. The adapter can be technically wired and still produce unusable enrichment.
- Using Exa `contents: { text: true }` and preferring `text`. That returns raw page text, which often includes navigation, filters, price sliders, and other page chrome.
- Switching to Exa summaries without adjusting timeouts. Summary generation is slower than raw search text and can be cut off by a short provider timeout.
- Verifying only through the inline implementation or Expo-shaped flows. The native thread review had different visual pressure and needed inspection in the iOS Simulator with `pnpm run ios`.

Session history showed this had already been framed in PR #724: Web enrichment should synthesize current public information into concise, cited candidate updates instead of dumping raw search rows. That requirement existed before implementation; the failure came from verifying participation before verifying candidate quality. (session history)

## Solution

Expose the Exa-backed provider as a real Context Engine adapter, but make the provider content and review UI match the product semantics.

Request Exa summaries rather than scraped text:

```ts
body: JSON.stringify({
  query: args.query,
  numResults: args.limit,
  contents: { summary: true },
}),
signal: AbortSignal.timeout(25_000),
```

Normalize Exa results by preferring `summary`, then `highlights`, then a cleaned raw-text fallback:

```ts
const snippet =
  stringValue(record.summary) ||
  stringValue(record.highlights) ||
  cleanSearchText(stringValue(record.text));
```

Label Exa-backed Web hits as external research rather than generic search:

```ts
function webSearchProviderLabel(provider: TenantWebSearchConfig["provider"]) {
  return provider === "exa" ? "Exa Research" : "Web Search";
}
```

Give the provider enough time for summary generation:

```ts
timeoutMs: 28_000,
```

In mobile review, suppress generic workspace-review header content for Brain enrichment, move provider statuses behind a `Review details` control, and keep the candidate list as the primary screen. The details dialog should be a solid, readable surface; transparent nested pressables can make the dialog visually blend with the candidate cards behind it.

## Why This Works

Exa search results and Exa summarized contents are different product inputs. Raw page text is useful for machine ingestion, but Brain enrichment review needs a concise fact candidate that a human can accept or reject. Using summaries aligns the provider output with the enrichment contract before candidate synthesis wraps it as an external source.

The timeout increase is part of the same fix. Without it, the "better" API shape can regress into no Web enrichment at all, which looks like a provider availability issue rather than a content-quality issue.

The Admin and mobile changes close the loop:

- Admin Sources proves the tenant has an eligible `Exa Research` adapter.
- GraphQL E2E proves `runBrainPageEnrichment` returns `builtin:web-search` with `state: ok`, Web hit count, and cited candidates.
- iOS Simulator review proves the mobile user sees candidate updates first, with provider details available but de-emphasized.

## Prevention

- Test for bad-content terms, not just hit count. A regression test should cover page chrome like `# back`, `My special offers`, `Prices`, `0€`, and `300€`.
- Verify Web enrichment end to end through deployed dev Lambdas after API changes. Local tests do not prove the GraphQL Lambda and MCP Context Engine Lambda are both running the branch code.
- Use native iOS verification for mobile review UX:

```sh
cd apps/mobile
pnpm run ios
xcrun simctl openurl booted 'thinkwork://thread/<threadId>'
```

- When adding external Context Engine providers, record both provider status and candidate quality:

```text
providerId: builtin:web-search
displayName: Exa Research
state: ok
hitCount: 10
webCandidateCount: > 0
badMatches: []
```

- Keep review metadata behind a details affordance when the user task is candidate review. Provider diagnostics matter, but they should not dominate the first mobile viewport.

## Related Issues

- [Context Engine adapters need operator-level verification](../best-practices/context-engine-adapters-operator-verification-2026-04-29.md)
- [Injected built-in tools are not workspace skills](../best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md)
- [Verify Expo splash changes in a native dev build](../best-practices/expo-splash-native-dev-build-verification-2026-04-27.md)
- [Enrich Page Web Search and Review UX requirements](../../brainstorms/2026-05-01-enrich-page-web-and-review-ux-requirements.md)
- PR #724 planned the Web enrichment/review UX requirements. (session history)
