import { managedApplications_ as managedApplications } from "./managedApplications.query.js";
import { managedApplicationDeployment } from "./managedApplicationDeployment.query.js";
import { deploymentEvidence } from "./deploymentEvidence.query.js";
import { deploymentReleases } from "./deploymentReleases.query.js";
import { releaseUpdateJob } from "./releaseUpdateJob.query.js";
import { startReleaseUpdatePreflight } from "./startReleaseUpdatePreflight.mutation.js";
import { startDeploymentReleaseUpdate } from "./startDeploymentReleaseUpdate.mutation.js";
import { startManagedApplicationPlan } from "./startManagedApplicationPlan.mutation.js";
import { approveManagedApplicationDeployment } from "./approveManagedApplicationDeployment.mutation.js";
import { rejectManagedApplicationDeployment } from "./rejectManagedApplicationDeployment.mutation.js";

export const deploymentQueries = {
  managedApplications,
  managedApplicationDeployment,
  deploymentEvidence,
  deploymentReleases,
  releaseUpdateJob,
};

export const deploymentMutations = {
  startReleaseUpdatePreflight,
  startDeploymentReleaseUpdate,
  startManagedApplicationPlan,
  approveManagedApplicationDeployment,
  rejectManagedApplicationDeployment,
};
