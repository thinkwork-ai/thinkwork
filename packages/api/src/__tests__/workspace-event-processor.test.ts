import { describe, expect, it, vi } from "vitest";
import {
  persistWorkspaceEvent,
  type WorkspaceEventStore,
} from "../lib/workspace-events/processor.js";
import type { CanonicalWorkspaceEventDraft } from "../lib/workspace-events/canonicalize.js";
import type { ParsedWorkspaceEventKey } from "../lib/workspace-events/key-parser.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const WAKEUP_ID = "00000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-04-26T12:00:00.000Z");

function parsedKey(
  overrides: Partial<ParsedWorkspaceEventKey> = {},
): ParsedWorkspaceEventKey {
  return {
    tenantSlug: "acme",
    agentSlug: "marco",
    workspaceRelativePath: "customers/acme/work/inbox/request.md",
    targetPath: "customers/acme",
    eventfulKind: "work_inbox",
    fileName: "request.md",
    ...overrides,
  };
}

function draft(
  overrides: Partial<CanonicalWorkspaceEventDraft> = {},
): CanonicalWorkspaceEventDraft {
  return {
    eventType: "work.requested",
    idempotencyKey: "idem-1",
    payload: {
      targetPath: "customers/acme",
      workspaceRelativePath: "customers/acme/work/inbox/request.md",
      fileName: "request.md",
    },
    ...overrides,
  };
}

function metadata() {
  return {
    bucket: "bucket",
    sourceObjectKey:
      "tenants/acme/agents/marco/workspace/customers/acme/work/inbox/request.md",
    sequencer: "001",
    detailType: "Object Created",
    objectEtag: "etag-1",
  };
}

function createStore(
  options: {
    tenantEnabled?: boolean;
    duplicate?: boolean;
    existingRun?: boolean;
  } = {},
) {
  const runs: any[] = options.existingRun
    ? [
        {
          id: RUN_ID,
          tenant_id: TENANT_ID,
          agent_id: AGENT_ID,
          target_path: "customers/acme",
          status: "processing",
        },
      ]
    : [];
  const events: any[] = [];
  const wakeups: any[] = [];
  const mirrorUpdates: any[] = [];

  const store: WorkspaceEventStore = {
    async findTenantBySlug(slug) {
      if (slug !== "acme") return null;
      return {
        id: TENANT_ID,
        slug,
        workspace_orchestration_enabled: options.tenantEnabled ?? true,
      };
    },
    async findAgentByTenantAndSlug(tenantId, agentSlug) {
      if (tenantId !== TENANT_ID || agentSlug !== "marco") return null;
      return { id: AGENT_ID, tenant_id: TENANT_ID, slug: agentSlug };
    },
    async findRunById(runId) {
      return runs.find((run) => run.id === runId) ?? null;
    },
    async createRun(values) {
      const run = {
        id: values.id,
        tenant_id: values.tenant_id,
        agent_id: values.agent_id,
        target_path: values.target_path,
        status: values.status,
      };
      runs.push(run);
      return run;
    },
    async updateRun(runId, updates) {
      const run = runs.find((candidate) => candidate.id === runId);
      Object.assign(run, updates);
    },
    async updateRunWakeup(runId, wakeupRequestId) {
      const run = runs.find((candidate) => candidate.id === runId);
      run.current_wakeup_request_id = wakeupRequestId;
    },
    async insertEvent(values) {
      if (options.duplicate) return null;
      const event = { id: 42, ...values };
      events.push(event);
      return event;
    },
    async updateEventMirror(eventId, updates) {
      mirrorUpdates.push({ eventId, ...updates });
    },
    async insertWakeup(values) {
      const wakeup = { id: WAKEUP_ID, ...values };
      wakeups.push(wakeup);
      return wakeup;
    },
  };

  return { store, runs, events, wakeups, mirrorUpdates };
}

