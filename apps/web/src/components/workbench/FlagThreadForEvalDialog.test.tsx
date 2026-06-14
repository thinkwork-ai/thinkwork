/**
 * Flag-for-evaluation dialog tests (Trust Core U7).
 *
 * Pins the dialog contract: submit stays disabled until a resolution
 * target exists (server-side AE3's client mirror), the raw-copy
 * disclosure renders, baseline datasets are excluded from the picker,
 * and the mutation receives the typed input.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "urql";
import { FlaggedTurnSkillCandidatesQuery } from "@/lib/evaluation-queries";
import { FlagThreadForEvalDialog } from "./FlagThreadForEvalDialog";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useQuery: vi.fn(),
    useMutation: vi.fn(),
  };
});

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

const flagMutation = vi.fn();

let datasetsData: unknown;
let candidatesData: unknown;

function setupMocks() {
  vi.mocked(useQuery).mockImplementation((args) => {
    const data =
      args.query === FlaggedTurnSkillCandidatesQuery
        ? candidatesData
        : datasetsData;
    return [{ data, fetching: false, stale: false }, vi.fn()] as never;
  });
  vi.mocked(useMutation).mockImplementation(
    () => [{ fetching: false, stale: false }, flagMutation] as never,
  );
}

function renderDialog() {
  return render(
    <FlagThreadForEvalDialog
      open
      onOpenChange={vi.fn()}
      tenantId="tenant-1"
      threadId="thread-1"
      turnId="turn-1"
    />,
  );
}

beforeEach(() => {
  datasetsData = { evalDatasets: [] };
  candidatesData = {
    flaggedTurnSkillCandidates: { candidates: [], fallback: false },
  };
  flagMutation.mockReset();
  flagMutation.mockResolvedValue({
    data: { flagThreadForEval: { dataset: { slug: "d" } } },
  });
  setupMocks();
});

afterEach(() => {
  cleanup();
  vi.mocked(useQuery).mockReset();
  vi.mocked(useMutation).mockReset();
});

describe("FlagThreadForEvalDialog", () => {
  it("renders the raw-copy disclosure", () => {
    renderDialog();
    expect(
      screen.getByText(
        /Flagging copies the raw conversation \(including anything pasted into it\) into a long-lived evaluation artifact\./,
      ),
    ).toBeTruthy();
  });

  it("submit is disabled without a resolution target", () => {
    renderDialog();
    // No custom datasets → create-new mode with a name filled in; the
    // resolution target alone should still gate the submit.
    fireEvent.change(screen.getByTestId("flag-eval-new-dataset-name"), {
      target: { value: "My dataset" },
    });
    const submit = screen.getByTestId("flag-eval-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("flag-eval-resolution-target"), {
      target: { value: "   " },
    });
    expect(
      (screen.getByTestId("flag-eval-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("submit is disabled in create-new mode without a dataset name", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("flag-eval-resolution-target"), {
      target: { value: "Should cite a source." },
    });
    expect(
      (screen.getByTestId("flag-eval-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("submits the typed input for a new dataset", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("flag-eval-new-dataset-name"), {
      target: { value: "Bad threads" },
    });
    fireEvent.change(screen.getByTestId("flag-eval-resolution-target"), {
      target: { value: "Should cite a source." },
    });
    const submit = screen.getByTestId("flag-eval-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(flagMutation).toHaveBeenCalledTimes(1));
    expect(flagMutation).toHaveBeenCalledWith({
      input: {
        threadId: "thread-1",
        turnId: "turn-1",
        datasetSlug: null,
        newDatasetName: "Bad threads",
        resolutionTarget: "Should cite a source.",
        outcomeKind: "quality",
      },
    });
  });

  it("defaults to the first existing custom dataset and submits its slug", async () => {
    datasetsData = {
      evalDatasets: [
        // Baseline + archived datasets are not valid flag targets.
        {
          id: "b",
          slug: "baseline",
          name: "Baseline",
          kind: "baseline",
          archivedAt: null,
        },
        {
          id: "a",
          slug: "old",
          name: "Old",
          kind: "custom",
          archivedAt: "2026-01-01",
        },
        {
          id: "c",
          slug: "flags",
          name: "Flags",
          kind: "custom",
          archivedAt: null,
        },
      ],
    };
    setupMocks();
    renderDialog();

    // Existing-dataset mode: no new-name input rendered.
    expect(screen.queryByTestId("flag-eval-new-dataset-name")).toBeNull();

    fireEvent.change(screen.getByTestId("flag-eval-resolution-target"), {
      target: { value: "Should refuse." },
    });
    fireEvent.click(screen.getByTestId("flag-eval-kind-security"));
    fireEvent.click(screen.getByTestId("flag-eval-submit"));

    await waitFor(() => expect(flagMutation).toHaveBeenCalledTimes(1));
    expect(flagMutation).toHaveBeenCalledWith({
      input: {
        threadId: "thread-1",
        turnId: "turn-1",
        datasetSlug: "flags",
        newDatasetName: null,
        resolutionTarget: "Should refuse.",
        outcomeKind: "security",
      },
    });
  });

  it("suggests the first skill candidate and submits skillSlug attribution", async () => {
    candidatesData = {
      flaggedTurnSkillCandidates: {
        candidates: [
          { skillSlug: "web-research", source: "active" },
          { skillSlug: "summarize", source: "active" },
        ],
        fallback: false,
      },
    };
    setupMocks();
    renderDialog();

    // Skill mode: the custom-dataset picker is replaced by the attribution
    // picker — no dataset trigger, no new-name input.
    await waitFor(() =>
      expect(screen.getByTestId("flag-eval-attribution-trigger")).toBeTruthy(),
    );
    expect(screen.queryByTestId("flag-eval-dataset-trigger")).toBeNull();
    expect(screen.queryByTestId("flag-eval-new-dataset-name")).toBeNull();

    fireEvent.change(screen.getByTestId("flag-eval-resolution-target"), {
      target: { value: "Should cite a source." },
    });
    fireEvent.click(screen.getByTestId("flag-eval-submit"));

    await waitFor(() => expect(flagMutation).toHaveBeenCalledTimes(1));
    expect(flagMutation).toHaveBeenCalledWith({
      input: {
        threadId: "thread-1",
        turnId: "turn-1",
        skillSlug: "web-research",
        attributionFallback: false,
        resolutionTarget: "Should cite a source.",
        outcomeKind: "quality",
      },
    });
  });

  it("stamps attributionFallback for installed-skill fallback candidates", async () => {
    candidatesData = {
      flaggedTurnSkillCandidates: {
        candidates: [{ skillSlug: "legacy-skill", source: "installed" }],
        fallback: true,
      },
    };
    setupMocks();
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("flag-eval-attribution-trigger")).toBeTruthy(),
    );
    fireEvent.change(screen.getByTestId("flag-eval-resolution-target"), {
      target: { value: "Should refuse." },
    });
    fireEvent.click(screen.getByTestId("flag-eval-submit"));

    await waitFor(() => expect(flagMutation).toHaveBeenCalledTimes(1));
    expect(flagMutation).toHaveBeenCalledWith({
      input: {
        threadId: "thread-1",
        turnId: "turn-1",
        skillSlug: "legacy-skill",
        attributionFallback: true,
        resolutionTarget: "Should refuse.",
        outcomeKind: "quality",
      },
    });
  });

  it("submit is disabled when no turn is targeted", () => {
    render(
      <FlagThreadForEvalDialog
        open
        onOpenChange={vi.fn()}
        tenantId="tenant-1"
        threadId="thread-1"
        turnId={null}
      />,
    );
    fireEvent.change(screen.getByTestId("flag-eval-new-dataset-name"), {
      target: { value: "Bad threads" },
    });
    fireEvent.change(screen.getByTestId("flag-eval-resolution-target"), {
      target: { value: "Should cite a source." },
    });
    expect(
      (screen.getByTestId("flag-eval-submit") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
