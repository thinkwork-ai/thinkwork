import { graphql } from "@/gql";

// Typed graphql() operations for the governed capability runtime control
// plane (THINK-280 U2): catalog, connection research, admission, service
// principals, and credential-binding readiness. Resolvers are implemented in
// packages/api against packages/database-pg/graphql/types/capability-runtime.graphql.
//
// Credential material never crosses this surface — bindings expose readiness
// state and redacted probe evidence only.

// ─── Catalog ────────────────────────────────────────────────────────────

export const CapabilityRuntimeCatalogQuery = graphql(`
  query CapabilityRuntimeCatalog($tenantId: ID!) {
    capabilityRuntimeCatalog(tenantId: $tenantId) {
      id
      tenantId
      namespace
      class
      slug
      displayName
      status
      createdAt
      versions {
        id
        version
        lifecycle
        descriptorFingerprint
        createdAt
      }
      admittedVersion {
        id
        version
        lifecycle
        descriptorFingerprint
        descriptor
        provenance
        signature
        admittedAt
        admittedByUserId
        admissionMode
        admittedByAgentId
        operations {
          operationId
          twcap
          contractHash
          effect
          principalModes
          approvalPolicy
          costClass
          latencyClass
          outputClass
          executable
          withheldReasons
        }
      }
    }
  }
`);

// ─── Research ───────────────────────────────────────────────────────────

export const ConnectionResearchQuery = graphql(`
  query ConnectionResearch(
    $tenantId: ID!
    $query: String!
    $allowExternal: Boolean
  ) {
    connectionResearch(
      tenantId: $tenantId
      query: $query
      allowExternal: $allowExternal
    ) {
      state
      stateDetail
      definitions {
        id
        namespace
        class
        slug
        displayName
        status
        admittedVersion {
          id
          version
          descriptorFingerprint
        }
      }
      proposals {
        id
        definitionId
        payload
        payloadFingerprint
        provenance
        status
        createdByActorType
        decidedAt
        createdAt
      }
    }
  }
`);

export const AdmitConnectionProposalMutation = graphql(`
  mutation AdmitConnectionProposal($input: AdmitConnectionProposalInput!) {
    admitConnectionProposal(input: $input) {
      outcome
      reason
      definition {
        id
        slug
      }
      version {
        id
        version
        descriptorFingerprint
      }
      proposal {
        id
        status
      }
    }
  }
`);

export const RejectConnectionProposalMutation = graphql(`
  mutation RejectConnectionProposal(
    $tenantId: ID!
    $proposalId: ID!
    $reason: String
  ) {
    rejectConnectionProposal(
      tenantId: $tenantId
      proposalId: $proposalId
      reason: $reason
    ) {
      outcome
      reason
      proposal {
        id
        status
      }
    }
  }
`);

// ─── Routine promotion proposals (THINK-280 U6) ─────────────────────────
// Immutable, non-executable Routine promotion bundles. Approval is exact +
// single-use: the operator approves the payloadFingerprint they reviewed,
// and a mismatch (post-review edit → new fingerprint) is rejected
// server-side. The approve result carries the promotion verdict.

export const RoutineProposalQuery = graphql(`
  query RoutineProposal($id: ID!) {
    routineProposal(id: $id) {
      id
      tenantId
      routineId
      payload
      payloadFingerprint
      evidenceRefs
      status
      approvalMode
      approvalEvidence
      inboxItemId
      createdByActorType
      createdByActorId
      decidedAt
      decidedByUserId
      promotedCommitSha
      createdAt
    }
  }
`);

export const RoutineProposalsQuery = graphql(`
  query RoutineProposals($tenantId: ID!, $routineId: ID, $status: String) {
    routineProposals(
      tenantId: $tenantId
      routineId: $routineId
      status: $status
    ) {
      id
      tenantId
      routineId
      payloadFingerprint
      status
      approvalMode
      inboxItemId
      createdByActorType
      createdByActorId
      decidedAt
      promotedCommitSha
      createdAt
    }
  }
`);

export const ApproveRoutineProposalMutation = graphql(`
  mutation ApproveRoutineProposal($input: ApproveRoutineProposalInput!) {
    approveRoutineProposal(input: $input) {
      outcome
      reason
      promotionOutcome
      promotedCommitSha
      validatedSha
      hermetic
      proposal {
        id
        status
        approvalMode
        payloadFingerprint
        decidedAt
        decidedByUserId
        promotedCommitSha
      }
    }
  }
`);

