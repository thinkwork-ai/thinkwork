---
title: Stand up CLA Assistant gate on PRs
type: feat
status: active
date: 2026-04-20
---

# Stand up CLA Assistant gate on PRs

## Overview

Wire up automated Contributor License Agreement gating on pull requests. This is the deferred follow-up explicitly called out in the relicense plan (`docs/plans/2026-04-20-006-refactor-relicense-mit-to-apache-2-plan.md`). Three small artifacts plus one operational step:

1. `CLA.md` at repo root (Apache ICLA, lightly adapted to `thinkwork-ai`)
2. `.github/workflows/cla.yml` running the canonical CLA Assistant action, **pinned by commit SHA** to `v2.6.1` of `contributor-assistant/github-action`
3. An empty, unprotected `cla-signatures` branch where the action stores `signatures/version1/cla.json`
4. `CONTRIBUTING.md` updated to replace the "being set up" placeholder with live signing instructions

After merge, the maintainer opens a trivial test PR, signs the CLA via the bot's prompt, and confirms the gate works end-to-end. The first signature on file should be the maintainer's — that's the proof the system works *and* a sane legal record if ownership ever transfers.

## Problem Frame

Apache 2.0 (just adopted in PR #313) gives downstream users a patent grant. The CLA gives the project the right to *redistribute* contributors' work under that license — and to relicense it later if commercial requirements demand. Without a CLA in place, every external contributor's first commit is a coordination problem the project cannot solve unilaterally. The window to wire this up is right now: pre-release, no external contributors yet, but the relicense PR has already advertised a CLA requirement in CONTRIBUTING.md. Closing the gap between "we say we require a CLA" and "we actually enforce one" is the entire point of this plan.

## Requirements Trace

- R1. A `CLA.md` exists at repo root containing legally usable CLA text adapted from the Apache ICLA.
- R2. A GitHub Actions workflow at `.github/workflows/cla.yml` runs the CLA Assistant action against every PR.
- R3. The workflow is pinned to a specific commit SHA (not a tag) for the upstream-archived action, with an inline comment explaining the pin and the fork-when-broken contingency.
- R4. The signature store branch `cla-signatures` exists, is empty (no protection), and is named explicitly in the workflow.
- R5. `CONTRIBUTING.md` no longer says "being set up" — it points at `CLA.md` and describes how the bot works.
- R6. Bot accounts (`dependabot[bot]`, `renovate[bot]`) are allowlisted; humans (including the maintainer) are not.
- R7. End-to-end verification: a test PR triggers the bot comment, the maintainer signs it via the canonical phrase, the check turns green, and a row appears in `signatures/version1/cla.json` on the `cla-signatures` branch.

## Scope Boundaries

- **Not a goal:** Corporate CLA (CCLA) workflow. Add when an enterprise contributor needs it.
- **Not a goal:** CLA versioning tooling. The migration path (bump `path-to-signatures` to `signatures/version2/cla.json` to force re-signing) is documented in the workflow file as a comment, but no code or scripting for it lands here.
- **Not a goal:** Auto-signing the maintainer. Self-signing once on the test PR is the verification.
- **Not a goal:** Custom signing phrase. The action's default ("I have read the CLA Document and I hereby sign the CLA") is the convention.
- **Not a goal:** Re-verifying that the relicense PR fully removed DCO. Already confirmed.

### Deferred to Separate Tasks

- **Legal review of `CLA.md`**: ~30 minutes with an attorney is recommended before the project takes its first external contribution. Tracked as a deployment note, not as an implementation unit. The plan ships a workable Apache ICLA adaptation that can serve as the lawyer's input draft.
- **CCLA + signature versioning workflow**: deferred to a future plan when an actual enterprise contribution arrives.
- **Forking `contributor-assistant/github-action`**: deferred until / unless v2.6.1 actually breaks against a GitHub API change. Calling out the trigger now.

## Context & Research

### Relevant Code and Patterns

- Existing workflows under `.github/workflows/` (lint.yml, test.yml, typecheck.yml, deploy.yml, release.yml, publish-sdk.yml). Conventions: top-level `name:` in title-case, `on: pull_request:` triggers, `runs-on: ubuntu-latest`, action versions pinned by major (e.g., `actions/checkout@v4`). The CLA workflow follows the same shape but additionally pins by SHA (rationale: upstream is archived, so a major-version pin gives no semver guarantees).
- `CONTRIBUTING.md:67-73` currently has a placeholder CLA section reading "tooling is being set up." This block is replaced by Unit 3.
- `README.md:100-102` Contributing section links to `CONTRIBUTING.md` — no edit needed; the link continues to surface the CLA flow via CONTRIBUTING.

### Institutional Learnings

- `feedback_pr_target_main.md`: PRs target `main`, never stack. Applies here — this is one PR, no stacking.
- `feedback_worktree_isolation.md`: Use a `.claude/worktrees/<name>` off `origin/main`. Applies during execution.

### External References

- [contributor-assistant/github-action](https://github.com/contributor-assistant/github-action) — archived March 2026, last release `v2.6.1` Sept 2024, 341 stars. Verified.
- v2.6.1 commit SHA: `ca4a40a7d1004f18d9960b404b97e5f30a505a08` (resolved via `gh api repos/contributor-assistant/github-action/git/refs/tags/v2.6.1`).
- [Apache Individual CLA template](https://www.apache.org/licenses/contributor-agreements.html#clas) — source for `CLA.md` adaptation.
- [SiliconLabsSoftware/action-cla-assistant](https://github.com/SiliconLabsSoftware/action-cla-assistant) — vendor-internal fork, 1 star, no releases. **Not a viable successor.** Surfacing only to document why we did not adopt it.

## Key Technical Decisions

- **Pin by SHA, not by tag.** `contributor-assistant/github-action@ca4a40a7d1004f18d9960b404b97e5f30a505a08 # v2.6.1`. Cryptographic stability against the archived upstream. Tag-based pins on archived repos can technically be force-moved by the owner; SHA pins cannot. This is the only workflow in the repo that pins by SHA — that's intentional, not a new convention.
- **Apache ICLA, lightly adapted.** Verbatim Apache ICLA legal language with two surgical changes: (1) "the Foundation" → `thinkwork-ai`; (2) preamble paragraph added stating that *"posting the canonical signing phrase as a comment on a pull request thread constitutes signing this Agreement,"* so the digital workflow is unambiguous against ICLA's mail-based default.
- **ICLA only, no CCLA yet.** Pre-release simplicity. Enterprise contributors will surface the CCLA need; building it pre-need is YAGNI.
- **Maintainer is NOT in the allowlist.** Eric signs the CLA once on the verification test PR. Three reasons: (1) it proves the system works under realistic conditions; (2) creates a signature record for the project owner — sound legal hygiene if ownership ever transfers; (3) the friction is *one* one-line PR comment, ever.
- **Allowlist `dependabot[bot]` and `renovate[bot]` only.** These aren't humans and can't sign anything. No other bots are configured today.
- **`GITHUB_TOKEN` is sufficient.** Signatures live in the same repo, so no PAT is required. Avoids a long-lived secret.
- **`pull_request_target` trigger is safe here.** The action only reads PR metadata (author, title, comments). It never checks out PR code. The well-known security risk of `pull_request_target` (running malicious PR code with elevated privileges) does not apply.
- **Workflow-level permissions block, not repo-wide changes.** The workflow YAML declares `actions: write`, `contents: write`, `pull-requests: write`, `statuses: write`. This overrides the repo-default `GITHUB_TOKEN` permissions even when the repo's default is "read-only." No GitHub Settings change required for the common case.
- **Signing phrase = action default.** "I have read the CLA Document and I hereby sign the CLA" — the industry-standard phrase. Customizing buys nothing and breaks contributor expectations.
- **`path-to-document` points at the `main` blob URL.** Standard; the CLA file is part of the repo, version-controlled. If the CLA ever changes substantively, bump `path-to-signatures` to `signatures/version2/cla.json` to force everyone to re-sign. Documented as a comment in the workflow.

## Open Questions

### Resolved During Planning

- **Which CLA Assistant variant?** → Original `contributor-assistant/github-action`, SHA-pinned at v2.6.1. Verified the touted active fork (SiliconLabsSoftware) is not a real successor.
- **Which CLA text source?** → Apache ICLA, surgically adapted.
- **ICLA only or ICLA + CCLA?** → ICLA only.
- **Allowlist policy?** → Bots only; maintainer signs once.
- **Signing-phrase customization?** → Use action default.
- **`GITHUB_TOKEN` vs PAT?** → `GITHUB_TOKEN`.
- **Where to host CLA.md?** → Repo root, `main` blob URL.

### Deferred to Implementation

- **Exact wording of the preamble paragraph in CLA.md** describing comment-as-signature semantics. The intent is settled (Key Decisions); the exact prose is a 60-second drafting task at execution time.
- **Whether the workflow needs a `concurrency:` block** to deduplicate runs when a contributor pushes rapid-fire commits. Will know after observing the first real PR; trivial to add in a follow-up if signal-to-noise gets bad.

## Implementation Units

- [ ] **Unit 1: Add CLA.md at repo root**

**Goal:** Provide legally usable CLA text that the bot can link to and contributors can read before signing.

**Requirements:** R1

**Dependencies:** None.

**Files:**
- Create: `CLA.md`

**Approach:**
- Start from the canonical Apache Individual Contributor License Agreement template at `https://www.apache.org/licenses/contributor-agreements.html#clas`. Use the verbatim legal sections (definitions, grant of copyright license, grant of patent license, representations, etc.).
- Replace every reference to "the Foundation" or "Apache Software Foundation" with `thinkwork-ai`.
- Add a short preamble paragraph (above the legal text) stating: project name, that the CLA covers all contributions, **and that posting the canonical signing phrase as a comment on a pull request thread constitutes signing this Agreement.** This last clause closes the gap between ICLA's mail-based default and the digital workflow CLA Assistant uses.
- Do NOT include corporate CLA language (the "Schedule A" listing employees, etc.) — that's CCLA territory and out of scope.
- Plain markdown. No frontmatter. Bot-friendly: avoid HTML or fenced code that might confuse the renderer in PR comments.

**Patterns to follow:**
- Apache ICLA structure: numbered sections, short paragraphs, preamble first.
- Existing repo doc tone: terse, direct, no marketing.

**Test scenarios:**
- Happy path: `CLA.md` exists, renders cleanly on `https://github.com/thinkwork-ai/thinkwork/blob/main/CLA.md`, and contains the project name `thinkwork-ai` (not "the Foundation" or placeholder text).
- Happy path: Preamble explicitly states that comment-as-signature constitutes signing.
- Edge case: No remaining "Apache Software Foundation" or "Foundation" string survives the adaptation.

**Verification:**
- Reading the file end-to-end, a contributor understands what they are signing and how to sign it.

---

- [ ] **Unit 2: Add `.github/workflows/cla.yml` (CLA Assistant gate workflow)**

**Goal:** Every pull request triggers the CLA Assistant action; PRs from unsigned authors get a bot comment and a failing check until signed.

**Requirements:** R2, R3, R4, R6

**Dependencies:** Unit 1 (the workflow's `path-to-document` URL must resolve to a real file once the PR merges).

**Files:**
- Create: `.github/workflows/cla.yml`

**Approach:**
- Follow the shape of existing workflows (`.github/workflows/lint.yml`, `test.yml`): top-level `name:`, `on:` triggers, single `runs-on: ubuntu-latest` job.
- Triggers: `pull_request_target` (types `opened`, `synchronize`) and `issue_comment` (type `created`). Justification for `pull_request_target`: the action reads PR metadata only, never checks out PR code, so the elevated-privilege risk does not apply.
- Top-level `permissions:` block declaring `actions: write`, `contents: write`, `pull-requests: write`, `statuses: write`. These override the repo-default `GITHUB_TOKEN` scope.
- Single step: `uses: contributor-assistant/github-action@ca4a40a7d1004f18d9960b404b97e5f30a505a08 # v2.6.1` with `env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }` and `with:` parameters: `path-to-signatures: signatures/version1/cla.json`, `path-to-document: https://github.com/thinkwork-ai/thinkwork/blob/main/CLA.md`, `branch: cla-signatures`, `allowlist: dependabot[bot],renovate[bot]`.
- Add a header comment block explaining: (a) why SHA-pinned (upstream archived March 2026); (b) the contingency (fork to `thinkwork-ai/action-cla-assistant` if v2.6.1 breaks against GitHub API changes); (c) the CLA-version migration path (bump `path-to-signatures` to `signatures/version2/cla.json`).
- Do NOT add a `concurrency:` block in this PR. Add later only if rapid-fire pushes create observable noise.
- Do NOT pre-create `signatures/version1/cla.json` — the action initializes it on first signature.

**Patterns to follow:**
- `.github/workflows/lint.yml` for top-level structure (name, on, jobs).
- Existing workflows pin actions by major (`actions/checkout@v4`). This file is the deliberate exception — explained in the header comment.

**Technical design:** *(directional sketch — not implementation specification)*

```yaml
name: CLA Assistant
# Header comment explaining SHA pin + contingency + version-migration path

on:
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened, synchronize]

permissions:
  actions: write
  contents: write
  pull-requests: write
  statuses: write

jobs:
  cla:
    runs-on: ubuntu-latest
    steps:
      - uses: contributor-assistant/github-action@<SHA>  # v2.6.1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          path-to-signatures: 'signatures/version1/cla.json'
          path-to-document: 'https://github.com/thinkwork-ai/thinkwork/blob/main/CLA.md'
          branch: 'cla-signatures'
          allowlist: dependabot[bot],renovate[bot]
```

**Test scenarios:**
- Happy path: YAML parses (workflow appears under "Actions" tab after merge, no syntax errors in the workflow file).
- Happy path: `actionlint` (if available) returns no errors. If not available locally, GitHub will surface errors on push.
- Edge case: SHA in `uses:` is exactly `ca4a40a7d1004f18d9960b404b97e5f30a505a08` (40-char hex). Any deviation means a wrong action version.
- Edge case: `path-to-document` URL resolves to a real file on the post-merge `main` blob. Verified by clicking the URL after PR merge.
- Integration (verified in Unit 4 walkthrough): A real PR triggers the workflow and the bot comments.

**Verification:**
- The workflow file exists, references the pinned SHA with a `# v2.6.1` annotation, and the `permissions:` block matches the four scopes listed.
- After merge, the workflow appears under the "Actions" tab.

---

- [ ] **Unit 3: Update CONTRIBUTING.md — replace placeholder CLA section with live instructions**

**Goal:** A contributor reading CONTRIBUTING.md understands the CLA is live, where to find the text, and the exact phrase to post.

**Requirements:** R5

**Dependencies:** Unit 1 (so the link resolves), Unit 2 (so the described behavior is real).

**Files:**
- Modify: `CONTRIBUTING.md`

**Approach:**
- Replace the existing CLA block (currently lines 67-73 — the "being set up" placeholder) with a live version that:
  1. Links to `./CLA.md`
  2. States that an automated bot (CLA Assistant) will comment on the PR with a signing prompt the first time a contributor opens a PR
  3. Quotes the exact signing phrase contributors should reply with
  4. Notes that subsequent PRs from the same contributor pass automatically
  5. Drops the "being set up / external PRs will be held" hedging
- Leave the License section (Apache 2.0 reference) unchanged.
- Section heading stays `## Contributor License Agreement (CLA)` to preserve existing anchor links.

**Patterns to follow:**
- Tone of the rest of CONTRIBUTING.md: terse, direct, action-oriented.
- Existing markdown style (no badges, no emojis).

**Test scenarios:**
- Happy path: `CONTRIBUTING.md` contains a working relative link `./CLA.md` and a fenced or backticked quotation of the exact signing phrase.
- Happy path: No "being set up" or "tooling is being set up" wording remains.
- Edge case: The `## Contributor License Agreement (CLA)` heading is preserved (anchor backwards-compat).

**Verification:**
- A contributor following CONTRIBUTING.md alone can sign the CLA on their PR without any other guidance.

## System-Wide Impact

- **Interaction graph:** New `.github/workflows/cla.yml` runs on every PR open/sync and on every issue comment. Adds a required PR check (`license/cla`). Other workflows (lint, test, typecheck) are unaffected.
- **API surface parity:** `CLA.md` becomes a public document at `https://github.com/thinkwork-ai/thinkwork/blob/main/CLA.md`. The bot's `path-to-document` URL depends on this being stable. Renaming or moving `CLA.md` later requires also updating the workflow file in the same PR — flag this if the file moves.
- **State lifecycle risks:** The `cla-signatures` branch holds the signature ledger. If accidentally deleted or branch-protected, the action breaks. Branch protection on `cla-signatures` would prevent the action from committing new signatures — call out in deployment notes that this branch must remain unprotected.
- **Integration coverage:** End-to-end behavior cannot be unit-tested. The Unit 4 verification walkthrough (post-merge test PR) is the only real proof.
- **Unchanged invariants:**
  - All existing workflows continue to run unchanged.
  - `LICENSE`, `NOTICE`, `pyproject.toml`, `package.json` SPDX identifiers — unchanged.
  - DCO is not re-introduced; relicense PR's removal stands.
  - `README.md` Contributing section — unchanged (already links to CONTRIBUTING.md, which now describes the live CLA).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Upstream `contributor-assistant/github-action` archived (March 2026) and may break against future GitHub API changes | SHA pin gives stability today. If/when it breaks: fork to `thinkwork-ai/action-cla-assistant` and update the `uses:` line. Pre-fork is YAGNI. The header comment in `cla.yml` documents this contingency so a future maintainer doesn't have to rediscover it. |
| `cla-signatures` branch accidentally branch-protected or deleted | Operational note in the deployment section. The branch must exist before the first PR triggers the workflow, and must allow the `GITHUB_TOKEN` direct push. If it gets protected later, the workflow will fail loudly — surface as an incident, not a silent gap. |
| Repo-level "Workflow permissions" setting in Settings → Actions → General set to "Read repository contents and packages permissions" (the GitHub default for new repos since 2023) | Workflow-level `permissions:` block in `cla.yml` overrides this for the CLA workflow specifically. If the gate misbehaves on first run, check this setting first. Documented in deployment notes. |
| First PR after merge has nothing to sign against because `CLA.md` URL doesn't yet resolve on `main` | Sequencing: the same PR ships `CLA.md`, the workflow file, and the CONTRIBUTING.md update *together*. The PR itself does not get gated (the workflow doesn't exist on `main` yet at PR-open time — it lands at merge). The first PR that triggers gating is the test PR opened *after* merge. |
| Apache ICLA's mail-based signature default conflicts with comment-as-signature workflow | Preamble paragraph in `CLA.md` (Unit 1) explicitly equates posting the canonical phrase with signing. This is industry standard for OSS CLAs (Google, CNCF, etc. all rely on the same pattern), but writing it down removes ambiguity. |
| `CLA.md` text needs an actual lawyer's review for commercial-grade usage | Documented as a deployment-time recommendation. Not blocking the PR; the Apache ICLA adaptation is widely usable as-is, but a 30-minute attorney review is cheap insurance for a project with commercial aspirations. |
| Bot comment friction (false positives on bot PRs) | `allowlist: dependabot[bot],renovate[bot]` covers the two configured bots. If a new bot is added later, the allowlist must be updated. Document in workflow header comment. |

## Documentation / Operational Notes

**Pre-merge sanity check:**
- The PR contains `CLA.md`, `.github/workflows/cla.yml`, and the `CONTRIBUTING.md` update — all three. Missing any one breaks the gate.
- The SHA in the workflow file is exactly `ca4a40a7d1004f18d9960b404b97e5f30a505a08`. Re-resolve via `gh api repos/contributor-assistant/github-action/git/refs/tags/v2.6.1` if doubt remains.

**Deployment sequence (after PR merge, before any external contributor PR):**
1. **Create the `cla-signatures` branch** as an empty branch off `main` (no files needed; the action initializes `signatures/version1/cla.json` on first signature). One-liner: push an empty branch.
2. **Verify branch is NOT protected**: Settings → Branches. If `cla-signatures` appears in the protection rules, remove it.
3. **Verify `GITHUB_TOKEN` permissions allow workflow writes**: Settings → Actions → General → Workflow permissions. If set to "Read repository contents" only, the workflow's own `permissions:` block should override — but if first-run fails with a write-permission error, this is the first knob to check.
4. **Open a trivial test PR from the maintainer account.** Recommended: a typo fix or whitespace tweak. The CLA workflow should trigger; the bot should comment with a link to `CLA.md` and the canonical signing phrase.
5. **Reply with the canonical phrase**: `I have read the CLA Document and I hereby sign the CLA`.
6. **Confirm**: PR check `license/cla` flips to green; `signatures/version1/cla.json` on `cla-signatures` branch contains a row for the maintainer.
7. **Merge the test PR.**
8. **Recommended (out of plan scope):** ~30 minutes with an attorney to review `CLA.md`. Cheap insurance.

**Failure mode triage if the bot doesn't comment:**
- Workflow run shows no trigger → check that the workflow file is on `main` (not just on the merged PR's branch).
- Workflow runs but errors on first commit to `cla-signatures` → branch is protected; remove protection.
- Workflow runs but errors with a 403 → `GITHUB_TOKEN` write permission is being denied; check repo-level Workflow permissions.
- `path-to-document` URL 404s → `CLA.md` not yet on `main`, or the URL has a typo.

**No rollout monitoring required.** The first test PR is the entire monitoring story. After that, the gate either works (no further action) or fails loudly on the next real PR.

## Sources & References

- **Origin document:** [docs/plans/2026-04-20-006-refactor-relicense-mit-to-apache-2-plan.md](2026-04-20-006-refactor-relicense-mit-to-apache-2-plan.md) — Deferred Tasks section calls out CLA install as the immediate follow-up.
- Related PR: thinkwork-ai/thinkwork#313 (Apache 2.0 relicense, merged 2026-04-20)
- Action: [contributor-assistant/github-action](https://github.com/contributor-assistant/github-action) — pinned at SHA `ca4a40a7d1004f18d9960b404b97e5f30a505a08` (`v2.6.1`)
- CLA template: [Apache Individual CLA](https://www.apache.org/licenses/contributor-agreements.html#clas)
- Verification commands run during planning:
  - `gh api repos/contributor-assistant/github-action --jq '{archived, pushed_at, stars}'` → archived, 341 stars
  - `gh api repos/contributor-assistant/github-action/releases/latest --jq '{tag, date}'` → v2.6.1, 2024-09-26
  - `gh api repos/contributor-assistant/github-action/git/refs/tags/v2.6.1 --jq '{ref, sha, type: .object.type}'` → SHA `ca4a40a7d1004f18d9960b404b97e5f30a505a08`
  - `gh api repos/SiliconLabsSoftware/action-cla-assistant --jq '{archived, default_branch, pushed_at, stars}'` → 1 star, non-`main` default branch, no releases — not adopted
