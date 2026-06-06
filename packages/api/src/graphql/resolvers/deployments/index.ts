import { managedApplications_ as managedApplications } from "./managedApplications.query.js";
import { managedApplicationDeployment } from "./managedApplicationDeployment.query.js";
import { deploymentEvidence } from "./deploymentEvidence.query.js";
import { startManagedApplicationPlan } from "./startManagedApplicationPlan.mutation.js";
import { approveManagedApplicationDeployment } from "./approveManagedApplicationDeployment.mutation.js";
import { rejectManagedApplicationDeployment } from "./rejectManagedApplicationDeployment.mutation.js";

export const deploymentQueries = {
  managedApplications,
  managedApplicationDeployment,
  deploymentEvidence,
};

export const deploymentMutations = {
  startManagedApplicationPlan,
  approveManagedApplicationDeployment,
  rejectManagedApplicationDeployment,
};
