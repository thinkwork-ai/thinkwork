# skill-catalog

Canonical source of truth for ThinkWork's skill catalog. Every directory
here is one skill — a `SKILL.md` (frontmatter metadata + prose body),
optional `scripts/`, `prompts/`, or `references/`. The deploy's
`bootstrap-workspaces` step syncs all of them into the `skill_catalog`
database table and uploads the file contents to S3.

Plan 2026-04-24-009 §U2 retired the parallel `skill.yaml` manifest;
SKILL.md frontmatter is the single canonical source for both the
catalog metadata (category, tags, requires_env, etc.) and the
behavioral contract (execution, mode, scripts, inputs, triggers).

## Supported skill shapes

Post plan #007 §U6 the runtime supports exactly two execution modes:

- **`execution: script`** — the skill ships a `scripts/entrypoint.py`
  exposing `def run(**kwargs) -> dict`. The unified dispatcher (plan
  §U4, `skill_dispatcher.dispatch_skill_script`) runs it inside a
  pooled AgentCore Code Interpreter session. Deterministic, no LLM.
- **`execution: context`** — the skill ships a `SKILL.md` body. The
  agent loop loads the body on demand through the `Skill` meta-tool
  (plan §U5) when the model calls `Skill(name="<slug>", args=…)`.
  Deliverable-shape skills (`sales-prep`, `renewal-prep`, etc.)
  coordinate their sub-skills by making nested `Skill()` calls from
  inside their SKILL.md instructions.

Any other `execution:` value is treated as a catalog regression —
`scripts/u8-status.ts` reports a non-empty `regressed` bucket, and
`scripts/validate-skill-catalog.sh` rejects the slug at CI time.

## Computer runbook-capable skills

Some context skills are also routable by Thinkwork Computer as
substantial-work runbooks. They are still normal Agent Skills: `SKILL.md`
is the required entrypoint, with optional `references/`, `assets/`, and
`scripts/` folders. The Computer-specific contract is deliberately small
and lives in standard skill extension space instead of a parallel
`runbook.yaml` file.

Mark a skill as Computer-runbook-capable with:

```yaml
metadata:
  thinkwork_kind: computer-runbook
```

The marker requires a machine-readable contract at
`references/thinkwork-runbook.json` unless
`metadata.thinkwork_runbook_contract` points at another relative path.
That contract contains only the fields Computer needs before loading the
whole skill: routing aliases/examples, confirmation copy, phase ids and
titles, phase guidance references, task seeds, expected outputs,
capability roles, and optional output-shaping asset references.

Detailed instructions stay out of the JSON contract. Put phase prose in
focused files such as `references/discover.md`,
`references/analyze.md`, `references/produce.md`, and
`references/validate.md`. Put output schemas, example payloads,
templates, screenshots, or other shaping material under `assets/`.

Validate the contract with `validateRunbookSkillContract` from
`scripts/runbook-skill-contract.ts`. The validator fails closed when the
marker is present but the contract is missing, references files outside
the skill directory, references missing phase/assets files, or requests a
capability role outside the platform registry. `allowed-tools` remains
advisory; runtime capability enforcement is owned by the Computer
execution path.

## Authoring a new skill

1. Pick the shape. If the skill's behavior is deterministic code,
   ship a `scripts/` folder with an `entrypoint.py` and set
   `execution: script`. If it's model-driven reasoning, write a
   `SKILL.md` and set `execution: context`.
2. Declare typed `inputs` in the SKILL.md frontmatter. The dispatcher /
   scheduled job / admin catalog resolves values into these shapes
   before calling `startSkillRun`.
3. If the skill references other skills, list them under
   `requires_skills:` so the template session allowlist includes
   them. Nested `Skill(...)` calls rely on this for authorization.
4. Run `scripts/validate-skill-catalog.sh` locally to surface schema
   issues before opening a PR.

See `sales-prep/`, `account-health-review/`, `renewal-prep/`, and
`customer-onboarding-reconciler/` for deliverable-shape worked
examples. `frame/`, `synthesize/`, `package/` are sub-skill primitives
those four invoke through the meta-tool.

## Tests

Per-slug structural tests live under `<slug>/tests/`. The umbrella
audit (`pnpm exec tsx packages/skill-catalog/scripts/u8-status.ts`)
runs in CI and refuses a merge with any regressed slug.
