---
date: 2026-06-14
topic: plane-application-plugin
linear: THNK-27
---

# Plane Application Plugin

ThinkWork needs a self-hosted, open source, agent-friendly task management
system so agents can keep context anchored to durable work items as those items
move through a workflow. Plane is the candidate because it provides project
management, work items, cycles, modules, pages, an API, and an official MCP
server.

V1 packages Plane as a curated ThinkWork Application Plugin, not as a custom
ThinkWork issue tracker.

## Requirements

- Plane ships under plugin key `plane`.
- Plane declares infrastructure for a self-hosted runtime.
- Plane declares a skills component with at least one issue-loop skill.
- Plane declares an MCP component only after the endpoint and per-user auth
  shape are supported by the ThinkWork MCP runtime.
- Runtime deployment is Docker/container based on AWS-managed primitives;
  Kubernetes is out of scope.
- Runtime data must use deliberate production-leaning services: dedicated
  Postgres, Redis-compatible cache, RabbitMQ, and S3-compatible storage.
- Park preserves Plane data, files, credentials, and the re-enable path; destroy
  is separate and destructive.
- Agent actions must be user scoped. No tenant-wide Plane API key may power
  user-scoped work.
- A bundled `plane--issue-loop` skill must require agents to read work item
  context first, preserve findings back to Plane, make narrow writes, and
  resolve readable IDs such as `ENG-42` to UUIDs before UUID-only tool calls.
- THNK-27 is only ready for verification after a test path deploys Plane,
  seeds sample data, proves a ThinkWork agent can read the seeded data, and
  creates a new Plane work item through Plane MCP.

## Decisions

- Use the Application Plugin model from
  `docs/brainstorms/2026-06-12-application-plugins-requirements.md`.
- Use Twenty as the closest infrastructure precedent.
- Use AWS ECS/Fargate-style Docker deployment, not Kubernetes.
- Use per-user Plane activation. The current ThinkWork MCP manifest/runtime
  supports OAuth and bearer-token dispatch, while Plane HTTP PAT mode requires
  `x-api-key` and `x-workspace-slug` headers; that activation/runtime contract
  is an explicit implementation dependency before registering an MCP component.

## Sources

- Linear issue: THNK-27, "Add Plane Plugin".
- Linear document: "Requirements: Plane Application Plugin".
- Plane repository: `https://github.com/makeplane/plane`.
- Plane self-hosting docs: `https://developers.plane.so/self-hosting/overview`.
- Plane Docker Compose docs:
  `https://developers.plane.so/self-hosting/methods/docker-compose`.
- Plane environment variables:
  `https://developers.plane.so/self-hosting/govern/environment-variables`.
- Plane external services:
  `https://developers.plane.so/self-hosting/govern/database-and-storage`.
- Plane MCP server docs: `https://developers.plane.so/dev-tools/mcp-server`.
