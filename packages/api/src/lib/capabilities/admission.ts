/**
 * Connection admission control plane (THINK-280 U2 — R4, R5; A3; AE3).
 *
 * Admission is the ONLY path that turns research into signed, working
 * capability state: it consumes an exact single-use proposal fingerprint,
 * fail-closed-validates the proposed descriptor against
 * @thinkwork/capability-contracts, appends an immutable `admitted`
 * capability_definition_versions row (signed with the platform capability
 * signer), and materializes the folder projection through an injected
 * writer seam (folder-write.ts semantics — tests never hit S3).
 *
 * Immutability invariants:
 *   - no update path for admitted versions exists in this module — a
 *     second admission for the same definition creates version N+1 and
 *     leaves version N byte-identical;
 *   - refresh (`createCandidateVersion`, AE3) inserts a `candidate`
 *     version only — it never touches the admitted version, existing
 *     grants, or bindings.
 *
 * DB work runs in ONE transaction; the folder projection is written
 * after commit. A folder-write failure returns outcome 'applied' with
 * reason 'projection_pending' — the version row is authoritative.
 */

import { and, eq } from "drizzle-orm";
import { stringify as stringifyYaml } from "yaml";
import {
  capabilityConnectionProposals,
  capabilityDefinitions,
  capabilityDefinitionVersions,
} from "@thinkwork/database-pg/schema";
import {
  assertValidDescriptor,
  CanonicalizationError,
  canonicalSha256Hex,
  CapabilityContractError,
  descriptorFingerprint,
  formatTwcapRef,
  operationContractHash,
  type CapabilityDescriptor,
} from "@thinkwork/capability-contracts";
import { classifyDescriptor } from "./self-extension-policy.js";
import {
  autoProvisionServiceBinding,
  type AutoProvisionBindingDeps,
  type AutoProvisionServiceBindingResult,
} from "./self-extension-binding.js";
import type { FolderWriteResult } from "./folder-write.js";
import type {
  CapabilitySignedBy,
  CapabilitySigner,
} from "./sidecar-signing.js";
import type {
  CapabilityActor,
  CapabilityConnectionProposalRow,
  CapabilityDefinitionRow,
  Db,
} from "./research.js";

export type CapabilityDefinitionVersionRow =
  typeof capabilityDefinitionVersions.$inferSelect;

/**
 * Folder projection seam (putCapabilityFolder semantics). The service
 * wiring slice supplies the S3-backed implementation and target-prefix
 * resolution; tests inject a recording stub.
 */
export interface AdmissionFolderWriter {
  write(input: {
    tenantId: string;
    klass: "connection";
    slug: string;
    definition: string;
    sidecar: {
      enabled?: boolean;
      permissions?: { operations?: string[] };
    };
    signedBy: CapabilitySignedBy;
  }): Promise<FolderWriteResult>;
}

export interface AdmitConnectionProposalInput {
  tenantId: string;
  proposalId: string;
  /** Exact fingerprint the operator reviewed — single-use exact approval. */
  reviewedFingerprint: string;
  adminUserId: string;
  signer: CapabilitySigner;
  folderWriter?: AdmissionFolderWriter;
}

export interface AdmitConnectionProposalResult {
  outcome: "applied" | "rejected";
  reason?: string;
  definition?: CapabilityDefinitionRow;
  version?: CapabilityDefinitionVersionRow;
  proposal?: CapabilityConnectionProposalRow;
}

const ADMISSIBLE_PROPOSAL_STATUSES = new Set(["draft", "submitted"]);
const PLATFORM_NAMESPACE = "platform";

/** Who is admitting: a reviewing operator, or an agent self-extending. */
type AdmissionActor =
  | { mode: "operator"; userId: string }
  | { mode: "autonomous"; agentId: string };

interface RunAdmissionParams {
  tenantId: string;
  proposalId: string;
  /** Operator-only: the exact fingerprint the reviewer approved. Ignored for autonomous. */
  reviewedFingerprint: string;
  actor: AdmissionActor;
  signer: CapabilitySigner;
  folderWriter?: AdmissionFolderWriter;
  /**
   * Autonomous only: every operation must classify `auto` (public, read-only,
   * no-credential, reversible, fully classified) or the whole admission is
   * rejected with `held_for_review` — never a silent partial admit.
   */
  enforceAutoTier: boolean;
}

