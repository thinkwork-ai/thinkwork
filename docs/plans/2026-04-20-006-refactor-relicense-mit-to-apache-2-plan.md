---
title: Relicense thinkwork from MIT to Apache 2.0
type: refactor
status: active
date: 2026-04-20
---

# Relicense thinkwork from MIT to Apache 2.0

## Overview

Switch the repo's open-source license from MIT to Apache 2.0 while Eric is still the sole copyright holder. The mechanics are a handful of file edits (LICENSE text, SPDX identifiers, README/doc references) plus an Apache-required `NOTICE` file. Also update `CONTRIBUTING.md` to describe a Contributor License Agreement (CLA) requirement so the project is posture-ready for external PRs. The actual CLA tooling install (CLA Assistant GitHub App + signature workflow) is deferred to a separate task — we want the license change landed immediately, and the CLA gate needs to be live only before the first external PR.

## Problem Frame

Apache 2.0 is strictly preferable for thinkwork's intended audience (AWS-shop enterprise adopters) because of its explicit patent grant — MIT's silence on patents is a known friction point in enterprise procurement. The window to do this unilaterally is now: `git log --all` shows a single author, so we own 100% of copyright and no contributor CLA/consent drill is required. The moment an external contributor pushes code under MIT, relicensing becomes a coordination problem. So the technical execution is mechanical, but the timing matters.

## Requirements Trace

- R1. Repo-root `LICENSE` is the canonical Apache 2.0 text with a correct copyright line.
- R2. All per-package `LICENSE` files match R1.
- R3. All SPDX license identifiers in package manifests (`package.json`, `pyproject.toml`) read `Apache-2.0`.
- R4. All narrative/badge references to "MIT" in README, docs, and example SKILL files are updated.
- R5. Repo-root `NOTICE` exists per Apache 2.0 convention.
- R6. `CONTRIBUTING.md` reflects the new license and describes the CLA requirement.
- R7. A single squashable commit ("Relicense from MIT to Apache 2.0") makes the change auditable.

## Scope Boundaries

- **Not a goal:** Changing any runtime, infrastructure, or test behavior.
- **Not a goal:** Touching third-party `LICENSE` files under `node_modules/` or `apps/mobile/ios/Pods/`.
- **Not a goal:** Editing `apps/mobile/public/styles.css` — the `/*! tailwindcss v3.4.19 | MIT License | https://tailwindcss.com*/` banner is Tailwind's upstream attribution in compiled output, not our license declaration, and must stay MIT.
- **Not a goal:** Changing `packages/skill-catalog/**/SKILL.md` files — those declare `license: Proprietary` and should remain so.
- **Not a goal:** Re-licensing forks/clones that third parties already pulled under MIT. Those copies stay MIT forever; our going-forward license is what changes.

### Deferred to Separate Tasks

- **CLA tooling install**: Set up CLA Assistant (or EasyCLA) GitHub App and wire a `.github/workflows/cla.yml` or equivalent to gate PRs on signature. Deferred to a follow-up; must land before merging the first external PR.
- **Copyright holder normalization across the broader codebase** (if any source-file headers get added later): Not in scope here — we only update license files and manifest metadata.

## Context & Research

### Relevant Files Touched

- `LICENSE` — MIT text, `Copyright (c) 2026 thinkwork-ai`
- `packages/react-native-sdk/LICENSE` — MIT text, `Copyright (c) 2026 ThinkWork, Inc.` (inconsistent with root — normalize to `thinkwork-ai`)
- `package.json` — `"license": "MIT"`
- `packages/react-native-sdk/package.json` — `"license": "MIT"`
- `apps/cli/package.json` — `"license": "MIT"`
- `pyproject.toml` — `license = { text = "MIT" }`
- `README.md:11` — shield badge `license-MIT-blue.svg`
- `README.md:110` — `MIT — see [LICENSE](./LICENSE).`
- `apps/cli/README.md:284` — `MIT`
- `docs/src/content/docs/roadmap.mdx:97` — `ThinkWork is MIT licensed and open source.`
- `CONTRIBUTING.md:20-21` — DCO sign-off requirement (`git commit -s`)
- `CONTRIBUTING.md:68-70` — `By contributing, you agree that your contributions will be licensed under the MIT license...`
- `examples/skill-pack/github-issues/SKILL.md:6` — `license: MIT`
- `examples/skill-pack/calculator/SKILL.md:6` — `license: MIT`
- `examples/connector-recipe/skill/SKILL.md:6` — `license: MIT`

