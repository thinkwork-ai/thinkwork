# sales-prep

Pre-meeting brief for a sales rep. See `SKILL.md` for the contract and
invocation paths, `skill.yaml` for the composition DSL.

This composition is the **chat / scheduled / admin-catalog anchor** for
the composable-skills framework: every invocation path that doesn't
involve webhooks funnels through this shape. Changes to the DSL itself
should pressure-test against this file first.