/**
 * Admit a reviewed connection proposal: exact-fingerprint approval, signed
 * immutable version row, folder projection after commit. Shared by the
 * operator path ({@link admitConnectionProposal}) and the autonomous
 * self-extension path ({@link autonomouslyAdmitProposal}) — the version-insert
 * logic and immutability invariants are identical; only the admitter identity,
 * fingerprint semantics, and the auto-tier gate differ.
 */
async function runAdmission(
  db: Db,
  input: RunAdmissionParams,
): Promise<AdmitConnectionProposalResult> {
  const signedBy: CapabilitySignedBy =
    input.actor.mode === "operator"
      ? `operator:${input.actor.userId}`
      : `autonomous:${input.actor.agentId}`;
  const admitterUserId =
    input.actor.mode === "operator" ? input.actor.userId : null;
  const admitterAgentId =
    input.actor.mode === "autonomous" ? input.actor.agentId : null;

  const txOutcome = await db.transaction(
    async (
      tx,
    ): Promise<
      | { kind: "rejected"; reason: string }
      | {
          kind: "admitted";
          definition: CapabilityDefinitionRow;
          version: CapabilityDefinitionVersionRow;
          proposal: CapabilityConnectionProposalRow;
          descriptor: CapabilityDescriptor;
          finalVersion: number;
          fingerprint: string;
          contractHashes: Record<string, string>;
        }
    > => {
      // (a) Load the proposal for THIS tenant; only undecided proposals
      // are admissible.
      const [proposal] = await tx
        .select()
        .from(capabilityConnectionProposals)
        .where(eq(capabilityConnectionProposals.id, input.proposalId))
        .limit(1);
      if (!proposal || proposal.tenant_id !== input.tenantId) {
        return { kind: "rejected", reason: "proposal_not_found" };
      }
      if (!ADMISSIBLE_PROPOSAL_STATUSES.has(proposal.status)) {
        return { kind: "rejected", reason: "proposal_already_decided" };
      }

      // (b) Exact single-use approval: the recomputed fingerprint must
      // equal BOTH the stored fingerprint and the reviewed one. A mismatch
      // is a rejection, never a silent re-review.
      let recomputed: string;
      try {
        recomputed = canonicalSha256Hex(proposal.payload_json);
      } catch (err) {
        return {
          kind: "rejected",
          reason:
            err instanceof CanonicalizationError
              ? `payload_not_canonicalizable: ${err.message}`
              : "payload_not_canonicalizable",
        };
      }
      if (recomputed !== proposal.payload_fingerprint) {
        return { kind: "rejected", reason: "fingerprint_mismatch" };
      }
      // Operator admission is an exact single-use review: the reviewed
      // fingerprint must match what is admitted. Autonomous admission has no
      // separate reviewer — the agent admits exactly the proposal it composed.
      if (
        input.actor.mode === "operator" &&
        recomputed !== input.reviewedFingerprint
      ) {
        return { kind: "rejected", reason: "fingerprint_mismatch" };
      }

      // (c) The payload must carry a descriptor that passes the shared
      // fail-closed contract validator.
      const payload =
        proposal.payload_json && typeof proposal.payload_json === "object"
          ? (proposal.payload_json as Record<string, unknown>)
          : {};
      const rawDescriptor = payload.descriptor;
      if (rawDescriptor === undefined) {
        return { kind: "rejected", reason: "descriptor: missing from payload" };
      }
      let descriptor: CapabilityDescriptor;
      try {
        assertValidDescriptor(rawDescriptor);
        descriptor = rawDescriptor;
      } catch (err) {
        return {
          kind: "rejected",
          reason:
            err instanceof CapabilityContractError
              ? err.violations.join("; ")
              : "descriptor: invalid",
        };
      }

      // (c.5) Autonomous self-extension ceiling. An agent may self-admit ONLY
      // an auto-tier descriptor (public, read-only, no-credential, reversible,
      // fully classified). Anything else is held for one-click operator review.
      if (
        input.enforceAutoTier &&
        classifyDescriptor(descriptor).tier !== "auto"
      ) {
        return { kind: "rejected", reason: "held_for_review" };
      }

      // (d) Upsert the logical definition by (namespace, class, slug).
      // Tenant proposals always produce tenant-scoped definitions; the
      // 'platform' namespace is reserved for tenant_id-null definitions.
      if (descriptor.namespace === PLATFORM_NAMESPACE) {
        return { kind: "rejected", reason: "platform_namespace_reserved" };
      }
      const existingDefinitions = await tx
        .select()
        .from(capabilityDefinitions)
        .where(
          and(
            eq(capabilityDefinitions.namespace, descriptor.namespace),
            eq(capabilityDefinitions.class, descriptor.class),
            eq(capabilityDefinitions.slug, descriptor.slug),
          ),
        );
      let definition = existingDefinitions.find(
        (row) =>
          row.namespace === descriptor.namespace &&
          row.class === descriptor.class &&
          row.slug === descriptor.slug,
      );
      if (definition && definition.tenant_id !== input.tenantId) {
        return { kind: "rejected", reason: "definition_tenant_mismatch" };
      }
      if (
        definition &&
        proposal.definition_id &&
        proposal.definition_id !== definition.id
      ) {
        return { kind: "rejected", reason: "definition_mismatch" };
      }
      if (!definition) {
        const displayName =
          typeof payload.displayName === "string" &&
          payload.displayName.trim() !== ""
            ? payload.displayName
            : descriptor.slug;
        const [created] = await tx
          .insert(capabilityDefinitions)
          .values({
            tenant_id: input.tenantId,
            namespace: descriptor.namespace,
            class: descriptor.class,
            slug: descriptor.slug,
            display_name: displayName,
            status: "active",
            created_by_user_id: admitterUserId,
          })
          .returning();
        definition = created!;
      }

      // (e) Append the admitted version: max(existing)+1, declared
      // descriptor version recorded in provenance on mismatch.
      const existingVersions = await tx
        .select()
        .from(capabilityDefinitionVersions)
        .where(eq(capabilityDefinitionVersions.definition_id, definition.id));
      const maxVersion = existingVersions.reduce(
        (max, row) => Math.max(max, row.version),
        0,
      );
      const finalVersion = maxVersion + 1;
      const declaredVersion = Number.parseInt(descriptor.version, 10);

      const fingerprint = descriptorFingerprint(descriptor);
      const contractHashes = Object.fromEntries(
        descriptor.operations.map((op) => [
          op.operationId,
          operationContractHash(op),
        ]),
      );
      const signature = input.signer.signPayload(
        descriptor as unknown as Record<string, unknown>,
        { signedBy },
      );
      const proposalProvenance =
        proposal.provenance_json && typeof proposal.provenance_json === "object"
          ? (proposal.provenance_json as Record<string, unknown>)
          : {};
      const now = new Date();
      const [version] = await tx
        .insert(capabilityDefinitionVersions)
        .values({
          definition_id: definition.id,
          version: finalVersion,
          descriptor_json: descriptor,
          descriptor_fingerprint: fingerprint,
          contract_hashes_json: contractHashes,
          signature_json: signature,
          lifecycle: "admitted",
          provenance_json: {
            ...proposalProvenance,
            proposalId: proposal.id,
            proposalFingerprint: proposal.payload_fingerprint,
            ...(declaredVersion !== finalVersion
              ? { declaredDescriptorVersion: descriptor.version }
              : {}),
          },
          source_proposal_id: proposal.id,
          admitted_at: now,
          admitted_by_user_id: admitterUserId,
          admission_mode: input.actor.mode,
          admitted_by_agent_id: admitterAgentId,
        })
        .returning();

      // (f) Decide the proposal.
      const [decidedProposal] = await tx
        .update(capabilityConnectionProposals)
        .set({
          status: "admitted",
          definition_id: definition.id,
          decided_at: now,
          decided_by_user_id: admitterUserId,
        })
        .where(eq(capabilityConnectionProposals.id, proposal.id))
        .returning();

      return {
        kind: "admitted",
        definition,
        version: version!,
        proposal: decidedProposal ?? proposal,
        descriptor,
        finalVersion,
        fingerprint,
        contractHashes,
      };
    },
  );

  if (txOutcome.kind === "rejected") {
    return { outcome: "rejected", reason: txOutcome.reason };
  }

  const applied: AdmitConnectionProposalResult = {
    outcome: "applied",
    definition: txOutcome.definition,
    version: txOutcome.version,
    proposal: txOutcome.proposal,
  };

  // (g/h) Folder projection AFTER commit — failure never unwinds the
  // authoritative version row.
  if (input.folderWriter) {
    try {
      const written = await input.folderWriter.write({
        tenantId: input.tenantId,
        klass: "connection",
        slug: txOutcome.descriptor.slug,
        definition: connectionDefinitionFromDescriptor({
          descriptor: txOutcome.descriptor,
          finalVersion: txOutcome.finalVersion,
          fingerprint: txOutcome.fingerprint,
          contractHashes: txOutcome.contractHashes,
          displayName: txOutcome.definition.display_name,
        }),
        sidecar: {
          enabled: true,
          permissions: {
            operations: txOutcome.descriptor.operations.map(
              (op) => op.operationId,
            ),
          },
        },
        signedBy,
      });
      if (!written.ok) {
        return { ...applied, reason: "projection_pending" };
      }
    } catch {
      return { ...applied, reason: "projection_pending" };
    }
  }
  return applied;
}

