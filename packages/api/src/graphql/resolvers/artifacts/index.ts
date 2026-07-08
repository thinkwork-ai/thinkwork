import { artifacts_ as artifacts } from "./artifacts.query.js";
import { artifact } from "./artifact.query.js";
import { documentArtifact } from "./documentArtifact.query.js";
import { documentVersionRender } from "./documentVersionRender.query.js";
import { threadCanvasContext } from "./threadCanvasContext.query.js";
import { createArtifact } from "./createArtifact.mutation.js";
import { saveCanvas } from "./saveCanvas.mutation.js";
import { snapshotArtifact } from "./snapshotArtifact.mutation.js";
import { checkoutCanvas } from "./checkoutCanvas.mutation.js";
import { refreshCanvasData } from "./refreshCanvasData.mutation.js";
import { createCanvasRefreshSchedule } from "./createCanvasRefreshSchedule.mutation.js";
import { updateArtifact } from "./updateArtifact.mutation.js";
import { deleteArtifact } from "./deleteArtifact.mutation.js";
import { mintArtifactShareLink } from "./mintArtifactShareLink.mutation.js";
import { revokeArtifactShareLink } from "./revokeArtifactShareLink.mutation.js";
import {
  artifactShares_ as artifactShares,
  tenantArtifactShares,
} from "./artifactShares.query.js";
import {
  artifactTypeResolvers,
  artifactVersionTypeResolvers,
} from "./types.js";

export { artifactTypeResolvers, artifactVersionTypeResolvers };
export const artifactQueries = {
  artifacts,
  artifact,
  documentArtifact,
  documentVersionRender,
  threadCanvasContext,
  artifactShares,
  tenantArtifactShares,
};
export const artifactMutations = {
  createArtifact,
  saveCanvas,
  snapshotArtifact,
  checkoutCanvas,
  refreshCanvasData,
  createCanvasRefreshSchedule,
  updateArtifact,
  deleteArtifact,
  mintArtifactShareLink,
  revokeArtifactShareLink,
};
