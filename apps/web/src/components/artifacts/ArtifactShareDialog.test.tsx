/**
 * THINK-208 U5 test scenarios: audience copy behavior (members = app URL, no
 * mint; public = mint + copy), existing-share surfacing with creator-gated
 * Revoke, revoke confirmation flow, and mint-failure inline error.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mintMock,
  revokeMock,
  sharesQueryState,
  reexecuteMock,
  tenantState,
  queryDocs,
  clipboardMock,
} = vi.hoisted(() => ({
  mintMock: vi.fn(),
  revokeMock: vi.fn(),
  sharesQueryState: { data: undefined as unknown, fetching: false },
  reexecuteMock: vi.fn(),
  tenantState: {
    userId: "user-1",
    isOperator: false,
    roleResolved: true,
  },
  queryDocs: {
    MintArtifactShareLinkMutation: Symbol("Mint"),
    RevokeArtifactShareLinkMutation: Symbol("Revoke"),
    ArtifactSharesQuery: Symbol("Shares"),
  },
  clipboardMock: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: (doc: unknown) => {
    if (doc === queryDocs.MintArtifactShareLinkMutation)
      return [{ fetching: false }, mintMock];
    if (doc === queryDocs.RevokeArtifactShareLinkMutation)
      return [{ fetching: false }, revokeMock];
    return [{ fetching: false }, vi.fn()];
  },
  useQuery: () => [sharesQueryState, reexecuteMock],
}));

vi.mock("@/lib/graphql-queries", () => queryDocs);
vi.mock("@/context/TenantContext", () => ({
  useTenant: () => tenantState,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ArtifactShareDialog } from "./ArtifactShareDialog";

const SHARE = {
  id: "share-1",
  artifactId: "art-1",
  artifactTitle: "Q2 Review",
  createdBy: "user-1",
  createdByName: "Eric",
  createdAt: "2026-07-06T00:00:00Z",
};

function renderDialog() {
  return render(
    <ArtifactShareDialog
      artifactId="art-1"
      artifactTitle="Q2 Review"
      open
      onOpenChange={() => {}}
    />,
  );
}

beforeEach(() => {
  mintMock.mockReset();
  revokeMock.mockReset();
  reexecuteMock.mockReset();
  clipboardMock.mockReset();
  sharesQueryState.data = undefined;
  tenantState.userId = "user-1";
  tenantState.isOperator = false;
  Object.assign(navigator, {
    clipboard: { writeText: clipboardMock },
  });
});
afterEach(cleanup);

describe("ArtifactShareDialog", () => {
  it("copies the app URL for workspace members without minting (R3)", () => {
    renderDialog();
    fireEvent.click(screen.getByTestId("share-copy-members"));
    expect(clipboardMock).toHaveBeenCalledWith(
      `${window.location.origin}/artifacts/art-1`,
    );
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("mints and copies the public URL for anyone-with-the-link", async () => {
    mintMock.mockResolvedValue({
      data: {
        mintArtifactShareLink: {
          url: "https://api.example.com/share/tok.sig",
          share: SHARE,
        },
      },
    });
    renderDialog();
    fireEvent.click(screen.getByTestId("share-copy-public"));
    await waitFor(() => {
      expect(mintMock).toHaveBeenCalledWith({ artifactId: "art-1" });
    });
    expect(clipboardMock).toHaveBeenCalledWith(
      "https://api.example.com/share/tok.sig",
    );
    // urql doc-cache workaround: explicit network-only refetch after mint.
    expect(reexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("shows the existing active share without minting; creator sees Revoke", () => {
    sharesQueryState.data = { artifactShares: [SHARE] };
    renderDialog();
    expect(screen.getByTestId("share-active-row")).toBeTruthy();
    expect(screen.getByText(/shared by you/i)).toBeTruthy();
    expect(screen.getByTestId("share-revoke")).toBeTruthy();
    expect(mintMock).not.toHaveBeenCalled();
  });

  it("a non-creator member sees the creator's name and no Revoke button", () => {
    sharesQueryState.data = { artifactShares: [SHARE] };
    tenantState.userId = "user-2";
    renderDialog();
    expect(screen.getByText(/shared by Eric/i)).toBeTruthy();
    expect(screen.queryByTestId("share-revoke")).toBeNull();
  });

  it("an operator who is not the creator still sees Revoke", () => {
    sharesQueryState.data = { artifactShares: [SHARE] };
    tenantState.userId = "user-2";
    tenantState.isOperator = true;
    renderDialog();
    expect(screen.getByTestId("share-revoke")).toBeTruthy();
  });

  it("revoke requires confirming the warning before the mutation fires", async () => {
    sharesQueryState.data = { artifactShares: [SHARE] };
    revokeMock.mockResolvedValue({ data: { revokeArtifactShareLink: true } });
    renderDialog();

    fireEvent.click(screen.getByTestId("share-revoke"));
    expect(revokeMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("share-revoke-dialog")).toBeTruthy();
    expect(screen.getByText(/loses access immediately/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId("share-revoke-confirm"));
    await waitFor(() => {
      expect(revokeMock).toHaveBeenCalledWith({ shareId: "share-1" });
    });
    expect(reexecuteMock).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("mint failure renders an inline error, no clipboard write, retry possible", async () => {
    mintMock.mockResolvedValue({ error: new Error("boom") });
    renderDialog();
    fireEvent.click(screen.getByTestId("share-copy-public"));
    await waitFor(() => {
      expect(screen.getByTestId("share-mint-error")).toBeTruthy();
    });
    expect(clipboardMock).not.toHaveBeenCalled();
    // The audience button is still active for retry.
    const retry = screen.getByTestId("share-copy-public");
    expect(retry.hasAttribute("disabled")).toBe(false);
  });
});
