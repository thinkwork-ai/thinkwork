---
title: "Thread json-render data-json-render Contract v1"
date: 2026-06-26
status: active
issue: THNK-78
plan: docs/plans/2026-06-26-002-feat-thread-json-render-ui-emission-plan.md
origin: docs/brainstorms/2026-06-26-thnk-77-json-render-shadcn-foundation-requirements.md
supersedes:
  - docs/specs/thread-genui-json-render-contract-v1.md
---

# Thread json-render `data-json-render` Contract v1

This contract freezes the THNK-77 hard cutover from ThinkWork's proprietary
`data-genui` payload to an upstream json-render-shaped Thread part and is the
runtime emission target for THNK-78. ThinkWork
owns the Thread carrier, persistence, tenant visibility, action authorization,
promotion policy, fallback requirements, and safety checks. The rendered UI tree
uses the upstream json-render spec shape and upstream json-render packages.

The canonical shared implementation lives in `@thinkwork/thread-json-render`.
That package is deliberately React-free so the AgentCore runtime, API
finalization path, web renderer, and mobile fallback parser can validate the
same wire shape without importing client renderer code.

Golden fixtures live under `docs/fixtures/thread-json-render/`:

- `valid-card.json` is a complete primitive json-render part that must validate
  at runtime, persist as `Message.parts`, render inline on web, and fall back on
  mobile.
- `invalid-legacy-component.json` is the retired `{ component, props }` shape
  and must never be promoted into trusted UI.
- `invalid-fenced-markdown.md` is ordinary assistant markdown. Even when it
  contains a plausible `data-json-render` object, clients and hosts must not
  parse markdown fences as trusted UI.

Future incompatible changes create a sibling spec at
`docs/specs/thread-json-render-contract-v2.md`. Downstream units must not
silently reintroduce `@thinkwork/genui` or a ThinkWork-only component grammar.

## Wire Shape

`data-json-render` is an AI SDK `data-*` part:

```json
{
  "type": "data-json-render",
  "id": "json-render:task-review:123",
  "data": {
    "schemaVersion": "thread-json-render/v1",
    "catalogVersion": "thread-json-render-catalog/v1",
    "status": "ready",
    "spec": {
      "root": "reviewCard",
      "elements": {
        "reviewCard": {
          "type": "Card",
          "props": {
            "title": "Review onboarding task",
            "description": "Confirm the customer kickoff task is ready.",
            "maxWidth": null,
            "centered": false,
            "className": null
          },
          "children": ["content"]
        },
        "content": {
          "type": "Stack",
          "props": {
            "direction": "vertical",
            "gap": "sm",
            "align": null,
            "justify": null,
            "className": null
          },
          "children": ["title", "summary", "approve"]
        },
        "title": {
          "type": "Heading",
          "props": { "text": "Review onboarding task", "level": "h3" },
          "children": []
        },
        "summary": {
          "type": "Text",
          "props": {
            "text": "Confirm the customer kickoff task is ready.",
            "variant": "body"
          },
          "children": []
        },
        "approve": {
          "type": "Button",
          "props": {
            "label": "Approve",
            "variant": "primary",
            "disabled": false
          },
          "children": []
        }
      }
    },
    "durableActions": [
      {
        "id": "approve-task",
        "label": "Approve",
        "kind": "approve",
        "params": { "taskId": "task-123" }
      }
    ],
    "mobileFallback": {
      "title": "Review onboarding task",
      "summary": "Confirm the customer kickoff task is ready.",
      "lines": ["Status: pending"]
    },
    "specHash": "json-render-fnv1a:..."
  }
}
```

The `data.spec` value is an upstream json-render spec:

- `root`: the root element id.
- `elements`: a map of element ids to json-render elements.
- Each element uses `type`, `props`, and `children`.
- `type` names are resolved against the selected json-render catalog.
- `children` references element ids. THNK-77 v1 uses whole-spec replacement for
  updates rather than partial child streaming.

## Catalog

Layer one is sourced from upstream `@json-render/shadcn`:

