# Task Specifications

## Required tasks (always create)

| Title pattern | Assignee | Priority |
|---|---|---|
| Get contract signed for {customer} | Contract signer from intake | HIGH |
| Enter {customer} into database | Unassigned | MEDIUM |
| Send welcome packet to {customer} | Current user (CURRENT_USER_EMAIL) | MEDIUM |

## Conditional tasks

| Condition | Title pattern | Assignee | Priority |
|---|---|---|---|
| Requesting credit line | Run credit check for {customer} | Unassigned | HIGH |
| Tax exempt | Gather tax exempt form from {customer} | Unassigned | MEDIUM |
| Fuel customer | Set up fuel account for {customer} | Unassigned | MEDIUM |

## Description guidelines

Every `create_sub_thread` call requires a `description`. Write 1-2 sentences incorporating the customer's specific details from intake (customer type, tax status, credit info). Example:

> "Draft and send the onboarding contract to Acme Corp for signature. This is a fuel customer, tax exempt, with a $10k credit line request."

## Title guidelines

Use clear, specific titles: "Draft and send contract to Acme Corp" not "Contract".
