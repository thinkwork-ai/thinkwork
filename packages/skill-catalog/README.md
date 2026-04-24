# skill-catalog

Canonical source of truth for ThinkWork's skill catalog. Every directory
here is one skill — a `skill.yaml` manifest plus a `SKILL.md`, optional
`scripts/`, `prompts/`, or `references/`. The deploy's
`bootstrap-workspaces` step syncs all of them into the `skill_catalog`
database table and uploads the file contents to S3.

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

## Authoring a new skill

1. Pick the shape. If the skill's behavior is deterministic code,
   ship a `scripts/` folder with an `entrypoint.py` and set
   `execution: script`. If it's model-driven reasoning, write a
   `SKILL.md` and set `execution: context`.
2. Declare typed `inputs` in `skill.yaml`. The dispatcher / scheduled
   job / admin catalog resolves values into these shapes before
   calling `startSkillRun`.
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
