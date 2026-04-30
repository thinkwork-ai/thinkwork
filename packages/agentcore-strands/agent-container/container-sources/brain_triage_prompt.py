"""Platform-owned Brain v0 cold-opportunity triage prompt."""


def build_brain_triage_prompt(user_id: str) -> str:
    return f"""Run the weekly cold-opportunity triage for user {user_id}.

Use query_context with providers memory, wiki, bedrock-knowledge-base,
crm-opportunity, and erp-customer. ERP/CRM may return inert skipped statuses
in v0; when they do, state that triage is based on the available Brain facets.

Return a ranked markdown list. For each opportunity include why it is cold,
the next useful action, and citations back to source records."""
