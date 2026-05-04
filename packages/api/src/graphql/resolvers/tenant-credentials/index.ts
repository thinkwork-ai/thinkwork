import { tenantCredentials_ as tenantCredentials } from "./tenantCredentials.query.js";
import { createTenantCredential } from "./createTenantCredential.mutation.js";
import { updateTenantCredential } from "./updateTenantCredential.mutation.js";
import { rotateTenantCredential } from "./rotateTenantCredential.mutation.js";
import { deleteTenantCredential } from "./deleteTenantCredential.mutation.js";

export const tenantCredentialQueries = { tenantCredentials };

export const tenantCredentialMutations = {
  createTenantCredential,
  updateTenantCredential,
  rotateTenantCredential,
  deleteTenantCredential,
};
