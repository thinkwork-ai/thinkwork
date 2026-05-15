---
name: finance-statement-analysis
display_name: "Finance — Statement Analysis"
description: >
  Analyze an uploaded financial statement (Excel or CSV). Extract
  trends across periods, compute the standard ratio panel (margin,
  liquidity, leverage, return), and call out anomalies — citing
  specific values from the file. Use when the user asks "what stands
  out", "summarize the trends", "key ratios", or "anomalies" in the
  attached statement.
license: Apache-2.0
metadata:
  author: thinkwork
  version: "0.1.0"
version: 2
execution: context
allowed-tools:
  - file_read
requires_skills: []
triggers:
  chat_intent:
    examples:
      - "what stands out in this statement"
      - "summarize the trends"
      - "compute key ratios"
      - "analyze this income statement"
      - "anomalies in this financial data"
      - "what's the year-over-year change"
    disambiguation: ask
---

# Finance — Statement Analysis

Analyze an uploaded financial statement and produce a tight, value-cited
summary of trends, ratios, and anomalies.

**Files attached to this turn:** the system prompt lists them at
`/tmp/turn-<turnId>/attachments/<name>`. Read attached spreadsheets with
`file_read(<path>)`. When multiple files are attached, ask the user which
one to analyze — or analyze each one separately and present consolidated
findings.

## Step 1: Identify the statement shape

Read the file and identify:
- **Type:** Income Statement, Balance Sheet, Cash Flow Statement,
  general ledger, AR/AP aging, expense detail, budget vs actual, or a
  combined model.
- **Periods:** which periods are present (monthly / quarterly / annual)
  and how many.
- **Units:** thousands / millions / actuals. Currency.
- **Comparators:** are there budget / forecast / prior-year columns?

Present the shape to the user in one short paragraph before computing
anything. This gives the user a chance to redirect (e.g., "actually focus
on Q3" or "ignore the budget column").

## Step 2: Extract trends

For each metric the statement carries, compute period-over-period
changes:

| Metric | What to compute |
|---|---|
| Revenue (or top-line equivalent) | Absolute change, % change, CAGR if 3+ periods |
| Gross profit | Absolute change, gross margin trend |
| Operating expenses | Absolute change by category if itemized |
| EBIT / operating income | Absolute change, operating margin trend |
| Net income | Absolute change, net margin trend |
| Total assets / liabilities / equity (BS) | Period-end snapshot + delta |
| Cash from operations (CF) | Trend + comparison to net income |
| Capex / free cash flow | If derivable |

Highlight the **3-5 most material trends** — don't list everything.
Material = either a >10% absolute change in a line item that flows to
the bottom line, OR a directional shift (margin compression /
expansion, opex outpacing revenue, etc.).

## Step 3: Compute the ratio panel

Run the standard ratio panel for whatever data is available. Skip any
ratio whose inputs aren't on the file (don't fabricate).

### Margin ratios

| Ratio | Formula | Read |
|---|---|---|
| Gross margin | Gross Profit / Revenue | Pricing power + COGS efficiency |
| Operating margin | EBIT / Revenue | Overall operating leverage |
| Net margin | Net Income / Revenue | After-tax / financing efficiency |

### Liquidity ratios (need a Balance Sheet)

| Ratio | Formula | Read |
|---|---|---|
| Current ratio | Current Assets / Current Liabilities | Short-term obligation coverage |
| Quick ratio | (CA − Inventory) / CL | Liquid-asset coverage |
| Cash ratio | Cash / CL | Worst-case liquidity |

### Leverage ratios (need a Balance Sheet + IS)

| Ratio | Formula | Read |
|---|---|---|
| Debt / Equity | Total Debt / Equity | Capital structure |
| Debt / EBITDA | Total Debt / TTM EBITDA | Debt-service capacity |
| Interest coverage | EBIT / Interest Expense | Whether earnings cover interest |

### Return ratios

| Ratio | Formula | Read |
|---|---|---|
| Return on Assets | Net Income / Total Assets | Asset-efficiency |
| Return on Equity | Net Income / Equity | Shareholder return |

### Working capital ratios (need a Balance Sheet)

| Ratio | Formula | Read |
|---|---|---|
| Days Sales Outstanding | (AR / Revenue) × 365 | Collection cadence |
| Days Inventory | (Inventory / COGS) × 365 | Inventory turnover |
| Days Payables | (AP / COGS) × 365 | Payment cadence |
| Cash Conversion Cycle | DSO + DIO − DPO | Working-capital efficiency |

## Step 4: Call out anomalies

Anomalies are specific things in the data that warrant explanation. Flag
items where:

- A line item shifts >25% period-over-period without obvious cause
- A margin compresses by >2 percentage points in one period
- A ratio crosses a meaningful threshold (current ratio < 1, debt/EBITDA
  > 4x, interest coverage < 2x)
- A line item flips sign (positive to negative or vice versa)
- A line item appears in one period but not adjacent periods
- A subtotal doesn't sum to its components (suggests a stale formula or
  hidden line)
- One period's value is an outlier vs the rest of the series (e.g.,
  4 months at ~$200K then one month at $2M)

For each anomaly: state the cell or line, the value, the trigger
threshold, and one or two plausible business causes the user might
investigate. Don't be definitive about cause — flag for human review.

## Step 5: Report

Format the output as:

### Statement at a glance

One paragraph: type, periods, units, what's notable in plain English.

### Trends (top 3-5)

Bulleted, each cites a specific value:
- "Revenue grew from $X (Q1) to $Y (Q4), +Z%."
- "Gross margin compressed from XX% to YY% over the period."

### Ratio panel

A clean markdown table with the ratios computed and the trend arrow
(↑ / ↓ / →) over the period.

### Anomalies

Bulleted, with cell references where possible:
- "[Sheet/Cell] Marketing spend spiked to $X in [period] vs ~$Y in
  prior periods; budget showed $Z."

### Caveats

What you couldn't compute (missing inputs) and what assumptions you
made (e.g., "treated 'Other expenses' as opex").

## Notes

- **Cite specific values from the file.** Vague analysis like "margins
  improved" is worthless without numbers. Every claim points back to a
  cell or a derived calculation.
- **Anchor to materiality.** Don't list every line; list the ones that
  move the needle.
- **Don't fabricate.** If a ratio's input isn't available, say so. Don't
  estimate or impute.
- **Respect units.** A statement in thousands looks identical to one in
  millions; check the header before reporting absolute values.
