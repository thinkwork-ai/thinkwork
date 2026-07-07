# Managed workspace folders: removal must sever the assignment record before deleting files

**Date:** 2026-07-06
**Surface:** Composer workspace tree (`ComposerWorkspaceEditor` / `SettingsCapabilities`), `connections/<slug>` folders
**Shipped fix:** PR #3455 (THINK-190 follow-up)

## Symptom

A connection folder (`connections/company-brain--brain`) could not be removed from an
agent's workspace through any visible affordance:

- **Revoke** ran an approval flow, then "nothing happened" — the folder stayed in the tree.
- **Delete** (raw file op) appeared to work, then the folder came back.

## Root cause: two records, two half-actions

For folder-dispatch agents the connection has **two coupled pieces of state**: the
assignment record (`connections/<slug>/.assignment.json` sidecar, the source of truth
the reconciler enforces) and the materialized folder contents. The old UI exposed two
actions that each handled only one piece:

- **Revoke** removed the sidecar only, downgrading the folder to an unsigned proposal —
  visually identical in the tree, so it read as a no-op.
- **Raw Delete** removed files but left the assignment record intact, so
  `reconcile-connection-folders` re-materialized the folder on its next pass —
  resurrection that reads as "delete is broken."

This is the general shape, not a one-off: whenever a reconciler enforces
record → files, any file-only delete is undone, and any record-only revoke looks
like nothing happened.

## Fix pattern

1. Managed folders expose **exactly one** removal action ("Remove connection…").
2. It severs the record **first** (MCP_SERVER detach mutation → sidecar/assignment
   gone, noop-tolerant), **then** deletes the folder files. Order matters: files-first
   loses the race with the reconciler.
3. All raw file ops (rename/delete/cut/paste/new-inside) are suppressed on managed
   folders so the broken half-actions can't be reached.

Tool-class capability folders keep their Revoke semantics — the trap is specific to
reconciler-managed folders.

## How to recognize it again

"Delete works but the thing comes back" or "revoke succeeds but nothing changes" on
any workspace-materialized surface (connections, skills, future managed folders) —
check whether the action touches both the record and the files, in record-first order.
