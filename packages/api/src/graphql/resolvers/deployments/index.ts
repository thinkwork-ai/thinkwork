import { managedApplications_ as managedApplications } from "./managedApplications.query.js";
import { managedApplicationDeployment } from "./managedApplicationDeployment.query.js";
import { deploymentEvidence } from "./deploymentEvidence.query.js";
import { deploymentReleases } from "./deploymentReleases.query.js";
import { startDeploymentReleaseUpdate } from "./startDeploymentReleaseUpdate.mutation.js";
import { startManagedApplicationPlan } from "./startManagedApplicationPlan.mutation.js";
import { approveManagedApplicationDeployment } from "./approveManagedApplicationDeployment.mutation.js";
import { rejectManagedApplicationDeployment } from "./rejectManagedApplicationDeployment.mutation.js";

export const deploymentQueries = {
  managedApplications,
  managedApplicationDeployment,
  deploymentEvidence,
  deploymentReleases,
};

export const deploymentMutations = {
  startDeploymentReleaseUpdate,
  startManagedApplicationPlan,
  approveManagedApplicationDeployment,
  rejectManagedApplicationDeployment,
};
