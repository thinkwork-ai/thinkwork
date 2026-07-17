---
module: api
problem_type: architecture-trial
tags:
  - think-311
  - agentcore-harness
  - runtime-swap
---

# AgentCore Harness Execution Trial — Dossier & Verdict (THINK-311, 2026-07)

Plan: `docs/plans/2026-07-16-002-feat-agentcore-harness-trial-plan.md`. This document carries the U1 reference-run dossier (below) and, once U6 executes, the go/no-go verdict with the evidence triple (manifest fingerprint, harness version, artifact id).

## Verdict

**Conditional no-go (2026-07-17): AgentCore Harness is a PROVEN, qualified alternate runtime — but the platform agent stays on Pi.** The trial ran live on dev (tenant `sleek-squirrel-230`, agent `thinkwork` `c1e4434f`), driven end-to-end through the web UI at :5175, and demonstrated both required legs:

1. **Green chat turn on Harness** — thread `e4d8ce9a-7830-40b2-ad9a-f1a2ed725927`, turn `ab30da9d-bb3a-4821-b522-178815bd191c`: `runtime_type='harness'`, `status='succeeded'`, response rendered in the UI with attributed usage (4,503 in / 19 out, $0.0167), cost_events rows `llm` ($0.0138) + `agentcore_compute` ($0.0029), and the full `diagnostics.harness` evidence block.
2. **Document emission through the real artifact pipeline** — thread `a2295971`, artifact **`a22da845-c6f5-5675-a74c-68c2cc5a73bd` "777 Automotive — Q2 2026 Quarterly Business Review"**, emitted by the harness turn via the projected `emit_document` inline_function and `handleDocumentEmission` (one frontmatter warning; document `dd91ea9e`).

**Evidence triple**: manifest fingerprint `ee890f38d13f3e2f8a41c64c53b0be0bd616536dc799ff5ced433309d2432336`, harness version `3` (harness `tw_thinkwork_1c4877fd31-p2JXbCllgP`, since deleted), artifact id `a22da845-c6f5-5675-a74c-68c2cc5a73bd`. Projection fingerprint `a00f02797ac2e9026e7433f800bd67b96c6dcaafdca9fd007e3076c84871ac4c`, config fingerprint `9dc3b8b8424ca40b9e8747cbf6c6af11c4e9972f233b01fcee055d08fcd31cd0`.

R4 held throughout: eleven failure iterations each surfaced loudly in-thread with a precise reason; zero silent Pi fallbacks.

### Why not adopt for the platform agent

- **The product's differentiators are loop behavior**: workspace-native semantics (filesystem-is-the-agent), plates/emission contract, contract spine, governed delegation, Pi extensions, Hindsight memory. Each needs a Harness adapter; emit_document (the simplest) required discovering an undocumented relay protocol.
- **Memory-model conflict**: each Harness owns a session memory; ThinkWork memory is workspace + Hindsight, space-scoped. Two sources of truth.
- **v1 sharpness** (all hit live, all fixed): five undocumented IAM requirements, wrapped control-plane responses, multi-message stream framing, assistant-message-resend relay protocol, ~3-minute first-provision (exceeds a 120s READY poll), and **session poisoning** — one malformed relay permanently corrupts the thread-scoped session memory with no repair API.

### What the trial changed upstream (architecture decisions, 2026-07-17)

- **`InvokeHarness` supports per-invocation overrides** (`tools`, `skills`, `allowedTools`, `systemPrompt`, `model`, `actorId` — SDK 3.1089). Per-call dynamic capability injection is native; the "config is version-level only" assumption is dead. This upgrades Harness to a credible executor for sub-agents/bounded agents.
- **Adopt AgentCore Identity + Gateway as the authorization/tool plane, loop-agnostic** (next architecture program): one super-agent ceiling per tenant agent; per-user/space/role enforcement at the tool plane with identity tokens against the THINK-302 registry; Gateway semantic tool search for context-rot control. Never per-principal harness/config multiplication.
- **Layer split confirmed**: Eve folder anatomy = authoring/context plane (proved loop-portable — the projection compiled the same workspace onto a different runtime with a truthful fingerprint); registry + Identity + Gateway = enforcement plane. Workspace files stop pretending to be the enforcement surface (THINK-302 direction, extended).

### Disposition