/**
 * Operator admission: exact single-use fingerprint approval by a human. Byte-
 * for-byte the original behavior — the shared core just carries the actor.
 */
export async function admitConnectionProposal(
  db: Db,
  input: AdmitConnectionProposalInput,
): Promise<AdmitConnectionProposalResult> {
  return runAdmission(db, {
    tenantId: input.tenantId,
    proposalId: input.proposalId,
    reviewedFingerprint: input.reviewedFingerprint,
    actor: { mode: "operator", userId: input.adminUserId },
    signer: input.signer,
    folderWriter: input.folderWriter,
    enforceAutoTier: false,
  });
}

export interface AutonomouslyAdmitProposalInput {
  tenantId: string;
  proposalId: string;
  /** The agent self-extending — recorded as `autonomous:<agentId>` provenance. */
  agentId: string;
  signer: CapabilitySigner;
  folderWriter?: AdmissionFolderWriter;
  /**
   * When present, a successful auto-tier admission also auto-provisions the
   * agent's service principal + an empty-credential binding and drives it to
   * `ready` via the read-only reachability probe (U2b) — making the
   * self-admitted public capability actually runnable with no human. Omit it
   * to admit only (e.g. in tests that don't exercise runnability). The real
   * probe/secret-resolver deps are injected by the Pi Lambda action (U4).
   */
  provisioner?: AutoProvisionBindingDeps;
}