describe("workspace event processor", () => {
  it("creates a workspace run, event row, audit mirror, and wakeup for inbox work", async () => {
    const { store, runs, events, wakeups, mirrorUpdates } = createStore();

    const result = await persistWorkspaceEvent(
      parsedKey(),
      draft(),
      metadata(),
      {
        store,
        now: () => NOW,
        newRunId: () => RUN_ID,
        logger: silentLogger(),
      },
    );

    expect(result).toEqual({
      status: "processed",
      eventId: 42,
      runId: RUN_ID,
      wakeupRequestId: WAKEUP_ID,
    });
    expect(runs[0]).toMatchObject({
      id: RUN_ID,
      tenant_id: TENANT_ID,
      agent_id: AGENT_ID,
      target_path: "customers/acme",
      status: "pending",
      current_wakeup_request_id: WAKEUP_ID,
    });
    expect(events[0]).toMatchObject({
      tenant_id: TENANT_ID,
      agent_id: AGENT_ID,
      run_id: RUN_ID,
      event_type: "work.requested",
      idempotency_key: "idem-1",
      bucket: "bucket",
      source_object_key:
        "tenants/acme/agents/marco/workspace/customers/acme/work/inbox/request.md",
    });
    expect(wakeups[0]).toMatchObject({
      tenant_id: TENANT_ID,
      agent_id: AGENT_ID,
      source: "workspace_event",
      trigger_detail: "workspace_event:42",
      status: "queued",
      idempotency_key: "idem-1",
      requested_by_actor_type: "system",
    });
    expect(wakeups[0].payload).toMatchObject({
      workspaceRunId: RUN_ID,
      workspaceEventId: 42,
      targetPath: "customers/acme",
      causeType: "work.requested",
    });
    expect(mirrorUpdates[0]).toEqual({
      eventId: 42,
      audit_object_key:
        "tenants/acme/agents/marco/workspace/events/audit/2026-04-26/42.json",
      mirror_status: "ok",
    });
  });

  it("ignores tenants until the orchestration flag is enabled", async () => {
    const { store, events, wakeups } = createStore({ tenantEnabled: false });

    const result = await persistWorkspaceEvent(
      parsedKey(),
      draft(),
      metadata(),
      {
        store,
        now: () => NOW,
        logger: silentLogger(),
      },
    );

    expect(result).toEqual({ status: "ignored", reason: "tenant_disabled" });
    expect(events).toEqual([]);
    expect(wakeups).toEqual([]);
  });

  it("does not enqueue a wakeup when an idempotent event already exists", async () => {
    const { store, wakeups } = createStore({ duplicate: true });

    const result = await persistWorkspaceEvent(
      parsedKey(),
      draft(),
      metadata(),
      {
        store,
        now: () => NOW,
        newRunId: () => RUN_ID,
        logger: silentLogger(),
      },
    );

    expect(result).toEqual({ status: "duplicate", idempotencyKey: "idem-1" });
    expect(wakeups).toEqual([]);
  });

  it("marks existing runs as awaiting review without waking the agent", async () => {
    const { store, runs, events, wakeups } = createStore({ existingRun: true });

    const result = await persistWorkspaceEvent(
      parsedKey({
        workspaceRelativePath: `review/${RUN_ID}.needs-human.md`,
        targetPath: "",
        eventfulKind: "review",
        fileName: `${RUN_ID}.needs-human.md`,
      }),
      draft({
        eventType: "review.requested",
        runId: RUN_ID,
        payload: {
          targetPath: "",
          workspaceRelativePath: `review/${RUN_ID}.needs-human.md`,
          fileName: `${RUN_ID}.needs-human.md`,
        },
      }),
      {
        ...metadata(),
        sourceObjectKey: `tenants/acme/agents/marco/workspace/review/${RUN_ID}.needs-human.md`,
      },
      {
        store,
        now: () => NOW,
        logger: silentLogger(),
      },
    );

    expect(result).toMatchObject({
      status: "processed",
      eventId: 42,
      runId: RUN_ID,
    });
    expect(runs[0].status).toBe("awaiting_review");
    expect(events[0]).toMatchObject({
      run_id: RUN_ID,
      event_type: "review.requested",
    });
    expect(wakeups).toEqual([]);
  });
});

function silentLogger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
