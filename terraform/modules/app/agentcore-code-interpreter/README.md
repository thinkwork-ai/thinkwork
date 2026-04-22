# `agentcore-code-interpreter` — stage-level base image substrate

Stage-scoped artifacts for the AgentCore Code Interpreter sandbox. **Per-tenant
Code Interpreter instances are created at runtime** by the `agentcore-admin`
Lambda (see `docs/adrs/per-tenant-aws-resource-fanout.md`) — this module
stops at the substrate everything else depends on.

## What it creates

- **ECR repository** `thinkwork-{stage}-sandbox-base` — immutable tags, last 10
  kept, scan-on-push.
- **Outputs** consumed by downstream modules + the provisioning Lambda:
  - `ecr_repository_url` — where the blessed image lives.
  - `environment_ids` + `environments` — the v1 environment catalog (`default-public`,
    `internal-only`) with network modes.
  - `tenant_role_trust_policy_template` / `tenant_role_inline_policy_template` —
    JSON templates the provisioning Lambda substitutes `{tenant_id}` into at
    `CreateRole` time (plan Unit 5).

## Files

| File | Purpose |
|---|---|
| `main.tf` | ECR + outputs. No per-tenant resources. |
| `Dockerfile.sandbox-base` | Python 3.12 + pinned libs + `sitecustomize.py`. Build context is the **repo root** so the COPY can reach `packages/agentcore-strands/agent-container-sandbox/sitecustomize.py`. |
| `scripts/build_and_push_sandbox_base.sh` | CI builds + pushes. Not called from Terraform — image lifecycle is a reviewable-PR concern. |

The Python source `sitecustomize.py` and its pytest suite `test_sitecustomize.py`
live under `packages/agentcore-strands/agent-container-sandbox/` (colocated with
the rest of the Strands agent-container Python, per handoff P2 #10). That's
where `uv run pytest` finds them without extra config.

## What this module does **not** do

- Create per-tenant Code Interpreter instances — that's Unit 5 (agentcore-admin Lambda).
- Build or push the Docker image — that's CI, via the shell script above.
- Grant the provisioning Lambda IAM permissions on the new resources — that's added in Unit 5 when the Lambda resource lands.

## Bumping the image

1. Edit `Dockerfile.sandbox-base` (pin a new pandas / add a lib / etc.).
2. Edit `packages/agentcore-strands/agent-container-sandbox/sitecustomize.py` if the R13 invariant or its coverage gaps shift.
3. PR. CI runs `pytest` on the scrubber plus a build-then-startup-assertion smoke test.
4. After merge, `build_and_push_sandbox_base.sh` tags with the merge-commit SHA.

## Named residual

The R13 invariant this module's scrubber enforces is **honestly scoped** to
Python-stdio-mediated writes + known-shape CloudWatch patterns. See the
brainstorm and the `sitecustomize.py` module docstring for the full list of
stdio-bypass classes (os.write, subprocess env dumps, C-extension direct
writes, multiprocessing workers, adversarial split-writes) that the Unit 12
pattern backstop catches partially and the v2 in-process credential proxy
addresses structurally.