### External References

- Canonical Apache 2.0 text: `https://www.apache.org/licenses/LICENSE-2.0.txt`
- Apache `NOTICE` file convention: project name + copyright line; referenced by §4(d) of the license.
- SPDX identifier registry: `Apache-2.0` (correct form for `package.json` and `pyproject.toml`).

## Key Technical Decisions

- **CLA-only, drop DCO.** The current `CONTRIBUTING.md` requires DCO sign-off (`git commit -s`). User's own legal framing: "For a project with commercial aspirations, CLA alone is cleaner." Drop the DCO sign-off line; describe the CLA requirement instead. This simplifies the contributor story to one mechanism.
- **Normalize copyright holder to `thinkwork-ai`.** The root LICENSE says `thinkwork-ai`; the react-native-sdk LICENSE says `ThinkWork, Inc.`. There is no `ThinkWork, Inc.` legal entity referenced elsewhere in the repo, and `package.json` consistently uses `thinkwork-ai`. Align both LICENSE copyright lines and the NOTICE file to `thinkwork-ai` for now. If a legal entity is later formalized, update then.
- **Apache 2.0 text is verbatim from apache.org.** Do not hand-edit. Fetch once, write identically to both LICENSE files. The copyright line for the Apache 2.0 "APPENDIX" goes in `NOTICE`, not inside the license text itself.
- **SPDX identifier is `Apache-2.0`, not `"Apache 2.0"` or `"Apache License 2.0"`.** Spec requires the registry form.
- **Squash to one commit** titled `chore: relicense from MIT to Apache 2.0`. Easier to cite, revert, or reference in future provenance discussions. (Type `chore` is the most honest — no behavior change, no bug fix, no refactor of code.)

## Open Questions

### Resolved During Planning

