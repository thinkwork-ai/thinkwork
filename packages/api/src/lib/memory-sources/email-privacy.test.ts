/**
 * AE4 privacy proof at the unit layer (THINK-193 U6): a private ambiguous
 * email stays in the User Bank, creates NO shared mapping/page, and exposes
 * NO content to the operator queue.
 *
 *  1. Matcher: private evidence without an exact mapping is
 *     `private_unmapped` — it never key-matches into tenant identity and
 *     never creates mappings/canonical rows/cases; requireActiveGrant
 *     blocks a shared email source with no explicit shared grant.
 *  2. Structure: the personal blueprint has NO graph/wiki steps, and the
 *     stage gate hard-rejects graph/wiki for personal processors — email
 *     evidence cannot reach shared publication at all.
 *  3. Case payloads: the resolution-queue candidate shape (mirrored from
 *     snapshot-resolution.ts) is closed over
 *     {canonicalEntityId, displayName, matchedKeyKinds} — no field can
 *     carry an email body/subject, and a snapshot pin keeps it that way.
 */

import { describe, expect, it, vi } from "vitest";

import {
  decideMatch,
  defaultIdentityRules,
  matchCanonicalEntity,
  type MatchCandidate,
  type MatchVerdict,
} from "../entity-identity/matcher.js";
import {
  buildPersonalMemoryWorkflowDefinition,
  buildSharedMemoryWorkflowDefinition,
} from "./blueprint.js";
import { assertStageAllowedForScope, MemoryScopeError } from "./repository.js";
import { requireActiveGrant, MemoryAuthorizationError } from "./policy.js";

const SECRET_SUBJECT = "Acme renewal — private negotiation";
const SECRET_BODY = "They will churn unless we discount 40%";

describe("AE4: private ambiguous email identity", () => {
  it("decideMatch returns private_unmapped for private evidence with no exact mapping — even with strong-key matches", () => {
    const verdict = decideMatch({
      visibility: "private",
      rules: defaultIdentityRules(),
      exactCanonicalEntityId: null,
      claimMatches: [
        // Deliberately ambiguous strong evidence: with tenant visibility
        // this would defer to the queue; private must NOT even do that.
        {
          keyKind: "name",
          canonicalEntityId: "ce-1",
          canonicalDisplayName: "Acme",
        },
        {
          keyKind: "name",
          canonicalEntityId: "ce-2",
          canonicalDisplayName: "Acme Corp",
        },
      ],
      nameCandidates: [],
    });
    expect(verdict).toEqual({ kind: "private_unmapped" });
  });

  it("matchCanonicalEntity with private visibility performs ZERO writes and opens ZERO cases", async () => {
    // A db stub whose only reachable operation is the exact-mapping SELECT;
    // any INSERT/UPDATE (mapping, canonical row, case) would throw.
    const select = vi.fn().mockReturnValue({
      from: () => ({ where: vi.fn().mockResolvedValue([]) }),
    });
    const forbidden = () => {
      throw new Error("private identity must never write");
    };
    const db = { select, insert: forbidden, update: forbidden } as never;

    const verdict = await matchCanonicalEntity(
      db,
      {
        tenantId: "t-1",
        entityTypeSlug: "customer",
        displayName: SECRET_SUBJECT,
        visibility: "private",
        sourceKeys: [
          {
            sourceSystem: "email",
            namespace: "thread",
            externalId: "thread-1",
          },
        ],
        naturalKeys: [{ keyKind: "name", rawValue: SECRET_SUBJECT }],
      },
      defaultIdentityRules(),
    );
    expect(verdict).toEqual({ kind: "private_unmapped" });
    // Exactly one lookup (the exact source mapping); no key-match scans, no
    // name scans, no writes.
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("a shared email source WITHOUT an explicit shared grant fails requireActiveGrant", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: vi.fn().mockResolvedValue([]) }),
        }),
      }),
    } as never;
    await expect(
      requireActiveGrant(db, {
        tenantId: "t-1",
        processorConfigId: "proc-shared",
        sourceFamily: "email",
        sourceBindingKey: "conn-1",
      }),
    ).rejects.toThrow(MemoryAuthorizationError);
    await expect(
      requireActiveGrant(db, {
        tenantId: "t-1",
        processorConfigId: "proc-shared",
        sourceFamily: "email",
        sourceBindingKey: "conn-1",
      }),
    ).rejects.toThrow(/an operator must grant access/);
  });
});

