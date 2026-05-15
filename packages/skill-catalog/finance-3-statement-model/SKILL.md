---
name: finance-3-statement-model
display_name: "Finance — 3-Statement Model"
description: >
  Complete, populate, and validate 3-statement financial model templates
  (Income Statement, Balance Sheet, Cash Flow Statement) using data from
  an uploaded workbook. Use when the user asks to fill out a model
  template, build out a partially populated IS/BS/CF framework, link
  integrated statements, or extend historicals into projections.
license: Apache-2.0
metadata:
  author: "thinkwork (adapted from anthropic/financial-services)"
  version: "0.1.0"
  upstream:
    repo: "anthropic/financial-services"
    path: "plugins/vertical-plugins/financial-analysis/skills/3-statement-model/SKILL.md"
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
      - "complete this 3-statement model"
      - "populate the model template"
      - "fill in the IS / BS / CF for {company}"
      - "link the statements together"
      - "build projections for {company}"
    disambiguation: ask
---

# Finance — 3-Statement Model

Complete and populate integrated financial model templates with proper
linkages between Income Statement, Balance Sheet, and Cash Flow Statement
using data from a workbook the user uploaded this turn.

**Files attached to this turn:** the system prompt lists them at
`/tmp/turn-<turnId>/attachments/<name>`. Read attached spreadsheets with
`file_read(<path>)` (the staging path is absolute — pass it as-is). When
multiple files are attached, ask the user which one is the model template
versus source data.

## ⚠️ CRITICAL PRINCIPLES — Read Before Populating Any Template

**Formulas over hardcodes (non-negotiable):**
- Every projection cell, roll-forward, linkage, and subtotal MUST be an
  Excel formula — never a pre-computed value.
- The ONLY cells that should contain hardcoded numbers are: (1) historical
  actuals, (2) assumption drivers in the Assumptions tab.
- If you find yourself computing a value and writing the result to a cell
  — STOP. Write the formula instead.
- Why: the model must flex when scenarios toggle or assumptions change.
  Hardcodes break every downstream integrity check silently.

**Verify step-by-step with the user:**
1. **After mapping the template** → show the user which tabs/sections
   you've identified and confirm before touching any cells.
2. **After populating historicals** → show the user the historical block
   and confirm values/periods match source data.
3. **After building IS projections** → run the subtotal checks, show the
   user the projected IS, confirm before moving to BS.
4. **After building BS** → show the user the balance check
   (Assets = L+E) for every period, confirm before moving to CF.
5. **After building CF** → show the user the cash tie-out
   (CF ending cash = BS cash), confirm before finalizing.
6. **Do NOT populate the entire model end-to-end and present it complete**
   — break at each statement, show the work, catch errors early.

## Model Structure

A complete 3-statement model has these sections:

1. **Assumptions** — drivers: revenue growth, gross margin, opex growth,
   capex % of revenue, D&A schedule, tax rate, WC days, dividend policy.
2. **Income Statement** — revenue → gross profit → operating income
   (EBIT) → pre-tax income → net income → EPS.
3. **Balance Sheet** — current assets, long-term assets, current
   liabilities, long-term liabilities, equity. Must balance every period.
4. **Cash Flow Statement** — CFO (NI + D&A − ΔWC), CFI (−CapEx + acq +
   divestitures), CFF (debt issuance − repayment − dividends + equity).
5. **Supporting schedules** — debt schedule, PP&E roll-forward, WC
   schedule, share count, dilution.

## Step-by-Step Build

### Step 1: Map the template

Read the workbook structure first. Identify:
- Which tab is which statement (IS / BS / CF / Assumptions).
- Where historicals end and projections begin (find the FYxxA → FYxxE
  boundary in the column headers).
- Which cells are already populated (do not overwrite) vs blank (your
  scope).
- The existing color/formula conventions (blue = input, black = formula,
  green = link — or whatever the model uses).

Present the map to the user before populating anything.

### Step 2: Populate historicals

Pull historical actuals from the source data (uploaded file). Match by
period header. Sign convention: revenues positive, expenses positive
(model totals subtract them), use cases-with-parens carefully (legacy
models sometimes display negatives in parentheses but store positives).

### Step 3: Build IS projections

Project each revenue line × growth rate from Assumptions. Cost of revenue
typically scales with revenue (or use a gross margin assumption). Opex
scales independently. D&A pulls from the PP&E schedule. Interest pulls
from the debt schedule. Tax = pre-tax × tax rate. Net income flows to
the Cash Flow Statement and to Retained Earnings on the BS.

### Step 4: Build the Balance Sheet

| Section | Build logic |
|---|---|
| Cash | Links to ending cash on CF |
| AR | Days * Revenue / 365 (or specified WC assumption) |
| Inventory | Days * COGS / 365 |
| PP&E | Prior PP&E + CapEx − D&A |
| Goodwill | Carries forward (only changes on M&A) |
| AP | Days * COGS / 365 |
| Debt | From the debt schedule (issuance/repayment) |
| Retained Earnings | Prior RE + Net Income − Dividends |

**Balance check:** Total Assets = Total Liabilities + Equity for every
period. If it doesn't balance, **STOP. Trace the gap.** Common breaks:
- D&A on IS doesn't match PP&E roll-forward
- Dividends paid don't match the CF
- Working capital changes have the wrong sign
- Interest accruing on debt isn't reflected in cash

### Step 5: Build the Cash Flow Statement

| Section | Build logic |
|---|---|
| Net Income | Links from IS |
| + D&A | Links from IS |
| − ΔWC | (AR + Inventory − AP) change vs prior period |
| = CFO | Sum the above |
| − CapEx | From the PP&E schedule (sign: outflow is negative) |
| ± Acquisitions / Divestitures | If any |
| = CFI | Sum |
| + Debt issuance | From debt schedule |
| − Debt repayment | From debt schedule |
| − Dividends | From the dividend policy |
| + Equity issuance | If any |
| = CFF | Sum |
| Δ Cash = CFO + CFI + CFF | |
| Ending cash = Beginning cash + Δ Cash | |

**Cash tie-out:** Ending cash on CF = Cash line on BS. Every period.

## Common 3-Statement Bugs

| Bug | Symptom | Fix |
|---|---|---|
| WC sign wrong | BS doesn't balance by ΔWC | Flip the sign on the CF |
| D&A mismatch | BS PP&E moves more/less than CF shows | Reconcile D&A between IS and PP&E schedule |
| Dividends > NI | RE goes negative when it shouldn't | Cap dividend assumption at NI or add equity |
| Debt schedule drift | Interest on IS doesn't match avg debt balance | Use beginning-of-period or average-balance interest formula |
| Tax leakage | Tax expense ≠ pre-tax × rate | Reconcile deferred tax or NOL utilization |

## Report

When the model is complete, present:

1. **The build summary** — three statements at a glance with totals per
   period.
2. **Integrity checks** — balance check (pass/fail per period), cash
   tie-out (pass/fail per period), D&A reconciliation.
3. **Key sensitivities** — what assumption drives the biggest change in
   year-N net income / ending cash.
4. **Caveats** — anything you had to assume (historical data gaps,
   missing schedules, ambiguous template sections).

## Notes

- **BS balance first** — if it doesn't balance, every downstream
  conclusion is suspect.
- **Hardcoded overrides are the #1 source of silent bugs** — search
  aggressively before declaring the model complete.
- **Sign convention errors** (positive vs negative for cash outflows)
  are extremely common — verify against the cash tie-out.
- If the source workbook uses VBA macros, note any macro-driven values
  that can't be audited from formulas alone.
