# Residual Review Findings - Phase E Agent Builder Shell

Source branch: `codex/phase-e-agent-builder-clean`
Source plan: `docs/plans/2026-04-25-006-feat-phase-e-agent-builder-shell-plan.md`

## Residual Findings

- **P1 - Admin MCP still lacks agent-builder parity.** The human-facing admin UI now edits canonical workspace files, but `packages/lambda/admin-ops-mcp.ts` still exposes `agents_set_skills` as the automation primitive and does not expose workspace-file list/read/write/delete/regenerate-map tools. That means an agent cannot perform the same canonical builder workflow that a user can in the UI, and automation can still target the retired `agent_skills` write path. Suggested follow-up: replace or augment `agents_set_skills` with workspace-file MCP tools backed by the existing workspace files API, then route skill assignment through derived `AGENTS.md` state.

- **P1 - Runtime agents still lack workspace-file primitives.** Humans can create files, add folders, save workspace files, delete agent overrides, and import bundles through the builder. The Strands runtime still exposes only narrow workspace-adjacent tools such as `write_memory`, so a running agent cannot edit `AGENTS.md`, `CONTEXT.md`, docs, templates, or workspace artifacts with the same agency a human has. Suggested follow-up: add `list_workspace_files`, `read_workspace_file`, `write_workspace_file`, `delete_workspace_file`, and `import_workspace_bundle` runtime tools that wrap the same workspace/import APIs and invalidate the composed workspace cache after mutation.

- **P2 - Raw AGENTS.md editing can still author backend-incompatible table pipes.** The structured routing editor now normalizes pipe characters before serialization, but the raw markdown editor can still save escaped pipe cells that the current backend parser does not understand. Suggested follow-up: either bring the TS/Python/server parser behavior into parity for escaped pipes or add raw-editor validation before save.

- **P2 - Component-level builder tests are still thin.** Current tests cover routing helpers, import request helpers, and tree construction. They do not yet cover the full UI flows for routing row edits, root override retry, deep-link restoration, or tree action click isolation. Suggested follow-up: add a jsdom/component test harness for these builder flows once the admin test setup includes React Testing Library or an equivalent.

- **P3 - Snippet insertion is append-only.** `FileEditorPane` appends snippets to the end of the document. The Phase E plan allowed append fallback when cursor insertion was not readily available, so this is acceptable for the initial builder shell, but a follow-up should insert at the active cursor/selection once the editor surface grows beyond a textarea.
