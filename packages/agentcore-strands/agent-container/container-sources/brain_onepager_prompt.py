"""Platform-owned Brain v0 pre-meeting one-pager prompt."""


def build_brain_onepager_prompt(customer_page_id: str) -> str:
    return f"""Prepare a pre-meeting one-pager for customer entity {customer_page_id}.

Use query_context with providers memory, wiki, bedrock-knowledge-base,
crm-opportunity, and erp-customer. Render concise sections for operational
status, relationship history, open promises, KB-sourced terms, talking points,
and landmines. Omit unavailable sections rather than fabricating them, and
cite every factual claim."""
