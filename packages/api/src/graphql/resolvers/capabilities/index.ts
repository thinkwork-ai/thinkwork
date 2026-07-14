import { capabilityInspector } from "./capabilityInspector.query.js";
import {
  workspacePreview,
  workspacePreviewFile,
} from "./workspacePreview.query.js";
import {
  grantCapability,
  detachCapability,
} from "./capabilityAssignment.mutations.js";
import { connectionResearch } from "./connectionResearch.query.js";
import { capabilityRuntimeCatalog } from "./capabilityRuntimeCatalog.query.js";
import {
  capabilityCredentialBindings,
  tenantServicePrincipals,
} from "./capabilityBindings.query.js";
import {
  createConnectionProposal,
  admitConnectionProposal,
  rejectConnectionProposal,
} from "./connectionProposal.mutations.js";
import {
  createServicePrincipal,
  revokeServicePrincipal,
} from "./servicePrincipal.mutations.js";
import {
  createCredentialBinding,
  verifyCredentialBinding,
  revokeCredentialBinding,
} from "./credentialBinding.mutations.js";
import {
  externalCapabilityClients,
  createExternalCapabilityClient,
  rotateExternalCapabilityClient,
  revokeExternalCapabilityClient,
} from "./externalCapabilityClient.mutations.js";

export const capabilityQueries = {
  capabilityInspector,
  workspacePreview,
  workspacePreviewFile,
  // Governed capability runtime control plane (THINK-280 U2)
  connectionResearch,
  capabilityRuntimeCatalog,
  capabilityCredentialBindings,
  tenantServicePrincipals,
  // Governed capability runtime — external MCP search (THINK-280 U8)
  externalCapabilityClients,
};

export const capabilityMutations = {
  grantCapability,
  detachCapability,
  // Governed capability runtime control plane (THINK-280 U2)
  createConnectionProposal,
  admitConnectionProposal,
  rejectConnectionProposal,
  createServicePrincipal,
  revokeServicePrincipal,
  createCredentialBinding,
  verifyCredentialBinding,
  revokeCredentialBinding,
  // Governed capability runtime — external MCP search (THINK-280 U8)
  createExternalCapabilityClient,
  rotateExternalCapabilityClient,
  revokeExternalCapabilityClient,
};
