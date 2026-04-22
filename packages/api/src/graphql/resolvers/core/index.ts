import { tenant } from "./tenant.query.js";
import { tenantBySlug } from "./tenantBySlug.query.js";
import { me } from "./me.query.js";
import { user } from "./user.query.js";
import { tenantMembers_ as tenantMembers } from "./tenantMembers.query.js";
import { createTenant } from "./createTenant.mutation.js";
import { updateTenant } from "./updateTenant.mutation.js";
import { updateTenantPolicy } from "./updateTenantPolicy.mutation.js";
import { updateTenantSettings } from "./updateTenantSettings.mutation.js";
import { addTenantMember } from "./addTenantMember.mutation.js";
import { updateTenantMember } from "./updateTenantMember.mutation.js";
import { removeTenantMember } from "./removeTenantMember.mutation.js";
import { updateUser } from "./updateUser.mutation.js";
import { updateUserProfile } from "./updateUserProfile.mutation.js";
import { inviteMember } from "./inviteMember.mutation.js";
import { registerPushToken } from "./registerPushToken.mutation.js";
import { unregisterPushToken } from "./unregisterPushToken.mutation.js";
import { bootstrapUser } from "./bootstrapUser.mutation.js";
import { deploymentStatus } from "./deploymentStatus.query.js";
import { adminRoleCheck } from "./adminRoleCheck.query.js";

export const coreQueries = {
  tenant,
  tenantBySlug,
  me,
  user,
  tenantMembers,
  deploymentStatus,
  adminRoleCheck,
};
export const coreMutations = {
  bootstrapUser,
  createTenant,
  updateTenant,
  updateTenantPolicy,
  updateTenantSettings,
  addTenantMember,
  updateTenantMember,
  removeTenantMember,
  inviteMember,
  updateUser,
  updateUserProfile,
  registerPushToken,
  unregisterPushToken,
};
