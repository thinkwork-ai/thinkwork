import { describe, expect, it } from "vitest";
import { knowledgeSourceKeysFromInvocations } from "./sources";

const hitText = (key: string, edition?: number) =>
  `1. [CX SOPs] Some passage text\n   Source: ${key}${edition ? ` (edition ${edition})` : ""}`;

describe("knowledgeSourceKeysFromInvocations", () => {
  it("extracts and dedupes Source lines from runner-shaped invocations", () => {
    const keys = knowledgeSourceKeysFromInvocations([
      {
        name: "search_knowledge",
        result: {
          content: [
            { text: hitText("cx/files/CX-0072 Billing.pdf") },
            {
              text: `${hitText("cx/files/CX-0217 PODs.pdf", 2)}\n\n${hitText(
                "cx/files/CX-0072 Billing.pdf",
              )}`,
            },
          ],
        },
      },
      {
        name: "search_knowledge",
        result: { content: [{ text: hitText("cx/files/CX-0226 ACE.pdf") }] },
      },
    ]);
    expect(keys).toEqual([
      "cx/files/CX-0072 Billing.pdf",
      "cx/files/CX-0217 PODs.pdf",
      "cx/files/CX-0226 ACE.pdf",
    ]);
  });

  it("reads ledger-shaped records via output_preview and ignores other tools", () => {
    const keys = knowledgeSourceKeysFromInvocations([
      {
        tool_name: "search_knowledge",
        output_preview: hitText("cx/files/CX-0144 Codes.xlsx"),
      },
      { tool_name: "web_search", output_preview: hitText("not/a/kb-doc.pdf") },
      "not-an-object",
      null,
    ]);
    expect(keys).toEqual(["cx/files/CX-0144 Codes.xlsx"]);
  });

  it("returns empty for turns with no knowledge searches", () => {
    expect(
      knowledgeSourceKeysFromInvocations([{ name: "emit_json_render_ui" }]),
    ).toEqual([]);
  });
});
