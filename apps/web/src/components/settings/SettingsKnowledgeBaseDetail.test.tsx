/**
 * THINK-345 U3-U6. These assert against the rendered tree rather than calling
 * helpers directly — the inline-citation arc shipped this same surface inert
 * twice while every unit test passed, because the tests exercised parsers
 * instead of the DOM (docs/solutions/ui-bugs/inline-citations-shipped-inert-twice-2026-07-25.md).
 *
 * jsdom computes no layout, so the rail's narrowing of the table is confirmed
 * in a browser, not here. What is asserted here is the structure and the
 * interaction wiring that produce it.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { navigateMock, headerActions, kbDocs, kb, docs, filesApi } = vi.hoisted(
  () => ({
    navigateMock: vi.fn(),
    headerActions: { current: null as any },
    kbDocs: {
      KnowledgeBaseDetailQuery: Symbol("detail"),
      SyncKnowledgeBaseMutation: Symbol("sync"),
      RetryKnowledgeBaseMutation: Symbol("retry"),
      UpdateKnowledgeBaseMutation: Symbol("update"),
      DeleteKnowledgeBaseMutation: Symbol("delete"),
      TestKnowledgeBaseRetrievalQuery: Symbol("test"),
      // Pulled in by KnowledgeBaseFormDialog, which the page always mounts.
      CreateKnowledgeBaseMutation: Symbol("create"),
    },
    kb: {
      current: {
        id: "kb-1",
        name: "CX SOPs",
        description: "McPherson customer-experience SOP corpus",
        embeddingModel: "titan-embed-text-v2",
        chunkingStrategy: "FIXED_SIZE",
        chunkSizeTokens: 300,
        chunkOverlapPercent: 20,
        status: "active",
        awsKbId: "BTCHDLVPZR",
        lastSyncAt: "2026-07-25T00:00:00.000Z",
        lastSyncStatus: "succeeded",
        documentCount: 173,
        errorMessage: null as string | null,
      },
    },
    docs: {
      current: [] as any[],
    },
    filesApi: {
      getDocumentViewUrl: vi.fn(async () => "https://example.invalid/doc.pdf"),
      deleteDocument: vi.fn(async () => {}),
      uploadDocument: vi.fn(async () => {}),
    },
  }),
);

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ kbId: "kb-1" }),
}));

vi.mock("urql", () => ({
  useQuery: (opts: any) => {
    if (opts.query === kbDocs.KnowledgeBaseDetailQuery) {
      return [
        { data: { knowledgeBase: kb.current }, fetching: false },
        vi.fn(),
      ];
    }
    return [{ data: undefined, fetching: false }, vi.fn()];
  },
  useMutation: () => [{ fetching: false }, vi.fn(async () => ({}))],
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: () => ({ tenantId: "tenant-1" }),
}));

// Capture what the page publishes into the app header so the icon actions can
// be exercised — in the real app AppTopBar renders them.
vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: (actions: any) => {
    headerActions.current = actions;
  },
}));

vi.mock("@/lib/kb-queries", () => kbDocs);

vi.mock("@/components/settings/SettingsKnowledgeBaseBinding", () => ({
  SettingsKnowledgeBaseBinding: () => <div>spaces binding</div>,
}));

vi.mock("@/lib/kb-files-api", () => ({
  listManifestDocuments: async () => ({
    documents: docs.current,
    total: docs.current.length,
  }),
  getDocumentViewUrl: filesApi.getDocumentViewUrl,
  deleteDocument: filesApi.deleteDocument,
  uploadDocument: filesApi.uploadDocument,
}));

import { SettingsKnowledgeBaseDetail } from "./SettingsKnowledgeBaseDetail";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A standalone counter, not docs.current.length — the fixtures in an array
// literal are all built before the array is assigned, so length-based ids
// would collide and every document would be doc-1.
let docSeq = 0;

function doc(overrides: Record<string, unknown> = {}) {
  const n = ++docSeq;
  return {
    id: `doc-${n}`,
    documentKey: `cx/CX-000${n}.pdf`,
    name: `CX-000${n}.pdf`,
    status: "indexed",
    sourceKind: "s3-connect",
    updatedAt: "2026-07-25T00:00:00.000Z",
    projectionStatus: "projected",
    edition: 1,
    pageCount: 4,
    lastError: null,
    effectiveFrom: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

/** Click a header icon by its accessible name. */
async function clickHeaderAction(name: RegExp) {
  // In the real app AppTopBar renders these; here the published node is
  // mounted on its own root. The handlers are closures over the page's
  // setState, so clicking still drives the page.
  const node = render(<>{headerActions.current?.action}</>);
  fireEvent.click(node.getByRole("button", { name }));
  node.unmount();
  await waitFor(() => {});
}

