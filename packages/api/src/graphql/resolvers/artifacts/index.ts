import { artifacts_ as artifacts } from "./artifacts.query.js";
import { artifact } from "./artifact.query.js";
import { createArtifact } from "./createArtifact.mutation.js";
import { promoteGenUIArtifact } from "./promoteGenUIArtifact.mutation.js";
import { saveCanvas } from "./saveCanvas.mutation.js";
import { pinArtifact } from "./pinArtifact.mutation.js";
import { checkoutCanvas } from "./checkoutCanvas.mutation.js";
import { refreshCanvasData } from "./refreshCanvasData.mutation.js";
import { createCanvasRefreshSchedule } from "./createCanvasRefreshSchedule.mutation.js";
import { updateArtifact } from "./updateArtifact.mutation.js";
import { deleteArtifact } from "./deleteArtifact.mutation.js";
import {
  artifactTypeResolvers,
  artifactVersionTypeResolvers,
} from "./types.js";

export { artifactTypeResolvers, artifactVersionTypeResolvers };
export const artifactQueries = { artifacts, artifact };
export const artifactMutations = {
  createArtifact,
  promoteGenUIArtifact,
  saveCanvas,
  pinArtifact,
  checkoutCanvas,
  refreshCanvasData,
  createCanvasRefreshSchedule,
  updateArtifact,
  deleteArtifact,
};
