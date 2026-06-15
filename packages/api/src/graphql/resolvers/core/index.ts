import { tenant } from "./tenant.query.js";
import { tenantBySlug } from "./tenantBySlug.query.js";
import { me } from "./me.query.js";
import { user } from "./user.query.js";
import { tenantMembers_ as tenantMembers } from "./tenantMembers.query.js";
import { createTenant } from "./createTenant.mutation.js";
import { updateTenant } from "./updateTenant.mutation.js";
import { renameTenantSlug } from "./renameTenantSlug.mutation.js";
import { updateTenantPolicy } from "./updateTenantPolicy.mutation.js";
import { updateTenantSettings } from "./updateTenantSettings.mutation.js";
import { setKnowledgeGraphDeployment } from "./setKnowledgeGraphDeployment.mutation.js";
import { setManagedApplicationDeployment } from "./setManagedApplicationDeployment.mutation.js";
import { installManagedApplicationMcpServer } from "./installManagedApplicationMcpServer.mutation.js";
import { addTenantMember } from "./addTenantMember.mutation.js";
import { updateTenantMember } from "./updateTenantMember.mutation.js";
import { removeTenantMember } from "./removeTenantMember.mutation.js";
import { updateUser } from "./updateUser.mutation.js";
import { updateUserProfile } from "./updateUserProfile.mutation.js";
import { inviteMember } from "./inviteMember.mutation.js";
import { resendMemberInvite } from "./resendMemberInvite.mutation.js";
import { registerPushToken } from "./registerPushToken.mutation.js";
import { unregisterPushToken } from "./unregisterPushToken.mutation.js";
import { bootstrapUser } from "./bootstrapUser.mutation.js";
import { deploymentStatus } from "./deploymentStatus.query.js";
import { knowledgeGraphHealthCheck } from "./knowledgeGraphHealthCheck.query.js";
import { managedApplicationHealthCheck } from "./managedApplicationHealthCheck.query.js";
import { adminRoleCheck } from "./adminRoleCheck.query.js";

export const coreQueries = {
  tenant,
  tenantBySlug,
  me,
  user,
  tenantMembers,
  deploymentStatus,
  knowledgeGraphHealthCheck,
  managedApplicationHealthCheck,
  adminRoleCheck,
};
export const coreMutations = {
  bootstrapUser,
  createTenant,
  updateTenant,
  renameTenantSlug,
  updateTenantPolicy,
  updateTenantSettings,
  setKnowledgeGraphDeployment,
  setManagedApplicationDeployment,
  installManagedApplicationMcpServer,
  addTenantMember,
  updateTenantMember,
  removeTenantMember,
  inviteMember,
  resendMemberInvite,
  updateUser,
  updateUserProfile,
  registerPushToken,
  unregisterPushToken,
};
