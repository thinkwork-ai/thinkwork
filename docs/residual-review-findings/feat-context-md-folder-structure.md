## Residual Review Findings

Source: LFG `ce-code-review mode:autofix` review for
`feat/context-md-folder-structure`, plan
`docs/plans/2026-05-24-002-feat-context-md-folder-structure-generation-plan.md`.

- P2 `apps/admin/src/components/agent-builder/__tests__/FolderTree.test.ts`: Add rendered context-menu interaction coverage once the admin package has a component testing harness. Current coverage verifies the source-level menu gate and callback plumbing, but not Radix/context-menu interaction behavior.
- P2 `apps/admin/src/components/agent-builder/__tests__/WorkspaceEditor.target.test.ts`: Add behavioral editor tests for dirty-save/generate/reload ordering once a mocked React component test harness exists. The implementation now places the open target in loading state during generation to prevent mid-flight edits from being overwritten.
- P3 `packages/agentcore-strands/agent-container/container-sources/server.py`: Consider adding a first-class Strands runtime tool for `generate-folder-structure` if agents should invoke this editor maintenance action directly. This PR exposes the authenticated REST action and admin UI affordance; runtime tool discovery was outside the requested context-menu scope.
