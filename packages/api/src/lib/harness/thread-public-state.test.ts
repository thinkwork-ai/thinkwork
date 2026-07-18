import { describe, expect, it } from "vitest";
import {
  formatCanonicalArtifactReference,
  isPublicArtifactMetadata,
} from "./thread-public-state.js";

describe("canonical Harness artifact references", () => {
  it("projects only stable public metadata", () => {
    expect(
      formatCanonicalArtifactReference({
        id: "row-1",
        artifactId: "artifact-1",
        artifactType: "document",
        name: "Quarterly plan",
      }),
    ).toBe(
      "[Public artifact reference] name=Quarterly plan type=document artifact_id=artifact-1",
    );
  });

  it("fails closed when a captured artifact is later restricted", () => {
    expect(isPublicArtifactMetadata(undefined)).toBe(true);
    expect(isPublicArtifactMetadata({ access_state: "public" })).toBe(true);
    expect(isPublicArtifactMetadata({ access_state: "withheld" })).toBe(false);
    expect(isPublicArtifactMetadata({ access_state: "restricted" })).toBe(
      false,
    );
  });
});
