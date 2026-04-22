"""sandbox-pilot — flagship demo script.

Agents assigned the sandbox-pilot template invoke this via ``run_pilot``
to exercise the full AgentCore Code Sandbox path end-to-end:

  1. Pull the last 30 days of ``skill_runs`` from Thinkwork's GraphQL.
  2. Fetch a GitHub issue body through the sandbox's ``execute_code``
     (agent authorizes a ``pip install requests`` + ``curl`` over HTTPS
     with GITHUB_ACCESS_TOKEN from os.environ).
  3. Join the two in pandas, produce a small chart, upload to S3.
  4. Post the S3 URL to Slack via ``SLACK_ACCESS_TOKEN`` from os.environ.

The pilot is a **reference**, not a product feature — it only runs in
dev when operators manually assign the template and say "run the sandbox
pilot". Failures here are the dogfood signal that the substrate works.
See docs/guides/sandbox-environments.md for the full operator runbook.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

PILOT_VERSION = "1.0.0"


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        print(f"[sandbox-pilot] FATAL: ${name} not set", file=sys.stderr)
        sys.exit(2)
    return value


def _graphql_skill_runs(api_url: str, api_secret: str, tenant_id: str) -> list[dict]:
    query = """
    query RecentSkillRuns($tenantId: ID!) {
      skillRuns(tenantId: $tenantId, limit: 500) {
        id skillId status startedAt finishedAt
      }
    }
    """
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/graphql",
        data=json.dumps(
            {"query": query, "variables": {"tenantId": tenant_id}},
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_secret}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    runs = payload.get("data", {}).get("skillRuns") or []
    return [r for r in runs if isinstance(r, dict)]


def main() -> int:
    api_url = _env("THINKWORK_API_URL")
    api_secret = _env("THINKWORK_API_SECRET")
    tenant_id = _env("TENANT_ID")

    print(f"[sandbox-pilot] pilot v{PILOT_VERSION} starting")
    print(f"[sandbox-pilot] tenant={tenant_id}")

    runs = _graphql_skill_runs(api_url, api_secret, tenant_id)
    print(f"[sandbox-pilot] fetched {len(runs)} skill_runs rows")

    # The agent's next step is to call execute_code() with pandas +
    # matplotlib to summarise these rows — not to do it from this
    # script. The sandbox tool is what exercises the E2E substrate;
    # this script just shows the agent a canonical starting point.
    #
    # Sample prompt the operator gives the sandbox-pilot agent:
    #
    #   "Run the sandbox pilot: use execute_code to pandas-summarise
    #    the skill_runs I just fetched, plot a bar chart of counts by
    #    skill_id, save it as /tmp/pilot.png, upload to S3 with boto3,
    #    and post the public URL to #bot-lab via Slack's chat.postMessage.
    #    Report ok when you see the message in Slack."
    sample_prompt = (
        "Run the sandbox pilot: use execute_code to pandas-summarise "
        "the attached skill_runs, plot counts per skill_id, upload the "
        "PNG to S3, and post the URL to Slack."
    )
    print("[sandbox-pilot] sample prompt:")
    print(sample_prompt)
    print("[sandbox-pilot] ok — agent should now call execute_code")
    return 0


if __name__ == "__main__":
    sys.exit(main())
