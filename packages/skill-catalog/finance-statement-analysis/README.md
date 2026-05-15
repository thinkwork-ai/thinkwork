# finance-statement-analysis

Thinkwork-authored skill. Activate when the user uploads a financial statement (Income Statement, Balance Sheet, Cash Flow Statement, GL, AR/AP aging, or budget-vs-actual) and asks the agent to extract trends, compute ratios, or call out anomalies.

The skill cites specific values from the file (cell references where possible) and flags items for human review without making definitive claims about cause.

Pairs with `finance-3-statement-model` (build the model from raw inputs) and `finance-audit-xls` (verify model integrity before relying on its output).
