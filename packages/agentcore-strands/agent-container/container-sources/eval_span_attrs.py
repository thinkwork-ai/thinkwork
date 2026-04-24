"""
Eval-friendly span attribution for the Strands runtime.

Tags every OpenTelemetry span emitted during an invocation with stable
identifiers (session.id, tenant.id, agent.id, thread.id) so the
ThinkWork eval-runner can query CloudWatch `aws/spans` by session.id and
hand the resulting span batch to AWS Bedrock AgentCore Evaluations'
`EvaluateCommand`.

Mechanism: baggage is set at the start of do_POST in server.py; an
EvalAttrSpanProcessor copies those baggage values onto each span's
attributes during `on_start`. Baggage propagates automatically across
threads and asyncio tasks, so child spans created deep inside the
Strands event loop inherit the same attribution.

Why baggage rather than ContextVar: OpenTelemetry already plumbs baggage
through the same context that traces use, so we don't duplicate the
propagation machinery.
"""

from typing import Optional

from opentelemetry import baggage, context as otel_context
from opentelemetry.sdk.trace import Span, SpanProcessor

# Baggage keys — kept short since baggage is serialized into HTTP headers.
BG_SESSION_ID = "tw.session.id"
BG_TENANT_ID = "tw.tenant.id"
BG_AGENT_ID = "tw.agent.id"
BG_THREAD_ID = "tw.thread.id"

# Span attribute keys — chosen to align with what AgentCore Evaluations
# typically queries by (session.id is the canonical join key).
ATTR_SESSION_ID = "session.id"
ATTR_TENANT_ID = "tenant.id"
ATTR_AGENT_ID = "agent.id"
ATTR_THREAD_ID = "thread.id"

_BG_TO_ATTR = {
    BG_SESSION_ID: ATTR_SESSION_ID,
    BG_TENANT_ID: ATTR_TENANT_ID,
    BG_AGENT_ID: ATTR_AGENT_ID,
    BG_THREAD_ID: ATTR_THREAD_ID,
}


class EvalAttrSpanProcessor(SpanProcessor):
    """Copy eval-context baggage onto every span as it starts."""

    def on_start(self, span: Span, parent_context: Optional[otel_context.Context] = None) -> None:
        ctx = parent_context if parent_context is not None else otel_context.get_current()
        for bg_key, attr_key in _BG_TO_ATTR.items():
            value = baggage.get_baggage(bg_key, ctx)
            if value:
                span.set_attribute(attr_key, str(value))

    def on_end(self, span) -> None:  # type: ignore[override]
        pass

    def shutdown(self) -> None:
        pass

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


def attach_eval_context(
    session_id: str,
    tenant_id: str = "",
    agent_id: str = "",
    thread_id: str = "",
) -> object:
    """
    Set baggage for the current invocation. Returns a token to pass to
    `detach_eval_context` after the request completes.

    Empty values are skipped so we don't pollute spans with placeholder
    strings.
    """
    ctx = otel_context.get_current()
    if session_id:
        ctx = baggage.set_baggage(BG_SESSION_ID, session_id, context=ctx)
    if tenant_id:
        ctx = baggage.set_baggage(BG_TENANT_ID, tenant_id, context=ctx)
    if agent_id:
        ctx = baggage.set_baggage(BG_AGENT_ID, agent_id, context=ctx)
    if thread_id:
        ctx = baggage.set_baggage(BG_THREAD_ID, thread_id, context=ctx)
    return otel_context.attach(ctx)


def detach_eval_context(token: object) -> None:
    """Restore the prior context. Safe to call with a None/falsy token."""
    if token is not None:
        try:
            otel_context.detach(token)
        except Exception:
            pass


def register_processor() -> bool:
    """
    Register EvalAttrSpanProcessor on the global TracerProvider, if one
    is installed. Returns True on success. Safe to call multiple times.
    """
    try:
        from opentelemetry import trace
        provider = trace.get_tracer_provider()
        # The SDK TracerProvider exposes add_span_processor; the no-op
        # default ProxyTracerProvider does not. Only register if real.
        add = getattr(provider, "add_span_processor", None)
        if not callable(add):
            return False
        add(EvalAttrSpanProcessor())
        return True
    except Exception:
        return False