- UI retired (PR #3886): composer runtime picker removed; AgentCore option removed from the Agent-config Runtime dropdown (enum value `AGENTCORE` retained in schema).
- Backend spine kept inert and tested as the shelved qualified-alternate: selector seam (#3862/#3872), projection (#3863/#3876/#3878), runner (#3867/#3884/#3885), IAM (#3875/#3880/#3883, conditional on the `agentcore-harness` module), DB constraint (#3874). Nothing dispatches to it without `requestedRuntime`, which no UI sends.
- Dev AWS cleanup done: 3 temp IAM grants removed; dev harness deleted (auto-provisioned runtime/memory swept with it; orphaned memory checked).
- Re-evaluate in ~2 quarters, or earlier if AWS ships identity-forwarded MCP calls / documented relay protocol, or Pi ops tax (image pinning, stall-monitor-class bugs) escalates.

### Harness integration protocol notes (hard-won, keep)

1. Control-plane responses wrap the document under a `harness` key (`{harness:{...},$metadata}`); ListHarnesses summaries are unwrapped.
2. `CreateHarness` provisions a backing AgentRuntime, WorkloadIdentity, **and Memory on behalf of the caller** — all three authorize against the _calling_ role (TagResource for tag-on-create too); the _execution_ role needs the memory data-plane (`ListEvents` etc. on `memory/harness_tw_*`).
3. One `InvokeHarness` stream carries many messages (internal builtin rounds); `contentBlockIndex` restarts per message.
4. The stream-ending assistant message (caller-fulfilled toolUse) is **not persisted** to session memory — the caller must resend it ahead of the toolResult message or Bedrock rejects the continuation ("toolResult blocks exceed toolUse blocks").
5. First provision ≈3 min (READY poll must tolerate it or treat as retriable); subsequent turns reuse in seconds.
6. `model_catalog.provider` is vendor metadata, not the inference channel — gate models by Bedrock id shape.

## Reference-run dossier (U1)

### TEI thread `a97275ae-4152-41a0-bf1b-9afe4f8abfed` → "QBR: 777 Automotive"

Compiled 2026-07-16. All evidence gathered READ-ONLY via:

- **RDS Data API** (SELECT-only) against Aurora cluster `thinkwork-tei-e2e-db` (arn:aws:rds:us-east-1:637423202447:cluster:thinkwork-tei-e2e-db), database `thinkwork`, secret `thinkwork-tei-e2e-db-credentials` — Data API (`HttpEndpointEnabled: true`) worked directly from this machine with AWS profile `tei` (account 637423202447, us-east-1). No psql/bastion needed.
- **S3** bucket `thinkwork-tei-e2e-storage` (stage name is `tei-e2e`).
- **CloudWatch Logs** `/aws/lambda/thinkwork-tei-e2e-api-chat-agent-invoke`.
- Repo source at (plate definitions).

No fields remain unknown; DB access was possible.

---

### 1. Tenant / Agent / Workspace

| Field                            | Value                                                                                                                                                                          | Evidence                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Tenant id                        | `2d09efbb-4f45-4ead-9f50-6c74c55a5e5f`                                                                                                                                         | `threads` row; `tenants` row                                                         |
| Tenant slug / name               | `tei` / "eric's Workspace"                                                                                                                                                     | `tenants` row                                                                        |
| Agent id                         | `1c1aa45a-f80d-4492-87a4-7b6dfe858790`                                                                                                                                         | `threads.agent_id`; confirmed in chat-agent-invoke log line                          |
| Agent slug / name                | `thinkwork-agent` / "ThinkWork Agent"                                                                                                                                          | `agents` row                                                                         |
| Agent role                       | "Default ThinkWork platform agent for TEI smoke testing." (`is_platform_default: true`, `source: system`)                                                                      | `agents` row                                                                         |
| Runtime                          | `runtime='pi'`, `adapter_type='agentcore-pi'`                                                                                                                                  | `agents` row                                                                         |
| Model                            | `moonshotai.kimi-k2.5` (model_catalog: provider `bedrock`, display "Kimi K2.5")                                                                                                | `agents.model`; `model_catalog`; turn usage_json                                     |
| **capability_folder_dispatch**   | **true**                                                                                                                                                                       | `agents.capability_folder_dispatch`                                                  |
| agent_profile_manifest_authority | true                                                                                                                                                                           | `agents` row                                                                         |
| Agent workspace folder (S3)      | `s3://thinkwork-tei-e2e-storage/tenants/tei/agents/thinkwork-agent/`                                                                                                           | S3 listing; turn context_snapshot `workspace_projection.sources[owner=agent].prefix` |
| Space                            | `1fa59a74-86ae-499d-8c55-a407282ca676` (agent runtime_config.defaultSpaceId; space prefix `tenants/tei/spaces/default/`)                                                       | `threads.space_id`; `agents.runtime_config`; context_snapshot                        |
| Agent DB system_prompt           | "You are ThinkWork, the tenant platform agent. Be concise, accurate, and helpful. For smoke tests that ask for an exact phrase, return that exact phrase."                     | `agents.system_prompt`                                                               |
| Agent-level toggles              | web_search enabled, web_extract enabled, send_email enabled, context_engine enabled, json_render_ui enabled; sandbox=null, browser=null, blocked_tools=null, guardrail_id=null | `agents` row                                                                         |

### Rendered (thread) workspace

- Rendered prefix for the run: `tenants/tei/threads/generate-the-qbr-for-777-automotive-2/` (43 files hydrated, `synced=43;skipped=0;deleted=0`, bootstrap 1729ms).
- Projection sources (context_snapshot.workspace_projection): agent `tenants/tei/agents/thinkwork-agent/` (etagSummary `38:418eb12f35ed`), space `tenants/tei/spaces/default/`, user `tenants/tei/users/eric-odom/` (`1:1b97048713bc`), thread_goal/thread_notes `tenants/tei/threads/generate-the-qbr-for-777-automotive-2/` (`4:ba07e1883f4c`).
- Injected files: `AGENTS.md`, `CONTEXT.md`, `GUARDRAILS.md`, `User/USER.md`. agentsMdKey = `tenants/tei/threads/generate-the-qbr-for-777-automotive-2/AGENTS.md`, etag `4b0529fb98577946...fc3b8b` (history at `.agents-md-history/<sha>.md`).
- System-prompt source: root instructions come from the agent folder `INSTRUCTIONS.md` (s3 `tenants/tei/agents/thinkwork-agent/INSTRUCTIONS.md`, 3291 bytes, regenerated 2026-07-16), projected into the thread `AGENTS.md`. The stored `thread_turns.system_prompt` opens with current-date + `<current_requester>` (eric@thinkwork.ai, user `a428d408-6021-70a8-f22e-3d4c7077ce92`) + Requester Profile Policy.

---

### 2. The Reference Run (thread + turn)

| Field                | Value                                                                                                                                                                           | Evidence                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thread               | `a97275ae-4152-41a0-bf1b-9afe4f8abfed`, `CHAT-88`, title "Generate the QBR for 777 Automotive", channel `chat`, workspace_folder_name `generate-the-qbr-for-777-automotive-2`   | `threads` row                                                                                                                                                                                                      |
| Created              | 2026-07-15 21:30:26 UTC by user `a428d408-6021-70a8-f22e-3d4c7077ce92` (eric@thinkwork.ai)                                                                                      | `threads` row                                                                                                                                                                                                      |
| Turn (only one)      | `6ea358a8-5f0b-438c-bc23-9733800e9957`, turn_number 1, kind `agent_turn`, status `succeeded`                                                                                    | `thread_turns` row                                                                                                                                                                                                 |
| invocation_source    | `chat_message` (dispatcher `chat-agent-invoke`)                                                                                                                                 | `thread_turns.invocation_source`; context_snapshot.dispatcher; CloudWatch `[chat-agent-invoke] threadId=a97275ae-... agentId=1c1aa45a-...` at 2026-07-15T21:30:28Z (traceId `1-6a57fbf3-24d04aab7302dbb8452ca5d2`) |
| runtime_type         | `pi`                                                                                                                                                                            | `thread_turns.runtime_type`                                                                                                                                                                                        |
| Model used           | `moonshotai.kimi-k2.5` (requested_model identical; user message metadata `{"requestedModelId":"moonshotai.kimi-k2.5"}`)                                                         | usage_json, context_snapshot, `messages.metadata`                                                                                                                                                                  |
| Triggering prompt    | message `050ecd0e-f4d2-4742-a5d0-9c582b178cf5`, role user, content exactly: **"Generate the QBR for 777 Automotive"**                                                           | `messages` row                                                                                                                                                                                                     |
| Attachments          | **None** (`thread_attachments` for thread = 0 rows; message `parts`/`tool_calls` null)                                                                                          | DB                                                                                                                                                                                                                 |
| Duration / usage     | 118.5 s total (agent_loop 116.6 s, 22 loop iterations); 49,302 input / 138 output tokens; cost $0.04422; tool_assembly `extensionTools=16`; session store s3                    | usage_json diagnostics                                                                                                                                                                                             |
| Manifest fingerprint | `resolved_capability_manifests` row `99a025ef-b716-4375-9ba9-f435a8e48dc7` for this turn, config_fingerprint `0066590a10f7da641a74e0f24d1b71b4a683bf18f9f7616a82e68fb087db512b` | DB                                                                                                                                                                                                                 |

---

### 3. The Artifact

| Field                     | Value                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidence                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Artifact id               | `fe16c367-f196-5af1-981e-e5a86e6e1f48`                                                                                                                                                                                                                                                                                                                                                                                              | `artifacts` row; emit_document result `details.artifactId` |
| Title                     | "QBR: 777 Automotive"                                                                                                                                                                                                                                                                                                                                                                                                               | `artifacts.title`                                          |
| Type / genre (plate slug) | `qbr`, status `draft`, metadata `{"kind":"document","genre":"qbr",...,"documentId":"0be7ab03-1dbf-4a90-8d7d-f8375fb67f7a"}`                                                                                                                                                                                                                                                                                                         | `artifacts` row                                            |
| Plate source              | **Platform built-in plate** `qbr` from `packages/api/src/lib/artifacts/plate-definitions.ts` (line ~149). NOT a tenant plate — tenant `document_plates` rows for TEI are only `customer-review` and `sales-rep-daily`.                                                                                                                                                                                                              | repo + DB                                                  |
| S3 payload                | `tenants/2d09efbb-4f45-4ead-9f50-6c74c55a5e5f/artifact-payloads/artifacts/fe16c367-.../content.md` (3,921 B) + content-addressed copy + **compiled `render.html` (15,890 B)** in the same prefix                                                                                                                                                                                                                                    | `artifacts.s3_key`; S3 listing                             |
| Born-from linkage         | thread `a97275ae-...`, agent `1c1aa45a-...`, source_message_id `0e47fd92-c054-42aa-a779-0558ca6804dc` (assistant message of turn 1); created_at 2026-07-15 21:32:28                                                                                                                                                                                                                                                                 | `artifacts` row                                            |
| created_by                | created_by_user_id `a428d408-6021-70a8-f22e-3d4c7077ce92` (eric@thinkwork.ai; metadata.createdBy same)                                                                                                                                                                                                                                                                                                                              | `artifacts` row                                            |
| Share URL                 | **Exists.** `artifact_shares` row `0e680c5d-faf0-4162-ab93-4f8e72353937`, created 2026-07-16 17:10:24 by same user, not revoked — this is the "published" state.                                                                                                                                                                                                                                                                    | DB                                                         |
| Versions                  | head_version 0, head_write_seq 0; no `artifact_versions` rows                                                                                                                                                                                                                                                                                                                                                                       | DB                                                         |
| Emission behavior         | `emit_document` was called **5 times**: attempts 1–4 REJECTED by plate conformance validation (DIRECTIVE_INVALID on `tw:chart` series shape; ANALYSIS_INVALID on `tw:analysis` trend `points` (needs 3–24), variance_vs_prior `current`/`prior`) — attempt 5 saved draft. Validation loop is part of the platform emit pipeline, i.e. the Harness projection must reproduce reject-and-retry semantics or pre-conform the markdown. | usage_json tool_invocations results                        |

---

### 4. Effective Capability Surface (what the run could see vs. what it used)

### Resolved manifest for the exact turn (resolved_capability_manifests.manifest_json, schema_version 2)

- **skills (resolved)**: `artifact-builder`, `document-composer`, `web-search` — loaded: `artifact-builder`, `document-composer` (context_snapshot activeSkills matches resolved).
- **mcpServers**: `lastmile-data` (only one).
- **builtInTools**: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
- **piExtensions**: [] (none; `pi_extension_assignments` count for tenant = 0 enabled).
- **extensionTools (16)**: `send_email`, `set_task_status`, `set_work_item_status`, `ask_user_question`, `save_canvas`, `load_canvas`, `refresh_canvas_data`, `list_canvases`, `fetch_workspace_source`, `emit_document`, `web_search`, `web_extract`, `knowledge_graph_search`, `knowledge_graph_get_entity`, `knowledge_graph_neighbors`, `workspace_skill`.
- **gated**: [].
- **delegatedProfiles** (sub-agents, all with loadedExtensionTools=[]): `research`, `coding`, `reviewer`, `analyst` (profile ids f027e4c2/d6b766f5/7ffde028/9ab18027).

### Tools the run ACTUALLY called (usage_json.tools_called + tool_invocations, 22 invocations total)

1. `workspace_skill` ×1 — `{slug: "document-composer"}` (loads the skill body).
2. `read` ×2 — `connections/lastmile-data/SCHEMA.md` (+offset continuation). Note: runtime path uses the legacy `connections/` name (dual-read window); S3 stores `connectors/lastmile-data/SCHEMA.md` (71,940 B).
3. `mcp_lastmile-data_query` ×14 — read-only SQL against the LastMile fuel-distribution dataset (customer/receivable lookup for "777", order_header/order_item monthly + top products, invoice_aging, invoice_header, tank+product+location, ship_to, sales rep, tasks, Q2-vs-Q3 comparison). Customer id `cust_eztj0c4vwsoymyfnyqa2bcf3`.
4. `emit_document` ×5 — genre `qbr`, title "QBR: 777 Automotive", status draft (4 conformance rejections + 1 success).

### MCP server used

- `lastmile-data` — tenant_mcp_servers `e4e97416-f59c-449b-94c2-ccf583a11d46`, url `https://8puq24dl63.execute-api.us-east-1.amazonaws.com/mcp/analyst/lastmile-data`, transport `streamable-http`, auth `service_credential` via secret `thinkwork/tei-e2e/analyst/broker-credential` (from `mcp/lastmile-data/.assignment.json` in the agent folder). Only MCP tool exposed/used: `query`.
- Connector grant sidecar `connectors/lastmile-data/.assignment.json`: enabled, `permissions.operations: ["query"]`, policy `{maxQueriesPerRun: 12, maxQueriesPerTenantDay: 200, retain_sql: false, role_tier: reader}`, Ed25519-signed by `operator:eric@thinkwork.ai` 2026-07-15. (Note: the run made 14 query calls vs maxQueriesPerRun 12 — budget evidently not enforced or counted differently; worth noting, not a Harness concern.)

### Agent folder contents (S3 `tenants/tei/agents/thinkwork-agent/`, 43 files)

- Root docs: INSTRUCTIONS.md, CONTEXT.md, GUARDRAILS.md, MEMORY_GUIDE.md, ROUTER.md, SOUL.md, SPACE.md, TOOLS.md, USER.md, manifest.json.
- `skills/`: `artifact-builder/` (SKILL.md 10,467 B + WIRING.md + references/crm-dashboard.md + skill.oms.sig; wiring "default"), `document-composer/` (SKILL.md 5,585 B + WIRING.md + references/authoring-rules.md + skill.oms.sig; wiring "always-on", installed from catalog sha 3e1c3545…), `thinkwork-admin/` (**.assignment.json only, no SKILL.md** — operations save_agent_loop/delete_agent_loop; not in the turn's resolved skills).
- `connectors/`: `admin-ops/`, `lastmile-data/` (CONNECTION.md + SCHEMA.md), `twenty--crm/` — each with signed .assignment.json.
- `mcp/`: `lastmile-data/`, `twenty--crm/` .assignment.json (transport/auth/secretRef).
- `tools/`: `json-render-ui/`, `send-email/`, `web-extract/`, `web-search/` (TOOL.md + signed .assignment.json).
- `agents/` (sub-agents): `analyst/`, `coding/`, `research/`, `reviewer/` INSTRUCTIONS.md.

---

### 5. Minimal Capability Inventory (scoped parity target)

**The reference run needs exactly:**

- Model: **Bedrock `moonshotai.kimi-k2.5`** (Kimi K2.5), ~50K-token context in practice (49,302 input tokens on this run).
- Skills: **`document-composer`** (loaded via `workspace_skill` meta-tool; markdown-authoring instructions + references/authoring-rules.md).
- Workspace file read access: **`read`** over the projected thread workspace — specifically `connections/lastmile-data/SCHEMA.md` (71.9 KB schema doc).
- MCP servers: **`lastmile-data`** (streamable-http, service_credential from Secrets Manager `thinkwork/tei-e2e/analyst/broker-credential`) with tool **`query`** only.
- **`emit_document`** with platform plate **`qbr`** (built-in, plate-definitions.ts), including the conformance-validation/reject-retry loop for `tw:chart` / `tw:analysis` directives, draft save to `artifacts` + S3 content.md + compiled render.html.
- System prompt assembly: agent INSTRUCTIONS.md → thread AGENTS.md projection + CONTEXT.md + GUARDRAILS.md + User/USER.md + current_requester block.
- **Nothing else.** No attachments, no memory recall calls, no web tools, no canvas, no email, no sub-agent delegation, no sandbox/bash execution.

**Present on the agent but NOT exercised by this run** (out of scoped-parity):

- Skills: `artifact-builder`, `thinkwork-admin`, `web-search` (resolved but never invoked).
- MCP/connectors: `twenty--crm` (oauth), `admin-ops` (broker admin connection).
- Extension tools: `send_email`, `set_task_status`, `set_work_item_status`, `ask_user_question`, `save_canvas`/`load_canvas`/`refresh_canvas_data`/`list_canvases` (json-render-ui), `fetch_workspace_source`, `web_search` (Exa), `web_extract` (Firecrawl), `knowledge_graph_search`/`get_entity`/`neighbors` (context engine/Hindsight).
- Built-in Pi tools: `bash`, `edit`, `write`, `grep`, `find`, `ls` (only `read` was used).
- Sub-agent profiles: `research`, `coding`, `reviewer`, `analyst` (delegation never triggered).
- Memory retention pipeline (post-turn, platform-side).

---

### 6. Harness-Mapping Red Flags (active on this agent, hard/impossible to map to AWS AgentCore Harness)

1. **Pi built-in filesystem/sandbox tools** (`bash`, `edit`, `write`, `grep`, `find`, `ls`, `read` over an S3-hydrated workspace) — Pi-runtime-specific workspace hydration + reconcile/write-back semantics. The run used only `read`, so scoped parity needs a read-only file surface at minimum.
2. **`workspace_skill` meta-tool** — Pi's skill-loading mechanism (returns SKILL.md body as a tool result). Harness has no equivalent; skill content would have to be inlined into the prompt or reimplemented.
3. **`emit_document` platform extension + plate conformance pipeline** — plate registry, tw: directive validation, reject/retry loop, artifact persistence + HTML compile. Entirely ThinkWork-platform code (packages/api artifacts pipeline), not a Bedrock-native tool; must be projected as a custom tool + external pipeline.
4. **Context engine / knowledge*graph*\* tools** (Hindsight-backed) — active in the manifest (context_engine enabled), unused here.
5. **json-render-ui canvas tools** (save_canvas etc.) — first-class platform UI tooling, active, unused.
6. **Sub-agent delegation profiles** (agents/ folders compiled into delegatedProfiles) — Pi/ThinkWork governed-delegation model, unused in the run.
7. **`send_email` / `ask_user_question` / work-item status tools** — platform extension tools riding the Lambda callback fetch (Pi Lambda has no HTTP egress), unused here.
8. Workspace projection/reconcile machinery itself (AGENTS.md generation, etag summaries, signed .assignment.json grant sidecars, capability*folder_dispatch) — governance layer with no Harness analogue; for scoped parity only its \_output* matters (the resolved tool/skill list above).
9. No browser automation and no `execute_code` were in the manifest for this turn (sandbox=null, browser=null on the agent row; INSTRUCTIONS.md text mentions them, but they were not assembled) — so they are NOT blockers for this specific run.

---

### Appendix: key evidence pointers

- All DB evidence re-derivable read-only via the RDS Data API against cluster `thinkwork-tei-e2e-db` (database `thinkwork`, secret `thinkwork-tei-e2e-db-credentials`) using the ids in the tables above.
- CloudWatch: `/aws/lambda/thinkwork-tei-e2e-api-chat-agent-invoke` 2026-07-15T21:30:28Z, request `47df9c8b-c93a-4894-89fe-97e463b5201b`.
- Built-in plate definitions: `packages/api/src/lib/artifacts/plate-definitions.ts` (`qbr`).
