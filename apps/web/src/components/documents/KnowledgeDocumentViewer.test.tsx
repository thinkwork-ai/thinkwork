import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Zrimo boots WASM workers — none of that runs under jsdom, so the client
// is a stub and the assertions are about what the page hands it.
const viewerLoad = vi.fn<() => Promise<void>>(() => Promise.resolve());
const viewerDestroy = vi.fn(() => Promise.resolve());
const clientDestroy = vi.fn(() => Promise.resolve());
const createViewer = vi.fn(() => ({
  load: viewerLoad,
  destroy: viewerDestroy,
}));
vi.mock("@zrimo/viewer", () => ({
  ViewerClient: {
    create: vi.fn(() => ({ createViewer, destroy: clientDestroy })),
  },
}));
vi.mock("@zrimo/viewer/styles.css", () => ({}));

import { KnowledgeDocumentViewer } from "./KnowledgeDocumentViewer";

const DOC_LINK =
  "https://mcp.brain.example/kb/doc?key=evidence%2Facme%2Fhr%2Fdocuments%2FHandbook.docx&exp=1800000000&sig=abc123";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

function bytesResponse(blob: Blob) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/octet-stream" }),
    blob: async () => blob,
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  viewerLoad.mockClear();
  createViewer.mockClear();
});

describe("KnowledgeDocumentViewer", () => {
  it("resolves the doc link as JSON, fetches the bytes and hands them to the viewer", async () => {
    const blob = new Blob(["bytes"]);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === DOC_LINK) {
        expect(new Headers(init?.headers).get("accept")).toBe(
          "application/json",
        );
        return jsonResponse({ url: "https://evidence.example/signed" });
      }
      expect(url).toBe("https://evidence.example/signed");
      return bytesResponse(blob);
    });

    render(
      <KnowledgeDocumentViewer
        src={DOC_LINK}
        documentKey="hr/Handbook.docx"
        page={2}
      />,
    );

    await waitFor(() => expect(viewerLoad).toHaveBeenCalledOnce());
    expect(viewerLoad).toHaveBeenCalledWith(blob, {
      fileName: "Handbook.docx",
    });
    // Spreadsheet-vs-paged fit: a docx opens fitted to width.
    expect(createViewer).toHaveBeenCalledWith(
      expect.objectContaining({ fit: "width" }),
    );
    expect(screen.getByText("Handbook.docx")).toBeTruthy();
    expect(screen.getByText("p.2")).toBeTruthy();
  });

  it("uses the response bytes directly when the server ignores Accept", async () => {
    const blob = new Blob(["bytes"]);
    fetchMock.mockResolvedValue(bytesResponse(blob));

    render(<KnowledgeDocumentViewer src={DOC_LINK} documentKey="sheet.xlsx" />);

    await waitFor(() => expect(viewerLoad).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Spreadsheets open at 100%, not fit-to-width.
    expect(createViewer).toHaveBeenCalledWith(
      expect.objectContaining({ fit: "none" }),
    );
  });

  it("shows the expired-link error state for a 403", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "link_expired" }, 403));

    render(
      <KnowledgeDocumentViewer src={DOC_LINK} documentKey="hr/Handbook.docx" />,
    );

    const error = await screen.findByTestId("knowledge-viewer-error");
    expect(error.textContent).toContain("expired");
    expect(screen.getByText(/Download instead/)).toBeTruthy();
  });

  it("refuses to fetch a src that is not the signed doc-link shape", async () => {
    render(
      <KnowledgeDocumentViewer
        src="https://evil.example/anything.docx"
        documentKey="hr/Handbook.docx"
      />,
    );

    const error = await screen.findByTestId("knowledge-viewer-error");
    expect(error.textContent).toContain("not a signed knowledge-document link");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("errors without fetching when the URL carries no document", async () => {
    render(<KnowledgeDocumentViewer />);

    const error = await screen.findByTestId("knowledge-viewer-error");
    expect(error.textContent).toContain("No document in the URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
