# system-workspace (retired)

This package is **retired**. Plan §008 U2 (2026-04-24) consolidated the four
formerly-authoritative `.md` files (`CAPABILITIES.md`, `GUARDRAILS.md`,
`MEMORY_GUIDE.md`, `PLATFORM.md`) into
[`packages/workspace-defaults/files/`](../workspace-defaults/files/), where
the parity test, bootstrap script, and runtime composer all read from a
single source of truth.

The directory is left in place as a stub so the burn-in deploy doesn't trip
on a path-filter race; **U28 deletes it entirely**.

If you came here looking to edit one of the four files above, edit the copy
in `packages/workspace-defaults/files/` instead.