async function renderPage() {
  const view = render(<SettingsKnowledgeBaseDetail />);
  // Documents load in an effect.
  await waitFor(() => expect(headerActions.current).not.toBeNull());
  return view;
}

beforeEach(() => {
  navigateMock.mockReset();
  headerActions.current = null;
  filesApi.getDocumentViewUrl.mockClear();
  filesApi.deleteDocument.mockClear();
  docs.current = [];
  docSeq = 0;
  kb.current.status = "active";
  kb.current.errorMessage = null;
});
afterEach(cleanup);

describe("detail page shell (U3)", () => {
  it("publishes upload, edit, sync, and the panel toggle into the header", async () => {
    docs.current = [doc()];
    await renderPage();

    const header = render(<>{headerActions.current?.action}</>);
    for (const name of [
      /upload documents/i,
      /edit source/i,
      /sync now/i,
      /source details/i,
      /show details panel/i,
    ]) {
      expect(header.getByRole("button", { name })).toBeTruthy();
    }
    header.unmount();
  });

  it("shows upload even when the only source is a connected bucket", async () => {
    docs.current = [doc({ sourceKind: "s3-connect" })];
    await renderPage();

    const header = render(<>{headerActions.current?.action}</>);
    expect(
      header.getByRole("button", { name: /upload documents/i }),
    ).toBeTruthy();
    header.unmount();
  });

  it("keeps the description on the page but not the operator facts", async () => {
    await renderPage();

    expect(
      screen.getByText(/McPherson customer-experience SOP corpus/),
    ).toBeTruthy();
    // R5: the counts moved behind the header info icon so the table starts
    // higher up the page.
    expect(screen.queryByText(/173 documents/)).toBeNull();
    expect(screen.queryByText(/titan-embed-text-v2/)).toBeNull();
  });

  it("shows the operator facts in the header info popover", async () => {
    await renderPage();

    const header = render(<>{headerActions.current?.action}</>);
    fireEvent.click(header.getByRole("button", { name: /source details/i }));

    await waitFor(() => expect(screen.getByText("Documents")).toBeTruthy());
    expect(screen.getByText("173")).toBeTruthy();
    expect(screen.getByText("succeeded")).toBeTruthy();
    expect(screen.getByText("titan-embed-text-v2")).toBeTruthy();
    expect(screen.getByText("fixed 300 / 20%")).toBeTruthy();
    header.unmount();
  });

  it("keeps the provisioning-failure banner and retry control", async () => {
    kb.current.status = "failed";
    kb.current.errorMessage = "Bedrock rejected the data source";
    await renderPage();

    expect(screen.getByText("Provisioning failed")).toBeTruthy();
    expect(screen.getByText("Bedrock rejected the data source")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /retry provisioning/i }),
    ).toBeTruthy();
  });
});

describe("documents table (U4)", () => {
  it("opens the document from the view control only", async () => {
    docs.current = [doc()];
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /open CX-0001.pdf/i }),
    );
    expect(filesApi.getDocumentViewUrl).toHaveBeenCalledWith("kb-1", "doc-1");
  });

  it("selects the row on click without opening a tab", async () => {
    docs.current = [doc()];
    await renderPage();

    fireEvent.click(await screen.findByText("CX-0001.pdf"));

    expect(filesApi.getDocumentViewUrl).not.toHaveBeenCalled();
    expect(screen.getByTestId("kb-rail")).toBeTruthy();
    expect(screen.getByLabelText("Document details")).toBeTruthy();
  });

  it("offers Remove for uploads and nothing for connected-bucket documents", async () => {
    docs.current = [
      doc({ sourceKind: "managed-upload", name: "policy.docx" }),
      doc({ sourceKind: "s3-connect", name: "CX-0002.pdf" }),
    ];
    await renderPage();

    await screen.findByText("policy.docx");
    expect(
      screen.getByRole("button", { name: /more actions for policy.docx/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /more actions for CX-0002.pdf/i }),
    ).toBeNull();
  });

  it("narrows rows by search and restores them when cleared", async () => {
    docs.current = [
      doc({ name: "CX-0001 Blanket PO.pdf" }),
      doc({ name: "CX-0002 Restocking Fees.pdf" }),
    ];
    await renderPage();

    await screen.findByText("CX-0001 Blanket PO.pdf");
    fireEvent.click(screen.getByRole("button", { name: /search documents/i }));
    fireEvent.change(
      screen.getByRole("searchbox", { name: /search documents/i }),
      {
        target: { value: "Restocking" },
      },
    );

    expect(screen.queryByText("CX-0001 Blanket PO.pdf")).toBeNull();
    expect(screen.getByText("CX-0002 Restocking Fees.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
    expect(screen.getByText("CX-0001 Blanket PO.pdf")).toBeTruthy();
  });

  it("truncates long names and keeps the full key in a title", async () => {
    docs.current = [
      doc({
        name: "CX-0006 Large Bulk Orders and_or McOil Long Haul Freight Requests.pdf",
        documentKey:
          "cx/CX-0006 Large Bulk Orders and_or McOil Long Haul Freight Requests.pdf",
      }),
    ];
    await renderPage();

    const cell = await screen.findByTitle(
      "cx/CX-0006 Large Bulk Orders and_or McOil Long Haul Freight Requests.pdf",
    );
    expect(cell.className).toContain("truncate");
  });
});

