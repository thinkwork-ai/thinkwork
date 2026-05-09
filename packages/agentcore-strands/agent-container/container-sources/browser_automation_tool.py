"""AgentCore Browser tool registration.

The server owns policy: it calls this factory only when the resolved
template/agent policy enables Browser Automation. This module owns mechanics:
dependency probing, managed browser session lifecycle, direct Playwright-over-CDP
execution, and optional Nova Act execution for future enhanced operation.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

NOVA_ACT_AGENT_HOUR_USD = 4.75
AGENTCORE_BROWSER_VCPU_HOUR_USD = 0.0895
AGENTCORE_BROWSER_GB_HOUR_USD = 0.00945
PLACEHOLDER_SECRET_VALUES = {"", "PLACEHOLDER_SET_VIA_CLI"}
DEFAULT_BROWSER_AUTOMATION_ENGINE = "playwright"


def load_nova_act_key(*, region: str, stage_names: list[str] | None = None) -> str:
    """Load Nova Act API key from env or SSM."""

    key = os.environ.get("NOVA_ACT_API_KEY", "")
    if key and key not in PLACEHOLDER_SECRET_VALUES:
        logger.info("Nova Act API key loaded from env var")
        return key

    import boto3

    ssm = boto3.client("ssm", region_name=region)
    stages = stage_names or [os.environ.get("STACK_NAME", "dev"), "ericodom", "main"]
    for param in _nova_act_key_parameter_candidates(stages):
        try:
            resp = ssm.get_parameter(Name=param, WithDecryption=True)
            key = resp.get("Parameter", {}).get("Value", "")
            if key and key not in PLACEHOLDER_SECRET_VALUES:
                logger.info("Nova Act API key loaded from SSM: %s", param)
                return key
        except Exception:
            continue
    logger.warning("Nova Act API key not found in env or SSM")
    return ""


def _nova_act_key_parameter_candidates(stage_names: list[str]) -> list[str]:
    explicit = os.environ.get("NOVA_ACT_SSM_PARAM_NAME", "")
    candidates = [explicit] if explicit else []
    for stage in stage_names:
        if not stage:
            continue
        candidates.extend(
            [
                f"/thinkwork/{stage}/agentcore/nova-act-api-key",
                f"/thinkwork/{stage}/nova-act-api-key",
            ],
        )
    seen: set[str] = set()
    return [name for name in candidates if name and not (name in seen or seen.add(name))]


def _append_costs(
    cost_sink: list[dict],
    *,
    duration_sec: float,
    url: str,
    task: str,
    response_len: int | None = None,
    error: str | None = None,
) -> None:
    duration_ms = int(duration_sec * 1000)
    nova_cost = (duration_sec / 3600) * NOVA_ACT_AGENT_HOUR_USD

    estimated_vcpu = float(os.environ.get("BROWSER_AUTOMATION_ESTIMATED_VCPU", "1"))
    estimated_gb = float(os.environ.get("BROWSER_AUTOMATION_ESTIMATED_MEMORY_GB", "2"))
    browser_cost = (duration_sec / 3600) * (
        (estimated_vcpu * AGENTCORE_BROWSER_VCPU_HOUR_USD)
        + (estimated_gb * AGENTCORE_BROWSER_GB_HOUR_USD)
    )

    base_metadata: dict[str, Any] = {
        "url": url,
        "task": task[:100],
        "pricing_source": "aws-agentcore-pricing-2026-04-25",
    }
    if response_len is not None:
        base_metadata["response_len"] = response_len
    if error:
        base_metadata["error"] = error[:200]

    cost_sink.append(
        {
            "provider": "nova_act",
            "event_type": "nova_act_browser_automation",
            "amount_usd": round(nova_cost, 6),
            "duration_ms": duration_ms,
            "metadata": base_metadata,
        },
    )
    cost_sink.append(
        {
            "provider": "agentcore_browser",
            "event_type": "agentcore_browser_session",
            "amount_usd": round(browser_cost, 6),
            "duration_ms": duration_ms,
            "metadata": {
                **base_metadata,
                "estimated": True,
                "estimated_vcpu": estimated_vcpu,
                "estimated_memory_gb": estimated_gb,
            },
        },
    )


def _append_browser_cost(
    cost_sink: list[dict],
    *,
    duration_sec: float,
    url: str,
    task: str,
    response_len: int | None = None,
    error: str | None = None,
) -> None:
    duration_ms = int(duration_sec * 1000)

    estimated_vcpu = float(os.environ.get("BROWSER_AUTOMATION_ESTIMATED_VCPU", "1"))
    estimated_gb = float(os.environ.get("BROWSER_AUTOMATION_ESTIMATED_MEMORY_GB", "2"))
    browser_cost = (duration_sec / 3600) * (
        (estimated_vcpu * AGENTCORE_BROWSER_VCPU_HOUR_USD)
        + (estimated_gb * AGENTCORE_BROWSER_GB_HOUR_USD)
    )

    metadata: dict[str, Any] = {
        "url": url,
        "task": task[:100],
        "pricing_source": "aws-agentcore-pricing-2026-04-25",
        "estimated": True,
        "estimated_vcpu": estimated_vcpu,
        "estimated_memory_gb": estimated_gb,
    }
    if response_len is not None:
        metadata["response_len"] = response_len
    if error:
        metadata["error"] = error[:200]

    cost_sink.append(
        {
            "provider": "agentcore_browser",
            "event_type": "agentcore_browser_session",
            "amount_usd": round(browser_cost, 6),
            "duration_ms": duration_ms,
            "metadata": metadata,
        },
    )


def build_browser_automation_tool(
    *,
    strands_tool_decorator: Callable[..., Any],
    nova_act_api_key: str,
    cost_sink: list[dict],
    region: str,
    browser_session_factory: Callable[..., Any] | None = None,
    nova_act_cls: type | None = None,
    playwright_factory: Callable[..., Any] | None = None,
    browser_engine: str | None = None,
    event_sink: Callable[[str, str, dict[str, Any]], None] | None = None,
) -> Any:
    """Return the `browser_automation` Strands tool.

    Missing dependency/API-key cases still return a registered tool so enabled
    agents get an actionable result instead of an invisible capability gap.
    """

    engine = (browser_engine or os.environ.get("BROWSER_AUTOMATION_ENGINE", "")).strip().lower()
    if not engine:
        engine = DEFAULT_BROWSER_AUTOMATION_ENGINE

    dependency_error = ""
    if browser_session_factory is None:
        try:
            from bedrock_agentcore.tools.browser_client import browser_session

            browser_session_factory = browser_session
        except ImportError as err:
            dependency_error = str(err)
    if engine == "nova_act" and nova_act_cls is None:
        try:
            from nova_act import NovaAct

            nova_act_cls = NovaAct
        except ImportError as err:
            dependency_error = str(err)
    if engine != "nova_act" and playwright_factory is None:
        try:
            from playwright.sync_api import sync_playwright

            playwright_factory = sync_playwright
        except ImportError as err:
            dependency_error = str(err)

    @strands_tool_decorator
    def browser_automation(url: str, task: str) -> str:
        """Use a managed browser to perform a website task.

        Use this for dynamic websites that require clicking, typing, reading
        rendered UI, checking availability, filling forms, or extracting data
        that ordinary HTTP requests cannot see.

        Args:
            url: The starting URL.
            task: The browser task to complete and summarize.
        """

        if dependency_error:
            _emit_event(
                event_sink,
                "browser_automation_unavailable",
                "warn",
                {"url": url, "task": task[:200], "reason": dependency_error[:500]},
            )
            return (
                "Browser Automation is enabled for this agent, but the runtime "
                f"is missing required dependencies: {dependency_error}"
            )
        if engine == "nova_act" and not nova_act_api_key:
            _emit_event(
                event_sink,
                "browser_automation_unavailable",
                "warn",
                {
                    "url": url,
                    "task": task[:200],
                    "reason": "nova_act_api_key_missing",
                },
            )
            return (
                "Browser Automation is enabled for this agent, but the Nova Act "
                "API key is not configured for this deployment yet."
            )

        start_time = time.time()
        logger.info("browser_automation called: url=%s task=%s", url, task[:100])
        _emit_event(
            event_sink,
            "browser_automation_started",
            "info",
            {"url": url, "task": task[:200]},
        )
        try:
            with browser_session_factory(region) as client:
                ws_url, headers = client.generate_ws_headers()
                if engine == "nova_act":
                    logger.info("AgentCore Browser session started; connecting Nova Act")
                    with nova_act_cls(
                        cdp_endpoint_url=ws_url,
                        cdp_headers=headers,
                        nova_act_api_key=nova_act_api_key,
                        starting_page=url,
                    ) as nova:
                        result = nova.act(task, schema={"type": "string"})
                        response = str(result.response) if result.response else ""
                        duration_sec = time.time() - start_time
                        _append_costs(
                            cost_sink,
                            duration_sec=duration_sec,
                            url=url,
                            task=task,
                            response_len=len(response),
                        )
                        _emit_completion_event(
                            event_sink,
                            url=url,
                            task=task,
                            response=response,
                            duration_sec=duration_sec,
                        )
                        return _browser_response_or_empty(url, response)

                logger.info("AgentCore Browser session started; connecting Playwright")
                response = _run_playwright_browser_task(
                    playwright_factory=playwright_factory,
                    ws_url=ws_url,
                    headers=headers,
                    url=url,
                    task=task,
                )
                duration_sec = time.time() - start_time
                _append_browser_cost(
                    cost_sink,
                    duration_sec=duration_sec,
                    url=url,
                    task=task,
                    response_len=len(response),
                )
                _emit_completion_event(
                    event_sink,
                    url=url,
                    task=task,
                    response=response,
                    duration_sec=duration_sec,
                )
                return _browser_response_or_empty(url, response)
        except Exception as err:  # noqa: BLE001
            duration_sec = time.time() - start_time
            if engine == "nova_act":
                _append_costs(
                    cost_sink,
                    duration_sec=duration_sec,
                    url=url,
                    task=task,
                    error=str(err),
                )
            else:
                _append_browser_cost(
                    cost_sink,
                    duration_sec=duration_sec,
                    url=url,
                    task=task,
                    error=str(err),
                )
            _emit_event(
                event_sink,
                "browser_automation_failed",
                "error",
                {
                    "url": url,
                    "task": task[:200],
                    "error": str(err)[:500],
                    "durationMs": int(duration_sec * 1000),
                },
            )
            logger.error(
                "browser_automation error: %s: %s",
                type(err).__name__,
                err,
                exc_info=True,
            )
            return f"Browser Automation error: {err}"

    return browser_automation


def _run_playwright_browser_task(
    *,
    playwright_factory: Callable[..., Any],
    ws_url: str,
    headers: dict[str, str],
    url: str,
    task: str,
) -> str:
    with playwright_factory() as playwright:
        browser = playwright.chromium.connect_over_cdp(ws_url, headers=headers)
        try:
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.pages[0] if context.pages else context.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            try:
                page.wait_for_load_state("networkidle", timeout=5_000)
            except Exception:
                pass

            title = (page.title() or "").strip()
            body_text = ""
            try:
                body_text = page.locator("body").inner_text(timeout=5_000).strip()
            except Exception:
                body_text = ""
            return _format_playwright_response(
                title=title,
                url=page.url or url,
                body_text=body_text,
                task=task,
            )
        finally:
            browser.close()


def _format_playwright_response(*, title: str, url: str, body_text: str, task: str) -> str:
    if "title" in task.lower() and title:
        return title

    excerpt = " ".join(body_text.split())[:1200]
    parts = [f"URL: {url}"]
    if title:
        parts.append(f"Title: {title}")
    if excerpt:
        parts.append(f"Page text excerpt: {excerpt}")
    return "\n".join(parts)


def _emit_completion_event(
    event_sink: Callable[[str, str, dict[str, Any]], None] | None,
    *,
    url: str,
    task: str,
    response: str,
    duration_sec: float,
) -> None:
    _emit_event(
        event_sink,
        "browser_automation_completed",
        "info",
        {
            "url": url,
            "task": task[:200],
            "responseLen": len(response),
            "durationMs": int(duration_sec * 1000),
        },
    )
    logger.info(
        "browser_automation completed: response_len=%d duration=%.1fs",
        len(response),
        duration_sec,
    )


def _browser_response_or_empty(url: str, response: str) -> str:
    if not response or response == "None":
        return f"Browser navigated to {url} but could not extract the requested information."
    return response


def _emit_event(
    event_sink: Callable[[str, str, dict[str, Any]], None] | None,
    event_type: str,
    level: str,
    payload: dict[str, Any],
) -> None:
    if not event_sink:
        return
    try:
        event_sink(event_type, level, payload)
    except Exception as err:  # noqa: BLE001
        logger.warning("browser_automation event append failed: %s", err)