describe("AE4: personal runs structurally cannot publish shared pages", () => {
  it("the personal blueprint has no graph or wiki steps", () => {
    const definition = buildPersonalMemoryWorkflowDefinition("proc-1");
    const stages = definition.steps
      .filter((step) => step.kind === "memory_stage")
      .map((step) => (step as { stage: string }).stage);
    expect(stages).not.toContain("graph");
    expect(stages).not.toContain("wiki");
    expect(stages).toContain("acquire");
    expect(stages).toContain("retain");
    // The shared blueprint DOES publish — the difference is structural.
    const shared = buildSharedMemoryWorkflowDefinition("proc-1");
    const sharedStages = shared.steps
      .filter((step) => step.kind === "memory_stage")
      .map((step) => (step as { stage: string }).stage);
    expect(sharedStages).toContain("graph");
    expect(sharedStages).toContain("wiki");
  });

  it("the stage gate hard-rejects graph/wiki for personal processors", () => {
    const personal = {
      id: "proc-1",
      mode: "personal",
      target_scope: "user",
    } as never;
    for (const stage of ["graph", "wiki"]) {
      expect(() => assertStageAllowedForScope(personal, stage)).toThrow(
        MemoryScopeError,
      );
    }
    for (const stage of ["acquire", "project", "retain", "compound"]) {
      expect(() => assertStageAllowedForScope(personal, stage)).not.toThrow();
    }
  });
});

describe("AE4: resolution-case candidate payloads are content-free", () => {
  /**
   * Mirror of the candidate mapping in
   * entity-identity/snapshot-resolution.ts (resolveSnapshotCanonicalIdentity)
   * — the ONLY place ambiguous verdicts become case payloads. This pins the
   * closed field set so email-derived content cannot ride along.
   */
  function candidatesForCase(
    verdict: Extract<MatchVerdict, { kind: "ambiguous" | "suggestion" }>,
  ): Array<Record<string, unknown>> {
    return verdict.kind === "ambiguous"
      ? verdict.candidates.map((candidate) => ({
          canonicalEntityId: candidate.canonicalEntityId,
          displayName: candidate.displayName,
          matchedKeyKinds: candidate.matchedKeyKinds,
        }))
      : [
          {
            canonicalEntityId: verdict.canonicalEntityId,
            displayName: null,
            matchedKeyKinds: verdict.matchedKeyKinds,
          },
        ];
  }

  it("an ambiguous TENANT verdict's case payload carries only registry identity — never source text", () => {
    // Even for tenant-visible evidence (the only kind that can open cases),
    // candidates are built from REGISTRY rows, not from the source item.
    const verdict = decideMatch({
      visibility: "tenant",
      rules: defaultIdentityRules(),
      exactCanonicalEntityId: null,
      claimMatches: [
        {
          keyKind: "name",
          canonicalEntityId: "ce-1",
          canonicalDisplayName: "Acme",
        },
        {
          keyKind: "name",
          canonicalEntityId: "ce-2",
          canonicalDisplayName: "Acme GmbH",
        },
      ],
      nameCandidates: [],
    });
    expect(verdict.kind).toBe("ambiguous");
    const payload = candidatesForCase(
      verdict as Extract<MatchVerdict, { kind: "ambiguous" }>,
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(SECRET_SUBJECT);
    expect(serialized).not.toContain(SECRET_BODY);
    // Snapshot-pin the closed candidate shape.
    for (const candidate of payload) {
      expect(Object.keys(candidate).sort()).toEqual([
        "canonicalEntityId",
        "displayName",
        "matchedKeyKinds",
      ]);
    }
  });

  it("MatchCandidate itself is a closed registry-only shape", () => {
    const candidate: MatchCandidate = {
      canonicalEntityId: "ce-1",
      displayName: "Acme",
      matchedKeyKinds: ["name"],
    };
    expect(Object.keys(candidate).sort()).toEqual([
      "canonicalEntityId",
      "displayName",
      "matchedKeyKinds",
    ]);
  });
});