describe("right rail (U5, U6)", () => {
  it("is absent until the header toggle opens it", async () => {
    docs.current = [doc()];
    await renderPage();

    expect(screen.queryByTestId("kb-rail")).toBeNull();
    await clickHeaderAction(/show details panel/i);
    expect(screen.getByTestId("kb-rail")).toBeTruthy();
  });

  it("shows Knowledge Base settings when nothing is selected", async () => {
    await renderPage();
    await clickHeaderAction(/show details panel/i);

    expect(screen.getByLabelText("Knowledge Base settings")).toBeTruthy();
    expect(screen.getByText("Chunking")).toBeTruthy();
    expect(screen.getByText("Test retrieval")).toBeTruthy();
    expect(screen.getByText("spaces binding")).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete source/i })).toBeTruthy();
  });

  it("clears the selection when the rail closes, so reopening shows settings", async () => {
    docs.current = [doc()];
    await renderPage();

    fireEvent.click(await screen.findByText("CX-0001.pdf"));
    expect(screen.getByLabelText("Document details")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /close panel/i }));
    expect(screen.queryByTestId("kb-rail")).toBeNull();

    await clickHeaderAction(/show details panel/i);
    expect(screen.getByLabelText("Knowledge Base settings")).toBeTruthy();
  });

  it("still requires a second confirm before deleting", async () => {
    await renderPage();
    await clickHeaderAction(/show details panel/i);

    fireEvent.click(screen.getByRole("button", { name: /delete source/i }));
    expect(
      screen.getByText(/Delete this Knowledge Base and all its documents\?/),
    ).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows the recorded error for a failed document", async () => {
    docs.current = [
      doc({
        status: "failed",
        lastError: "Bedrock ingestion returned an empty statusReason",
        pageCount: null,
      }),
    ];
    await renderPage();

    fireEvent.click(await screen.findByText("CX-0001.pdf"));

    expect(screen.getByText("Last error")).toBeTruthy();
    expect(
      screen.getByText("Bedrock ingestion returned an empty statusReason"),
    ).toBeTruthy();
    expect(screen.getByText("Indexing failed")).toBeTruthy();
  });

  it("replaces the shown document when a different row is selected", async () => {
    docs.current = [doc({ name: "first.pdf" }), doc({ name: "second.pdf" })];
    await renderPage();

    fireEvent.click(await screen.findByText("first.pdf"));
    expect(screen.getByTestId("kb-rail").textContent).toContain(
      "cx/CX-0001.pdf",
    );

    fireEvent.click(screen.getByText("second.pdf"));
    const rail = screen.getByTestId("kb-rail");
    expect(rail.textContent).toContain("cx/CX-0002.pdf");
    expect(rail.textContent).not.toContain("cx/CX-0001.pdf");
  });

  it("renders a document with no page count or error without empty rows", async () => {
    docs.current = [
      doc({
        pageCount: null,
        lastError: null,
        projectionStatus: null,
        edition: null,
      }),
    ];
    await renderPage();

    fireEvent.click(await screen.findByText("CX-0001.pdf"));
    const rail = screen.getByTestId("kb-rail");
    expect(rail.textContent).toContain("Indexed");
    expect(screen.queryByText("Last error")).toBeNull();
  });

  // R21: "indexed, nothing extractable" is the CX-0215 failure shape and must
  // not read the same as "not indexed yet".
  it("reads an indexed-but-empty document as extracted nothing", async () => {
    docs.current = [doc({ pageCount: 0 })];
    await renderPage();
    fireEvent.click(await screen.findByText("CX-0001.pdf"));
    expect(
      screen.getByText("Indexed, but no content was extracted"),
    ).toBeTruthy();
  });

  it("reads a pending document as not indexed yet", async () => {
    docs.current = [doc({ status: "pending", pageCount: null })];
    await renderPage();
    fireEvent.click(await screen.findByText("CX-0001.pdf"));
    expect(screen.getByText("Not indexed yet")).toBeTruthy();
  });
});

describe("header registration", () => {
  it("re-keys when rail state changes, so the toggle icon re-renders", async () => {
    await renderPage();
    const before = headerActions.current?.actionKey;
    await clickHeaderAction(/show details panel/i);
    expect(headerActions.current?.actionKey).not.toBe(before);
  });
});