- **CLA-only vs DCO+CLA?** → CLA-only (per user's commercial-posture preference).
- **Which copyright name?** → `thinkwork-ai` everywhere.
- **Is the CLA GitHub App install in scope for this plan?** → No, deferred. The license switch is self-contained; CLA tooling is its own follow-up.

### Deferred to Implementation

- **Exact CLA tool** (CLA Assistant vs EasyCLA): picked at the CLA follow-up task, not here.
- **Whether to backdate the copyright line range** (e.g. "Copyright 2025-2026") once real external contributions start: not needed yet.

## Implementation Units

- [ ] **Unit 1: Replace both LICENSE files with Apache 2.0 text**

**Goal:** Make the LICENSE files the canonical Apache 2.0 License text, identically.

**Requirements:** R1, R2

**Dependencies:** None.

**Files:**
- Modify: `LICENSE`
- Modify: `packages/react-native-sdk/LICENSE`

**Approach:**
- Fetch canonical text from `https://www.apache.org/licenses/LICENSE-2.0.txt` once; write that exact text to both files.
- Do NOT put the per-project copyright line inside the LICENSE body. Apache 2.0's text is verbatim; the project-specific copyright goes in `NOTICE`.
- Both files must be byte-identical so tooling that fingerprints licenses (e.g., GitHub's license detector, `license-checker`) sees them as the same license.

**Test scenarios:**
- Happy path: `LICENSE` starts with `                                 Apache License\n                           Version 2.0, January 2004`.
- Happy path: `diff LICENSE packages/react-native-sdk/LICENSE` produces no output.
- Integration: GitHub's license detector (visible on the repo home page after merge) shows `Apache-2.0`.

**Verification:**
- Both files are identical to the canonical Apache 2.0 text.
- No stray "MIT" substring remains in either file.

---

- [ ] **Unit 2: Add repo-root NOTICE file**

**Goal:** Satisfy Apache 2.0 §4(d), which requires downstream redistributors to carry the upstream NOTICE.

**Requirements:** R5

**Dependencies:** Unit 1 (logical ordering — NOTICE references the license we just swapped in).

**Files:**
- Create: `NOTICE`

**Approach:**
- Minimal, conventional content:
  ```
  Thinkwork
  Copyright 2026 thinkwork-ai

  This product includes software developed by thinkwork-ai
  (https://thinkwork.ai).
  ```
- Keep it short. NOTICE is a legal artifact, not a credits page. Long NOTICE files become a maintenance burden because every downstream redistributor must carry them.
- Do NOT include third-party acknowledgements here — those live in dependency manifests and the downstream distribution's own NOTICE if they choose to generate one.

**Test scenarios:**
- Happy path: `NOTICE` exists at repo root and contains the project name + copyright line.

**Verification:**
- File exists, is under 10 lines, and is referenced by Apache §4(d) semantics.

---

- [ ] **Unit 3: Update license metadata in package manifests**

**Goal:** Every published package manifest declares `Apache-2.0` as its SPDX identifier so npm, PyPI, and downstream tooling report the correct license.

**Requirements:** R3

**Dependencies:** Unit 1 (so the declared license matches the LICENSE file content).

**Files:**
- Modify: `package.json`
- Modify: `packages/react-native-sdk/package.json`
- Modify: `apps/cli/package.json`
- Modify: `pyproject.toml`

**Approach:**
- JSON files: change `"license": "MIT"` → `"license": "Apache-2.0"`. Preserve existing key ordering and formatting (prettier will normalize on next `pnpm format`).
- `pyproject.toml`: change `license = { text = "MIT" }` → `license = { text = "Apache-2.0" }`.
- Use the exact SPDX identifier `Apache-2.0` — not `"Apache 2.0"` or `"Apache License 2.0"`. npm and pip-audit rely on SPDX registry form.

**Test scenarios:**
- Happy path: `grep -r '"license"' --include=package.json` shows only `"Apache-2.0"` at thinkwork-owned paths (root + apps/cli + packages/react-native-sdk). `node_modules/**` hits are ignored as third-party.
- Happy path: `grep license pyproject.toml` shows `Apache-2.0`.
- Edge case: `pnpm install` still resolves without warnings (SPDX validator in npm is tolerant of casing but we match the registry form exactly).

**Verification:**
- All 4 manifests declare `Apache-2.0`.
- No thinkwork-owned manifest still declares `MIT`.

---

- [ ] **Unit 4: Update license references in README, docs, and example skill metadata**

**Goal:** Human-readable license references match the new license everywhere a reader might look.

**Requirements:** R4

**Dependencies:** Units 1 and 3 (so the badge/text matches what's actually there).

**Files:**
- Modify: `README.md` (line 11 badge URL; line 110 license section text)
- Modify: `apps/cli/README.md` (line 284)
- Modify: `docs/src/content/docs/roadmap.mdx` (line 97)
- Modify: `examples/skill-pack/github-issues/SKILL.md` (frontmatter `license:` field)
- Modify: `examples/skill-pack/calculator/SKILL.md` (frontmatter `license:` field)
- Modify: `examples/connector-recipe/skill/SKILL.md` (frontmatter `license:` field)

**Approach:**
- `README.md` badge: change `license-MIT-blue.svg` → `license-Apache%202.0-blue.svg`. The `%20` is required — shields.io URL-encodes spaces. Alt text: change `alt="license"` is fine; don't invent one.
- `README.md` License section text: change `MIT — see [LICENSE](./LICENSE).` → `Apache 2.0 — see [LICENSE](./LICENSE) and [NOTICE](./NOTICE).`
- `apps/cli/README.md`: change bare `MIT` line to `Apache 2.0 — see [LICENSE](../../LICENSE).`
- `roadmap.mdx`: change `ThinkWork is MIT licensed and open source.` → `ThinkWork is Apache 2.0 licensed and open source.`
- Example SKILL files: change frontmatter `license: MIT` → `license: Apache-2.0` (SPDX form, matches how other SKILL files declare `license: Proprietary`).

**Test scenarios:**
- Happy path: `grep -RIn "MIT" README.md apps/cli/README.md docs/src/content/docs/roadmap.mdx` returns no matches.
- Happy path: All three example SKILL files have `license: Apache-2.0` in frontmatter.
- Edge case: The compiled Tailwind output in `apps/mobile/public/styles.css` still contains `tailwindcss v3.4.19 | MIT License` — this is third-party upstream attribution and must NOT be changed. Verify manually that the grep sweep excluded this path.
- Integration: README renders on GitHub with the new badge (visual check after merge).

**Verification:**
- No thinkwork-owned markdown file references MIT as the project license.
- Third-party MIT attribution (Tailwind in styles.css, any `node_modules/**` licenses) is untouched.

---

- [ ] **Unit 5: Update CONTRIBUTING.md — drop DCO, add CLA requirement, update license line**

**Goal:** Contributors reading CONTRIBUTING.md understand (a) the project is Apache 2.0, (b) they must sign a CLA before their PR can merge, and (c) they no longer need DCO `-s` sign-off.

**Requirements:** R6

**Dependencies:** Units 1, 3, 4 (license needs to exist before docs describe it).

**Files:**
- Modify: `CONTRIBUTING.md`

**Approach:**
- In the "Before opening a PR" section, remove the DCO bullet (currently line 21: `Sign your commits (git commit -s) — we use the Developer Certificate of Origin.`). Renumber the remaining bullets.
- Add a new section titled `## Contributor License Agreement (CLA)` above the License section. Content:
  - State that all contributors must sign the project's CLA before their PR can be merged.
  - Note that the CLA is administered via an automated bot (CLA Assistant) that will comment on PRs with a signing link.
  - Acknowledge that the tooling is being set up — until it's live, no external PRs will be merged.
- In the "License" section, change the MIT reference: `By contributing, you agree that your contributions will be licensed under the MIT license that covers the project.` → `By contributing, you agree that your contributions will be licensed under the Apache License 2.0 that covers the project, subject to the terms of the CLA.`

**Test scenarios:**
- Happy path: `CONTRIBUTING.md` no longer mentions `DCO`, `Developer Certificate of Origin`, or `git commit -s`.
- Happy path: `CONTRIBUTING.md` contains a `## Contributor License Agreement` section.
- Happy path: License section references Apache License 2.0.
- Edge case: The file still parses as markdown (headings, bullets, numbered lists render correctly).

**Verification:**
- Reader who has never seen the repo understands the CLA requirement and sees no stale DCO instructions.

## System-Wide Impact

- **Interaction graph:** None. No runtime or infra code touched.
- **API surface parity:** The SPDX license field in `package.json` and `pyproject.toml` is part of the public package metadata surface. Downstream consumers reading license metadata (corporate SBOM scanners, `license-checker`, etc.) will see `Apache-2.0`. That is the whole point.
- **State lifecycle risks:** None.
- **Unchanged invariants:**
  - Runtime behavior, APIs, and infra are unchanged.
  - Third-party MIT-licensed bundled content (Tailwind banner in compiled CSS, vendored code under `node_modules/` and `apps/mobile/ios/Pods/`) is intentionally not modified.
  - `packages/skill-catalog/**/SKILL.md` proprietary declarations are unchanged.
  - Copies of the repo that third parties already pulled under MIT remain MIT — this plan does not (and cannot) retroactively change those.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A residual "MIT" reference in a file we didn't audit | After implementation, run `grep -RIn -w "MIT" --exclude-dir=node_modules --exclude-dir=.claude --exclude-dir=dist --exclude-dir=ios/Pods .` and review every remaining hit before opening the PR. Expected surviving hits: the Tailwind banner in `apps/mobile/public/styles.css` and `packages/skill-catalog/**` proprietary declarations (neither is an MIT declaration of ours). |
| An external contributor opens a PR before the CLA bot is wired up | Hold external PRs until CLA tooling (deferred follow-up) lands. In the meantime, the CONTRIBUTING.md CLA section sets expectations. This is low-probability: the repo is pre-release (`v0.0.0`, roadmap marked "🚧 Pre-release"). |
| Badge cache on README shows MIT briefly after merge | Cosmetic; resolves within minutes as shields.io regenerates. |
| The `ThinkWork, Inc.` language in the old react-native-sdk LICENSE implied a legal entity that doesn't exist | Normalizing to `thinkwork-ai` is consistent with the rest of the repo. If a real legal entity is formed later, update copyright lines in a follow-up commit. |

## Documentation / Operational Notes

- No release notes impact yet (pre-v0.1.0). When v0.1.0 ships, mention Apache 2.0 in the release announcement — enterprise adopters will care.
- The CLA follow-up task should include: GitHub App install (CLA Assistant or EasyCLA), a `.github/workflows/cla.yml` (or equivalent), a signatures storage repo/branch, and a lightweight CLA text (adapted from the Apache ICLA or Google's template). Link back to this plan from that task's description.
- No rollback concern — relicensing is a forward-only legal declaration. If ever reversed, that would require its own (much more complex) plan once contributors exist.

## Sources & References

- Feature description in the ce-plan invocation (user-provided legal reasoning).
- Canonical Apache 2.0 text: `https://www.apache.org/licenses/LICENSE-2.0.txt`
- SPDX registry: `Apache-2.0` identifier.
- `git log --all --pretty=format:'%an' | sort -u` confirms single contributor (Eric / Eric Odom) — sole copyright, unilateral relicensing is valid.
