# Desktop Pi RedTeam Catalog Conversion

Date: 2026-06-01

The RedTeam starter pack is now Desktop Pi-compatible by default. The catalog
still preserves historical case names, categories, and `target_surface` values
so seeded rows and trend history remain recognizable, but every enabled case now
declares the Desktop Pi execution contract it expects.

## Decisions

- Keep `target_surface: "computer"` for historical continuity. In Desktop Pi
  runs, those cases are `desktop_pi_target: "workspace-artifact"` and measure the
  local Pi agent's artifact/workspace behavior, not the retired Computer runtime.
- Add `desktop_pi_compatible: true`, `desktop_pi_target`,
  `desktop_pi_tooling`, `desktop_pi_credentials`, and `tags` to all 189 seed
  cases.
- Rewrite legacy "Computer" wording in prompts, expectations, and rubrics to
  Desktop Pi language. Case names remain stable even when they contain
  `red-team-computer-*`.
- Treat GitHub skill cases as connector-absent Desktop Pi tests by default:
  `desktop_pi_target: "github-skill-unavailable"` and
  `desktop_pi_credentials: "github-credentials-not-present"`.
- Treat filesystem skill cases as contained workspace tests. Desktop Pi has Pi
  file tools and host-owned `just-bash` in `/workspace`, not arbitrary host
  filesystem access.
- Treat workspace skill cases as hydrated Agent/User/Space context tests.
  Workspace files and memory are context, not authority or tenant-wide admin
  capability.

## Invariant Gate

`seeds/eval-test-cases/__tests__/shape-invariants.test.ts` now enforces:

- the catalog still contains 189 expected RedTeam seed cases;
- every case declares Desktop Pi compatibility metadata;
- tags include `desktop-pi`, `surface:*`, `category:*`, and `desktop-target:*`;
- GitHub skill cases explicitly encode absent GitHub credentials;
- authored prompt, expectation, and assertion prose does not refer to legacy
  `Computer` or `AgentCore` assumptions;
- authored prose does not require native macOS shell, host shell, or `/Users/*`
  host-file access.

## Editing Guidance

When adding or changing cases, decide the Desktop Pi target first:

- `local-agent` for policy/refusal/scope behavior that needs no external tool.
- `workspace-artifact` for generated artifact or applet requests handled through
  the local Pi agent.
- `local-workspace-filesystem` for contained `/workspace` file and `just-bash`
  behavior.
- `github-skill-unavailable` when the safe behavior depends on absent connector
  credentials or missing GitHub MCP tools.
- `hydrated-workspace-context` for Agent/User/Space files and memory context.

Cases may ask for prohibited behavior, but their expected behavior and rubrics
must make the Desktop Pi boundary explicit: refuse, ask for authorization,
scope the request, or offer a safe alternative.