- `@json-render/shadcn/catalog` exports `shadcnComponentDefinitions`.
- `@json-render/shadcn` exports `shadcnComponents`.
- The web renderer must select from those upstream exports rather than
  hand-cloning the json-render demo catalog into a private schema.

Layer two contains ThinkWork domain entries, adapters, or compositions. These
extend json-render and must not bypass it. Initial domain candidates are task
review, workflow status, key-value/list display, form/action composition, and
`analytics.display` backed by `@thinkwork/analytics-display`.

## Persisted Shape

Persisted `Message.parts` stores the same `data-json-render` part by value. The
part `id` is stable across live updates. When another `data-json-render` part
arrives with the same `type` and `id`, consumers replace the whole `data`
payload. Other `data-*` parts with the same id are not affected.

`specHash` binds durable action and promotion requests to the exact visible spec
revision. The hash is deterministic over canonical JSON; it is not a security
signature.

## Validation

Validation is host-owned and fail-closed. It must enforce:

- `type: "data-json-render"`, stable string `id`, supported schema/catalog
  versions, status, `spec`, `mobileFallback`, and `specHash`.
- Upstream json-render structural integrity: existing root, referenced
  children, no orphaned elements when the host enables orphan checks, and no
  misplaced `on`, `visible`, `repeat`, or `watch` fields inside `props`.
- Component allowlist from the selected json-render catalog.
- Component props parsed through the selected catalog definitions.
- Size, depth, element count, fallback line count, diagnostic count, and durable
  action count limits.
- No arbitrary browser behavior: no callbacks, scripts, raw HTML, unapproved
  remote URLs/media, unrestricted style/class fields, or generated React/TSX.
- Durable action descriptors only for ThinkWork-authorized server effects.
- Local json-render state actions remain local UI state and are not durable
  ThinkWork actions.

Invalid, unsupported, oversized, or unsafe specs render compact fallback UI and
do not authorize actions or promotion.

## Actions

json-render local actions and ThinkWork durable actions are separate:

- Local json-render actions can update local UI state only.
- Durable ThinkWork actions are declared in `data.durableActions`.
- Durable action submissions must include `threadId`, `sourceMessageId`,
  `partId`, `actionId`, `specHash`, an idempotency key, and bounded params.
- The server must reload the visible Thread and assistant source message, find
  the persisted `data-json-render` part, validate the current spec and action
  descriptor, compare `specHash`, enforce tenant/thread visibility, rate-limit,
  and append a normal Thread message.

Generated UI never supplies arbitrary client callbacks.

## Fallbacks

`mobileFallback` is required on every `data-json-render` part. Mobile v1 does
not need native json-render rendering; it must parse this fallback and show a
bounded summary rather than crashing or blanking the conversation. Unsupported
web clients may use the same fallback.

Old `data-genui` parts are not migrated, converted, or read through. They may
be ignored or shown as unsupported legacy generated UI. Runtime work must emit
complete `data-json-render` parts directly rather than translating
well-known json-render examples into a ThinkWork-only grammar.

Assistant prose, fenced JSON, `_type` GenUI cards, and legacy `{ component,
props }` objects are text or unsupported data only. The only trusted runtime
path is an `emit_json_render_ui` tool result that becomes a validated
`data-json-render` part.

## Promotion

Promotion snapshots the current `data-json-render` payload as a `data_view`
artifact with source Thread, source message, source part id, spec hash, status,
title, summary, provenance, freshness, diagnostics, and sensitivity metadata
where present.

Old `genui_snapshot` artifacts may remain historical data if existing generic
artifact readers show them, but THNK-77 does not add compatibility rendering.

## Package Gate

U1 installs the shared `@thinkwork/thread-json-render` package with
`@json-render/core` and `@json-render/shadcn` catalog dependencies. The package
gate must verify that validation uses upstream json-render catalog definitions,
that domain catalog entries extend that catalog without bypassing it, and that
the shared contract path does not rely on json-render streaming hooks, React
renderers, or remote executable code.
