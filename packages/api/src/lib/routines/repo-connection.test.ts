import { describe, expect, it, vi } from "vitest";
import {
  parseGithubRepoUrl,
  validateGithubRepoConnection,
  type OctokitFactory,
} from "./repo-connection";

function fakeOctokit(overrides: {
  get?: () => Promise<unknown>;
  getBranch?: () => Promise<unknown>;
}): OctokitFactory {
  return () =>
    ({
      repos: {
        get: overrides.get ?? (async () => ({})),
        getBranch: overrides.getBranch ?? (async () => ({})),
      },
    }) as never;
}

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("parseGithubRepoUrl", () => {
  it("accepts https, ssh, and owner/repo forms with optional .git", () => {
    for (const url of [
      "https://github.com/acme/routines",
      "https://github.com/acme/routines.git",
      "https://github.com/acme/routines/",
      "git@github.com:acme/routines.git",
      "acme/routines",
    ]) {
      expect(parseGithubRepoUrl(url)).toEqual({
        owner: "acme",
        repo: "routines",
      });
    }
  });

  it("rejects non-GitHub hosts — v1 is GitHub-only", () => {
    expect(() =>
      parseGithubRepoUrl("https://gitlab.com/acme/routines"),
    ).toThrow(/GitHub/);
    expect(() => parseGithubRepoUrl("not a url at all")).toThrow(/GitHub/);
  });
});

describe("validateGithubRepoConnection", () => {
  const payload = {
    repoUrl: "https://github.com/acme/routines",
    token: "ghp_test",
    branch: "main",
  };

  it("returns the parsed ref when repo and branch resolve", async () => {
    await expect(
      validateGithubRepoConnection(payload, fakeOctokit({})),
    ).resolves.toEqual({ owner: "acme", repo: "routines" });
  });

  it("surfaces an actionable error when the token is rejected", async () => {
    const factory = fakeOctokit({
      get: async () => {
        throw httpError(401);
      },
    });
    await expect(
      validateGithubRepoConnection(payload, factory),
    ).rejects.toThrow(/token was rejected \(401\)/);
  });

  it("surfaces an actionable error when the repo is invisible to the token", async () => {
    const factory = fakeOctokit({
      get: async () => {
        throw httpError(404);
      },
    });
    await expect(
      validateGithubRepoConnection(payload, factory),
    ).rejects.toThrow(/not found \(404\)/);
  });

  it("rejects when the configured branch does not exist", async () => {
    const getBranch = vi.fn(async () => {
      throw httpError(404);
    });
    const factory = fakeOctokit({ getBranch });
    await expect(
      validateGithubRepoConnection(payload, factory),
    ).rejects.toThrow(/Branch "main" not found/);
    expect(getBranch).toHaveBeenCalledOnce();
  });

  it("never validates the branch before repo access is confirmed", async () => {
    const getBranch = vi.fn(async () => ({}));
    const factory = fakeOctokit({
      get: async () => {
        throw httpError(403);
      },
      getBranch,
    });
    await expect(
      validateGithubRepoConnection(payload, factory),
    ).rejects.toThrow(/lacks access \(403\)/);
    expect(getBranch).not.toHaveBeenCalled();
  });
});
