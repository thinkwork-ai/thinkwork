---
title: "Thread GenUI data-genui Contract v1"
date: 2026-06-20
status: draft
issue: THNK-34
module: "@thinkwork/genui"
---

# Thread GenUI `data-genui` Contract v1

This contract defines the portable Thread GenUI envelope used by agent emitters,
Thread stream consumers, renderers, action handlers, mobile fallbacks, and
promotion flows. It is renderer-independent: U2 defines the data contract, while
U3 chooses the concrete web renderer and U8 registers the analytics-display
adapter.

## Ownership

- THNK-34 owns inline Thread rendering, action routing, mobile fallback text, and
  promotion snapshots for `data-genui` parts.
- THNK-14/THNK-57 owns analytical display specs in
  `@thinkwork/analytics-display`.
- U2 must not create a second chart/table/metric catalog. Analytical output uses
  the reserved `analytics.display` adapter slot and fails closed until U8
  registers the adapter.

## Wire Shape

`data-genui` is an AI SDK data part:

```json
{
  "type": "data-genui",
  "id": "genui:task-review:123",
  "data": {
    "schemaVersion": "thread-genui/v1",
    "catalogVersion": "thread-genui-catalog/v1",
    "status": "ready",
    "spec": {
      "root": "review",
      "elements": {
        "review": {
          "component": "task.review",
          "props": {
            "title": "Review onboarding task",
            "summary": "Confirm the customer kickoff task is ready to approve.",
            "status": "pending",
            "primaryActionId": "approve-task"
          }
        }
      }
    },
    "actions": [
      {
        "id": "approve-task",
        "label": "Approve",
        "kind": "approve",
        "params": { "taskId": "task-123" }
      }
    ],
    "mobileFallback": {
      "title": "Review onboarding task",
      "summary": "Confirm the customer kickoff task is ready to approve.",
      "lines": ["Status: pending"]
    },
    "specHash": "genui-fnv1a:..."
  }
}
```

## Persisted Shape

Persisted `Message.parts` stores the same part shape by value. The part `id` is
stable across updates. When another `data-genui` part arrives with the same
`type` and `id`, consumers replace the whole `data` payload. Other `data-*`
parts with the same id are not affected.

`specHash` binds actions and promotions to the exact visible spec revision. The
current hash is a deterministic cross-runtime FNV-1a hash over canonical JSON; it
is not a security signature.

## Catalog

The v1 native catalog is intentionally small:

- `task.review`: task review and approval card.
- `workflow.status`: compact workflow status summary.
- `keyValue.list`: key-value/list preview.
- `form.action`: small form/action surface.

Reserved adapter components:

- `analytics.display`: registered by U8 using `@thinkwork/analytics-display`.

Components such as `chart`, `table`, `metric`, `analytics.chart`, or bespoke
chart/table schemas are rejected with a diagnostic that points to
`analytics.display`.

## Validation

`@thinkwork/genui` is the canonical validator. It enforces:

- `type: "data-genui"`, stable string `id`, supported schema/catalog versions.
- Required `spec.root`, `spec.elements`, `status`, and `mobileFallback`.
- Strict unknown-key rejection for envelope, spec, elements, diagnostics,
  actions, promotion metadata, and mobile fallback fields.
- Bounded payload bytes, element count, depth, action count, list items, workflow
  steps, form fields, and fallback lines.
- Known native component names or registered adapter components only.
- Valid action ids, action kinds, action params, and component action
  references.
- No arbitrary browser behavior: no callbacks, scripts, renderer references,
  raw HTML, class/style fields, or remote URL/media fields.
- Sanitized diagnostics only; diagnostics carry code, message, optional path,
  and severity.

Invalid payloads fail closed before render. Renderers may show the
`mobileFallback` or a diagnostic fallback, but renderer fallbacks are not an
authorization boundary.

## Actions

Actions are declarative descriptors:

- `id`: stable action id scoped to the part.
- `label`: host-rendered label.
- `kind`: `approve`, `reject`, `submit`, or `open`.
- `params`: bounded primitive map.
- `disabled` and `destructive`: optional host hints.

Action handlers must bind submissions to `part.id` and the current `specHash`.
Generated UI never supplies arbitrary callbacks.

## Fallbacks

`mobileFallback` is required on every payload. Mobile and unsupported clients can
render the fallback without understanding the native component catalog. Invalid,
oversized, unsupported, sensitive, or adapter-missing payloads degrade to compact
fallback text plus sanitized diagnostics.

## Promotion

Promotion stores the current `data-genui` payload as a snapshot artifact. It does
not create an Analytics dashboard and does not reference mutable external render
state. Analytical GenUI promotion preserves the embedded analytics-display
payload once U8 registers `analytics.display`.

## U8 Analytics Boundary

U2 defines only the adapter registration point. U8 will:

- Import and validate `@thinkwork/analytics-display` payloads.
- Register `analytics.display`.
- Map analytics diagnostics, freshness, provenance, sensitivity, and summaries
  into the Thread GenUI fallback/promotion shape.

Before U8, analytical payloads fail with `GENUI_ANALYTICS_ADAPTER_MISSING`.