export const RejectRoutineProposalMutation = graphql(`
  mutation RejectRoutineProposal(
    $tenantId: ID!
    $proposalId: ID!
    $reason: String
  ) {
    rejectRoutineProposal(
      tenantId: $tenantId
      proposalId: $proposalId
      reason: $reason
    ) {
      outcome
      reason
      proposal {
        id
        status
        decidedAt
      }
    }
  }
`);

// ─── Service principals + credential bindings ───────────────────────────

export const TenantServicePrincipalsQuery = graphql(`
  query TenantServicePrincipals($tenantId: ID!) {
    tenantServicePrincipals(tenantId: $tenantId) {
      id
      slug
      displayName
      purpose
      status
      createdAt
      revokedAt
    }
  }
`);

export const CapabilityCredentialBindingsQuery = graphql(`
  query CapabilityCredentialBindings($tenantId: ID!) {
    capabilityCredentialBindings(tenantId: $tenantId) {
      id
      definitionVersionId
      principalMode
      servicePrincipalId
      subjectUserId
      readiness
      readinessEvidence
      lastVerifiedAt
      revokedAt
      createdAt
    }
  }
`);

export const CreateServicePrincipalMutation = graphql(`
  mutation CreateServicePrincipal($input: CreateServicePrincipalInput!) {
    createServicePrincipal(input: $input) {
      outcome
      reason
      servicePrincipal {
        id
        slug
        status
      }
    }
  }
`);

export const RevokeServicePrincipalMutation = graphql(`
  mutation RevokeServicePrincipal($tenantId: ID!, $servicePrincipalId: ID!) {
    revokeServicePrincipal(
      tenantId: $tenantId
      servicePrincipalId: $servicePrincipalId
    ) {
      outcome
      reason
      servicePrincipal {
        id
        status
      }
    }
  }
`);

export const CreateCredentialBindingMutation = graphql(`
  mutation CreateCredentialBinding($input: CreateCredentialBindingInput!) {
    createCredentialBinding(input: $input) {
      outcome
      reason
      binding {
        id
        readiness
      }
    }
  }
`);

export const VerifyCredentialBindingMutation = graphql(`
  mutation VerifyCredentialBinding($tenantId: ID!, $bindingId: ID!) {
    verifyCredentialBinding(tenantId: $tenantId, bindingId: $bindingId) {
      outcome
      reason
      binding {
        id
        readiness
        lastVerifiedAt
      }
    }
  }
`);

export const RevokeCredentialBindingMutation = graphql(`
  mutation RevokeCredentialBinding($tenantId: ID!, $bindingId: ID!) {
    revokeCredentialBinding(tenantId: $tenantId, bindingId: $bindingId) {
      outcome
      reason
      binding {
        id
        readiness
        revokedAt
      }
    }
  }
`);

// ─── External confidential capability clients (THINK-280 U8) ─────────────
// Operator-only confidential M2M clients for the scoped /mcp/capabilities
// external search facade. Each maps one-to-one to an active service principal
// and is permitted EXACTLY the capabilities resource + capabilities:search.
// The clientSecret is revealed ONCE (create/rotate) and is null on list reads.

export const ExternalCapabilityClientsQuery = graphql(`
  query ExternalCapabilityClients($tenantId: ID!) {
    externalCapabilityClients(tenantId: $tenantId) {
      id
      clientId
      servicePrincipalId
      allowedResource
      allowedScopes
      status
      createdAt
      rotatedAt
      revokedAt
    }
  }
`);

export const CreateExternalCapabilityClientMutation = graphql(`
  mutation CreateExternalCapabilityClient(
    $input: CreateExternalCapabilityClientInput!
  ) {
    createExternalCapabilityClient(input: $input) {
      outcome
      reason
      client {
        id
        clientId
        servicePrincipalId
        allowedScopes
        status
        clientSecret
      }
    }
  }
`);

export const RotateExternalCapabilityClientMutation = graphql(`
  mutation RotateExternalCapabilityClient($tenantId: ID!, $clientId: String!) {
    rotateExternalCapabilityClient(tenantId: $tenantId, clientId: $clientId) {
      outcome
      reason
      client {
        id
        clientId
        status
        clientSecret
      }
    }
  }
`);

export const RevokeExternalCapabilityClientMutation = graphql(`
  mutation RevokeExternalCapabilityClient($tenantId: ID!, $clientId: String!) {
    revokeExternalCapabilityClient(tenantId: $tenantId, clientId: $clientId) {
      outcome
      reason
      client {
        id
        clientId
        status
      }
    }
  }
`);