export interface AutonomouslyAdmitProposalResult {
  /** `held_for_review`: the descriptor is not auto-tier — the proposal is left
   *  for a human operator to admit through the normal review flow. */
  outcome: "applied" | "rejected" | "held_for_review";
  reason?: string;
  definition?: CapabilityDefinitionRow;
  version?: CapabilityDefinitionVersionRow;
  proposal?: CapabilityConnectionProposalRow;
  /**
   * Result of the auto-provisioning step (U2b), present only when a
   * `provisioner` was supplied and admission `applied`. A `degraded` binding
   * still means admission succeeded — the auto-run will correctly block until
   * the binding reaches `ready`.
   */
  binding?: AutoProvisionServiceBindingResult;
}

/**
 * Autonomous self-extension admission: an agent admits a proposal it composed,
 * with NO human — but ONLY when every operation is auto-tier (public, read-only,
 * no-credential, reversible, fully classified). A non-auto descriptor returns
 * `held_for_review` and the proposal is left untouched for the operator.
 * The admitted version stays fully attributable (`admission_mode: autonomous`,
 * `admitted_by_agent_id`) and every downstream call remains brokered, evidenced,
 * and revocable.
 */
export async function autonomouslyAdmitProposal(
  db: Db,
  input: AutonomouslyAdmitProposalInput,
): Promise<AutonomouslyAdmitProposalResult> {
  const result = await runAdmission(db, {
    tenantId: input.tenantId,
    proposalId: input.proposalId,
    reviewedFingerprint: "", // no separate reviewer — ignored for autonomous
    actor: { mode: "autonomous", agentId: input.agentId },
    signer: input.signer,
    folderWriter: input.folderWriter,
    enforceAutoTier: true,
  });
  if (result.outcome === "rejected" && result.reason === "held_for_review") {
    return { outcome: "held_for_review", reason: "held_for_review" };
  }

  // U2b: make the self-admitted public capability actually runnable — provision
  // the agent's service principal + empty-credential binding and drive it to
  // `ready`. Only on a clean applied admission with a version to bind, and only
  // when the caller supplied the real probe/secret-resolver deps.
  if (
    result.outcome === "applied" &&
    result.version &&
    input.provisioner !== undefined
  ) {
    const binding = await autoProvisionServiceBinding(
      db,
      {
        tenantId: input.tenantId,
        definitionVersionId: result.version.id,
        agentId: input.agentId,
      },
      input.provisioner,
    );
    return { ...result, binding };
  }

  return result;
}

export interface CreateCandidateVersionInput {
  tenantId: string;
  definitionId: string;
  descriptor: unknown;
  provenance: Record<string, unknown>;
  actor: CapabilityActor;
}

export interface CreateCandidateVersionResult {
  outcome: "applied" | "rejected";
  reason?: string;
  definition?: CapabilityDefinitionRow;
  version?: CapabilityDefinitionVersionRow;
}

