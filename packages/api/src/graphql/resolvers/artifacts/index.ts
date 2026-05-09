import { artifacts_ as artifacts } from "./artifacts.query.js";
import { artifact } from "./artifact.query.js";
import { createArtifact } from "./createArtifact.mutation.js";
import { updateArtifact } from "./updateArtifact.mutation.js";
import { deleteArtifact } from "./deleteArtifact.mutation.js";

export const artifactQueries = { artifacts, artifact };
export const artifactMutations = {
  createArtifact,
  updateArtifact,
  deleteArtifact,
};
