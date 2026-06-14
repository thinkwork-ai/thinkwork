# Validation Runbook — Skill Tests & Evals UI (U9 / U6 / U8)

Hand this to a validating agent. It is self-contained. Do **not** open a PR, push,
or commit — report findings back to Eric.

## 0. Orientation

- **Branch:** `feat/skill-tests-and-evals`
- **Worktree:** `/Users/ericodom/Projects/thinkwork/.claude/worktrees/skill-evals-work`
- **What you're validating (frontend, `apps/web`):**
  - **U9** — per-skill "Eval score" column on the Skill Library + a score/regression/
    run-now panel on the skill detail page.
  - **U6** — a per-tenant skill-update gate control (Skills toolbar) and a held-update
    banner (Apply / Apply-anyway override) on the skill detail.
  - **U8** — a skill picker in the "Flag for evaluation" dialog.
- **Operator-gated:** sign in as a tenant **owner/admin** (Eric's Google login). Every
  surface below is behind `OperatorGuard`/`isOperator`; a non-operator sees nothing.

### ⚠️ The one thing that determines how you validate

The backend resolvers and the `flagThreadForEval.skillSlug` input that this UI calls are
committed **only on this branch** — they are **NOT deployed to dev's `graphql-http`
Lambda** (it runs `main`). The new operations are: `skillEvalScore`, `skillEvalGate`,
`flaggedTurnSkillCandidates`, `setSkillEvalGate`, `applySkillUpdate`, and the skill
fields on `flagThreadForEval`.

So you have two validation modes:

- **Mode A — UI shell + graceful degradation (no deploy).** Against dev as-is, the new
  fields error and the UI must degrade cleanly (no white-screen). Validates layout,
  states, and that nothing crashes. Doable right now.
- **Mode B — full data path (needs the branch deployed to dev).** Only after the
  branch's Lambdas are live on dev can you see real scores/gates/attribution. Requires
  an explicit decision to branch-deploy dev (Eric's call — see §5).

Also note: **no catalog skill ships eval cases (`evals/*.json`) yet**, so even after a
deploy every skill starts "Unrated". The reliable way to produce a scored skill is the
U8 flag path (§6.1), which seeds a `skill-<slug>` dataset from a flagged turn.

---

## 1. Static checks (no AWS) — confirm green first

```bash
cd /Users/ericodom/Projects/thinkwork/.claude/worktrees/skill-evals-work
pnpm --filter @thinkwork/web typecheck         # expect: clean
pnpm --filter @thinkwork/web test              # expect: 163 files, 1210 tests passing
```

If either fails, stop and report — the tree should already be green.

---

## 2. Start the web dev server against dev

```bash
cd /Users/ericodom/Projects/thinkwork/.claude/worktrees/skill-evals-work
cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env   # ignored env from main checkout
pnpm --filter @thinkwork/web dev -- --host localhost --port 5180
```

Open `http://localhost:5180`, sign in with Google as the operator. Port **must** be
5175 or 5180 (the only Cognito-allowlisted callback ports) or OAuth fails with a
generic redirect_mismatch.

---

## 3. Mode A — UI shell + graceful degradation (no deploy)

Confirm the UI renders and degrades cleanly while the new GraphQL fields error.

### 3.1 Skill Library — `/settings/skills`
- [ ] The table renders with a new **"Eval score"** column. With the backend
      undeployed, every cell shows **"Unrated"** or **"—"** (the score query errors →
      no crash). Acceptable.
- [ ] Top-right of the toolbar shows an **"Update gate: Off"** button. Clicking it opens
      a popover with a "% passing" number input + Save / Turn off. (Save will fail
      against undeployed dev — that's expected in Mode A; just confirm the control
      renders and opens.)
- [ ] No console error white-screens the page; the skills list itself still works
      (search, row click).

### 3.2 Skill detail — click any skill → `/settings/skills/<slug>`
- [ ] A score panel renders **above** the SKILL.md editor: "Eval score —", a disabled
      **"Run evals now"** button, and the "no eval cases yet" hint.
- [ ] The SKILL.md editor below still loads and is editable.
- [ ] No held-update banner (none staged).

### 3.3 Flag dialog — open a thread with a completed turn
- Open a Space thread that has at least one **completed/terminal** turn. Use the
  **"Flag for evaluation"** action (flag icon, `aria-label="Flag for evaluation"`) on a
  completed turn or in the thread header.
- [ ] The dialog opens with an **"Attribute to"** select at the top. Against undeployed
      dev the candidates query errors → the only option is **"Not skill-specific"**, and
      the **Dataset** picker + resolution target render below (i.e. it degrades to the
      original Trust-Core flag flow).
- [ ] Submitting in "Not skill-specific" mode still flags into a custom dataset
      (this path does **not** use the new backend, so it works on dev today). Confirm a
      success toast + the case lands in the chosen dataset.

**Mode A pass criteria:** every surface renders, no crashes, degraded states match the
above, and the legacy flag path still works.

---

## 4. Visual/polish checklist (either mode)

- [ ] Score column width/alignment is sane; "Regression" chip (when present) is the
      destructive/red badge and doesn't overflow the cell.
- [ ] The gate popover copy is clear; the number input rejects out-of-range (>100, <0
      disables Save).
- [ ] The skill-detail panel sits cleanly above the editor on a tall and a short
      viewport; the editor still fills remaining height.
- [ ] The held-update banner (when visible in Mode B) is the amber notice with
      Apply / Review candidate; the override message is red and legible.
- [ ] Dark mode looks right on all three surfaces.

---

## 5. Mode B prerequisite — deploy the branch to dev (Eric's decision)

Full data validation needs the branch's `graphql-http` (+ eval-runner / eval-worker /
workspace-files) live on dev. The sanctioned path is merge→pipeline, so this is a
deliberate pre-merge deviation that leaves dev on unmerged code until the next deploy.

**Do not run this without Eric's explicit go-ahead.** When authorized:

```bash
cd /Users/ericodom/Projects/thinkwork/.claude/worktrees/skill-evals-work/apps/cli
pnpm dev -- deploy -s dev        # deploys the current branch's stack to dev
```

(0166_eval_skill_gate.sql is **already applied** to dev, so the migration precheck
will pass.) After it completes, hard-refresh the web app.

---

## 6. Mode B — full data-path E2E (after §5)

### 6.1 U8 → U9: flag a turn to a skill, then score it
1. Open a thread with a completed turn → **Flag for evaluation**.
2. In **Attribute to**, you should now see real candidates — skills the turn used
   (source "active") or, if the turn predates `activeSkills`, the installed-skill
   fallback (shown with "· installed (verify)" and a low-confidence hint).
   - [ ] Pick a skill, fill the resolution target, submit → success toast.
3. Go to `/settings/skills/<that-skill>`:
   - [ ] The panel now shows a case count (rated), and **"Run evals now"** is enabled.
   - [ ] Click **Run evals now** → toast "Eval run started". Within a few minutes the
         **pass rate updates live** (no manual refresh — the `notifyEvalRunUpdate`
         subscription drives it).
   - [ ] **"View eval dataset"** links to `/settings/evaluations/datasets/skill-<slug>`
         and shows the case + run history.
4. `/settings/skills` list:
   - [ ] The skill's "Eval score" cell now shows the pass rate (not "Unrated").

### 6.2 U6: gate control
1. On `/settings/skills`, open **Update gate**, set e.g. `80`, Save.
   - [ ] Toast confirms; reopen → it shows 80%. The button reads "Update gate: 80%".
2. **Turn off** → button returns to "Update gate: Off".
   - [ ] Cross-check persistence: the gate is per-tenant; a fresh load reflects the set
         value.

### 6.3 U6: held-update banner (hardest — optional)
The held state is created when the **agent** reinstalls a skill whose candidate version
scores below the set gate (there is intentionally no web "reinstall" button — only the
agent reinstalls skills). To exercise it:
1. Set a high gate (e.g. 95%) in §6.2.
2. Have the platform agent reinstall a skill whose bundled eval cases will score below
   95% (e.g. edit the skill's `evals/*.json` / SKILL.md so the candidate regresses, then
   trigger the agent's skill reinstall).
3. On `/settings/skills/<slug>`:
   - [ ] An amber **"Update held"** banner appears with **Apply update** + **Review
         candidate** (links to `…/datasets/skill-<slug>-candidate`).
   - [ ] Click **Apply update** → if the candidate is below the gate it returns
         *blocked*; the button becomes **Apply anyway** with a red "scored X%, below the
         Y% gate" message.
   - [ ] Click **Apply anyway** → applies (overrides), banner clears, score refetches.
If reproducing the agent reinstall is impractical, validate detection + the
apply/override affordances by reading the candidate dataset directly and confirm the
banner logic in `SettingsSkillDetail.tsx` instead, and note it as "code-reviewed, not
live-exercised".

---

## 7. Report back to Eric

For each of §3 (Mode A) and, if deployed, §6 (Mode B): pass/fail per checkbox, any
console errors, screenshots of the three surfaces (skills list with score column, skill
detail panel, flag dialog with the attribution select), and anything visually off from
§4. Do not commit, push, or open a PR.
```