/**
 * Refresh path (AE3): a re-researched descriptor becomes a NEW
 * `candidate` version (max+1). The admitted version, existing grants,
 * and bindings are never touched; the candidate stays unsigned and
 * non-executable until its own admission.
 */
export async function createCandidateVersion(
  db: Db,
  input: CreateCandidateVersionInput,
): Promise<CreateCandidateVersionResult> {
  let descriptor: CapabilityDescriptor;
  try {
    assertValidDescriptor(input.descriptor);
    descriptor = input.descriptor;
  } catch (err) {
    return {
      outcome: "rejected",
      reason:
        err instanceof CapabilityContractError
          ? err.violations.join("; ")
          : "descriptor: invalid",
    };
  }

  return db.transaction(async (tx) => {
    const [definition] = await tx
      .select()
      .from(capabilityDefinitions)
      .where(eq(capabilityDefinitions.id, input.definitionId))
      .limit(1);
    if (!definition || definition.tenant_id !== input.tenantId) {
      return {
        outcome: "rejected" as const,
        reason: "definition_not_found",
      };
    }
    if (
      definition.namespace !== descriptor.namespace ||
      definition.class !== descriptor.class ||
      definition.slug !== descriptor.slug
    ) {
      return {
        outcome: "rejected" as const,
        reason: "descriptor_identity_mismatch",
      };
    }

    const existingVersions = await tx
      .select()
      .from(capabilityDefinitionVersions)
      .where(eq(capabilityDefinitionVersions.definition_id, definition.id));
    const maxVersion = existingVersions.reduce(
      (max, row) => Math.max(max, row.version),
      0,
    );
    const finalVersion = maxVersion + 1;
    const declaredVersion = Number.parseInt(descriptor.version, 10);

    const [version] = await tx
      .insert(capabilityDefinitionVersions)
      .values({
        definition_id: definition.id,
        version: finalVersion,
        descriptor_json: descriptor,
        descriptor_fingerprint: descriptorFingerprint(descriptor),
        contract_hashes_json: Object.fromEntries(
          descriptor.operations.map((op) => [
            op.operationId,
            operationContractHash(op),
          ]),
        ),
        lifecycle: "candidate",
        provenance_json: {
          ...input.provenance,
          createdByActorType: input.actor.type,
          ...(input.actor.id ? { createdByActorId: input.actor.id } : {}),
          ...(declaredVersion !== finalVersion
            ? { declaredDescriptorVersion: descriptor.version }
            : {}),
        },
      })
      .returning();

    return {
      outcome: "applied" as const,
      definition,
      version: version!,
    };
  });
}

/**
 * Materialized `connections/<slug>/CONNECTION.md` projection of an
 * admitted descriptor. The frontmatter `capability_ref` carries the first
 * operation's full twcap reference plus the descriptor fingerprint —
 * exactly the U1b shadow shape `parseConnectionDefinition` parses; the
 * body lists every operation's twcap reference.
 */
export function connectionDefinitionFromDescriptor(input: {
  descriptor: CapabilityDescriptor;
  finalVersion: number;
  fingerprint: string;
  contractHashes: Record<string, string>;
  displayName?: string;
}): string {
  const { descriptor } = input;
  const refs = descriptor.operations.map((op) => ({
    operationId: op.operationId,
    twcap: formatTwcapRef({
      namespace: descriptor.namespace,
      class: descriptor.class,
      slug: descriptor.slug,
      version: String(input.finalVersion),
      operationId: op.operationId,
      contractHash: input.contractHashes[op.operationId]!,
    }),
  }));
  const displayName = input.displayName ?? descriptor.slug;
  const frontmatter = stringifyYaml({
    name: descriptor.slug,
    description: `${displayName} — admitted capability connection (version ${input.finalVersion}).`,
    type: descriptor.adapter.kind === "mcp" ? "mcp" : "api",
    operations: descriptor.operations.map((op) => op.operationId),
    capability_ref: {
      twcap: refs[0]!.twcap,
      descriptor_fingerprint: input.fingerprint,
    },
  }).trimEnd();
  const operationLines = refs
    .map((ref) => `- \`${ref.operationId}\`: ${ref.twcap}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${displayName} — admitted by the ThinkWork capability control plane. The signed version row in capability_definition_versions is authoritative; this folder is a projection. Credentials resolve from platform stores at dispatch, never from this folder.\n\n## Operations\n\n${operationLines}\n`;
}
