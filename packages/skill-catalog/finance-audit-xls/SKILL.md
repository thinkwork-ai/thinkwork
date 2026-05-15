---
name: finance-audit-xls
display_name: "Finance — Audit Spreadsheet"
description: >
  Audit an uploaded financial spreadsheet for formula accuracy, errors,
  and common mistakes. Scope is the whole workbook (formula-level
  checks + financial-model integrity checks: BS balance, cash tie-out,
  roll-forwards, logic sanity). Use when the user uploads a model and
  asks to "audit", "check", "review", "QA", or "sanity-check" it.
license: Apache-2.0
metadata:
  author: "thinkwork (adapted from anthropic/financial-services)"
  version: "0.1.0"
  upstream:
    repo: "anthropic/financial-services"
    path: "plugins/agent-plugins/earnings-reviewer/skills/audit-xls/SKILL.md"
    commit: "ac4c5b4c917931b989620d3c226d88eda164f596"
    license: "Apache-2.0"
version: 2
execution: context
allowed-tools:
  - file_read
requires_skills: []
triggers:
  chat_intent:
    examples:
      - "audit this model"
      - "check this spreadsheet for errors"
      - "QA this workbook"
      - "sanity check this financial model"
      - "find formula errors in this file"
      - "review this model before I send it"
      - "why doesn't this model balance"
    disambiguation: ask
---

# Finance — Audit Spreadsheet

Audit an uploaded financial model for formula accuracy, integrity, and
common mistakes. Scope is the **whole workbook** (the pilot uploads a
single file; selection/sheet-level scoping isn't relevant here).

**Files attached to this turn:** the system prompt lists them at
`/tmp/turn-<turnId>/attachments/<name>`. Read attached spreadsheets with
`file_read(<path>)`. When multiple files are attached, ask the user
which one to audit.

## Step 1: Formula-level checks

Run these on every sheet:

| Check | What to look for |
|---|---|
| Formula errors | `#REF!`, `#VALUE!`, `#N/A`, `#DIV/0!`, `#NAME?` |
| Hardcodes inside formulas | `=A1*1.05` — the `1.05` should be a cell reference |
| Inconsistent formulas | A formula that breaks the pattern of its neighbors in a row/column |
| Off-by-one ranges | `SUM`/`AVERAGE` that misses the first or last row |
| Pasted-over formulas | Cell that looks like a formula but is actually a hardcoded value |
| Circular references | Intentional (LBO/3-stmt interest) or accidental |
| Broken cross-sheet links | References to cells that moved or were deleted |
| Unit/scale mismatches | Thousands mixed with millions, % stored as whole numbers |
| Hidden rows/tabs | Could contain overrides or stale calculations |

## Step 2: Model-integrity checks

Identify the model type (3-statement is the pilot's primary target) and
run integrity checks.

### 2a. Structural review

| Check | What to look for |
|---|---|
| Input/formula separation | Are inputs clearly separated from calculations? |
| Color convention | Blue=input, black=formula, green=link — or whatever the model uses, applied consistently? |
| Tab flow | Logical order (Assumptions → IS → BS → CF → Schedules)? |
| Date headers | Consistent across all tabs? |
| Units | Consistent (thousands vs millions vs actuals)? |

### 2b. Balance Sheet

| Check | Test |
|---|---|
| BS balances | Total Assets = Total Liabilities + Equity (every period) |
| RE rollforward | Prior RE + Net Income − Dividends = Current RE |
| WC sanity | AR ≈ days * revenue / 365 (or model's WC assumption) |

If BS doesn't balance, **quantify the gap per period and trace where it
breaks** — nothing else matters until this is fixed.

### 2c. Cash Flow Statement

| Check | Test |
|---|---|
| Cash tie-out | CF Ending Cash = BS Cash (every period) |
| CF sums | CFO + CFI + CFF = Δ Cash |
| D&A match | D&A on CF = D&A on IS |
| CapEx match | CapEx on CF matches PP&E rollforward on BS |
| WC changes | Signs match BS movements (ΔAR, ΔAP, ΔInventory) |

### 2d. Income Statement

| Check | Test |
|---|---|
| Revenue build | Ties to segment/product detail (if a schedule exists) |
| Tax | Tax expense ≈ Pre-tax income × tax rate (allow for deferred tax) |
| Share count | Ties to dilution schedule (options, converts, buybacks) |

### 2e. Circular references

- Interest → debt balance → cash → interest is a common intentional
  circular reference in 3-statement / LBO models.
- If intentional: verify iteration toggle exists and works.
- If unintentional: trace the loop and flag how to break it.

### 2f. Logic & reasonableness

| Check | Flag if |
|---|---|
| Growth rates | >50% revenue growth without explanation |
| Margins | Outside industry norms (compare gross / operating margins to typical ranges) |
| Hockey-stick | Projections ramp unrealistically in out-years |
| Compounding | EBITDA compounds to absurd $ by Year 10 |
| Edge cases | Model breaks at 0% or negative growth, negative EBITDA, leverage goes negative |

### 2g. Common 3-statement bugs (pilot focus)

- Working capital changes have wrong sign on CF vs BS
- Depreciation doesn't match PP&E schedule
- Debt maturity schedule doesn't match principal payments on CF
- Dividends exceed net income without explanation
- Tax rate hardcoded to one period and not rolled forward

## Step 3: Report

Output a findings table:

| # | Sheet | Cell/Range | Severity | Category | Issue | Suggested Fix |
|---|---|---|---|---|---|---|

**Severity:**
- **Critical** — wrong output (BS doesn't balance, formula broken, cash doesn't tie)
- **Warning** — risky (hardcodes, inconsistent formulas, edge-case failures)
- **Info** — style/best-practice (color coding, layout, naming)

Prepend a summary line:

> Model type: [3-stmt / other] — Overall: [Clean / Minor Issues / Major Issues] — [N] critical, [N] warnings, [N] info

**Don't change anything without asking** — report first, fix on request.

## Notes

- **BS balance first** — if it doesn't balance, everything downstream
  is suspect.
- **Hardcoded overrides are the #1 source of silent bugs** — search
  aggressively.
- **Sign convention errors** (positive vs negative for cash outflows)
  are extremely common.
- If the model uses VBA macros, note any macro-driven calculations that
  can't be audited from formulas alone.
- Cite specific cells (`Sheet!Cell` notation) so the user can navigate
  directly to each finding.
